import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { stripAnsi } from "./strip-ansi.js";
import {
    assertCommandAllowed,
    type WorkspaceCommand,
} from "./command-policy.js";

export type  CommandResult={
    exitCode:number;
    stdout:string;
    stderr:string;
}

export type CommandOptions = {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
};

// Cold dependency installs for generated apps regularly exceed 30 seconds.
// The enclosing run still has its own cancellation signal and hard deadline.
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const PROCESS_CLEANUP_TIMEOUT_MS = 5_000;

type ResolvedCommand = {
    executable: string;
    args: string[];
};

function resolveCommand(request: WorkspaceCommand): ResolvedCommand {
    if (request.command === "npm") {
        const npmCliPath =
            process.env.npm_execpath ??
            path.join(
                path.dirname(process.execPath),
                "node_modules",
                "npm",
                "bin",
                "npm-cli.js",
            );

        return {
            executable: process.execPath,
            args: [npmCliPath, ...request.args],
        };
    }

    return {
        executable: request.command,
        args: request.args,
    };
}

type ProcessTerminationDependencies = {
    platform?: NodeJS.Platform;
    cleanupTimeoutMs?: number;
    spawnProcess?: typeof spawn;
};

function tryKill(child: ChildProcess): void {
    try {
        child.kill();
    } catch {
        // The process may already have exited between the state check and kill.
    }
}

function tryUnref(child: ChildProcess): void {
    try {
        child.unref();
    } catch {
        // A partially-created child process may not have a live handle to unref.
    }
}

function terminateProcessTree(
    child: ChildProcess,
    dependencies: ProcessTerminationDependencies = {},
): Promise<void> {
    if (child.pid === undefined || child.exitCode !== null) {
        return Promise.resolve();
    }

    const cleanupTimeoutMs =
        dependencies.cleanupTimeoutMs ?? PROCESS_CLEANUP_TIMEOUT_MS;

    return new Promise((resolve) => {
        let cleanupTimer: NodeJS.Timeout | undefined;
        let killer: ChildProcess | undefined;
        let finished = false;

        const finish = () => {
            if (finished) {
                return;
            }

            finished = true;
            if (cleanupTimer !== undefined) {
                clearTimeout(cleanupTimer);
            }
            resolve();
        };

        child.once("close", finish);

        cleanupTimer = setTimeout(() => {
            // Neither taskkill nor a child close event is guaranteed on Windows.
            // Make one final direct kill attempt, detach any lingering handles, and
            // let the original timeout/cancellation rejection settle regardless.
            tryKill(child);
            tryUnref(child);
            if (killer !== undefined) {
                tryKill(killer);
                tryUnref(killer);
            }
            finish();
        }, cleanupTimeoutMs);

        if ((dependencies.platform ?? process.platform) === "win32") {
            const spawnProcess = dependencies.spawnProcess ?? spawn;

            try {
                killer = spawnProcess(
                    "taskkill",
                    ["/pid", String(child.pid), "/T", "/F"],
                    {
                        shell: false,
                        stdio: "ignore",
                    },
                );
            } catch {
                tryKill(child);
                return;
            }

            // Keep an error listener attached even after the cleanup deadline so a
            // late taskkill error cannot become an unhandled EventEmitter error.
            killer.on("error", () => {
                if (finished) {
                    return;
                }
                tryKill(child);
            });

            killer.on("close", (exitCode) => {
                if (finished) {
                    return;
                }
                if (exitCode !== 0 && child.exitCode === null) {
                    tryKill(child);
                }

                if (child.exitCode !== null) {
                    finish();
                }
            });
            return;
        }

        try {
            child.kill("SIGKILL");
        } catch {
            // The cleanup deadline still guarantees that the caller can settle.
        }
    });
}

// Kept out of the package entry point; exported only for deterministic cleanup
// deadline tests that do not launch or strand real operating-system processes.
export const __testOnlyTerminateProcessTree = terminateProcessTree;

export async function runWorkspaceCommand(
    workspaceRoot:string,
    request:WorkspaceCommand,
    options: CommandOptions = {},
): Promise<CommandResult>{
    assertCommandAllowed(request);
    options.signal?.throwIfAborted();

    return new Promise((resolve,reject)=>{
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const maxOutputBytes =
            options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        const resolvedCommand = resolveCommand(request);
        const child= spawn(resolvedCommand.executable,resolvedCommand.args,{
            cwd:workspaceRoot,
            shell:false,
        });
        let stdout="";
        let stderr="";
        let settled = false;

        const abortCommand = () => {
            const reason = options.signal?.reason;
            finishWithError(
                reason instanceof Error
                    ? reason
                    : new DOMException("Command was aborted", "AbortError"),
            );
        };

        const removeAbortListener = () => {
            options.signal?.removeEventListener("abort", abortCommand);
        };

        const finishWithError = (error: Error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            removeAbortListener();
            void terminateProcessTree(child).then(
                () => reject(error),
                () => reject(error),
            );
        };

        const checkOutputLimit = () => {
            const outputBytes =
                Buffer.byteLength(stdout) + Buffer.byteLength(stderr);

            if (outputBytes > maxOutputBytes) {
                finishWithError(
                    new Error(`Command output exceeded ${maxOutputBytes} bytes`),
                );
            }
        };

        const timeout = setTimeout(() => {
            finishWithError(
                new Error(`Command timed out after ${timeoutMs}ms`),
            );
        }, timeoutMs);

        options.signal?.addEventListener("abort", abortCommand, {
            once: true,
        });
        if (options.signal?.aborted) {
            abortCommand();
            return;
        }

        child.stdout.on("data",(chunk)=>{
            if (settled) {
                return;
            }
            stdout+=chunk.toString();
            checkOutputLimit();
        });
        child.stderr.on("data",(chunk)=>{
            if (settled) {
                return;
            }
            stderr+=chunk.toString();
            checkOutputLimit();
        });
        child.on("error",(error)=>{
            finishWithError(error);
        });
        child.on("close",(exitCode)=>{
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            removeAbortListener();
            resolve({
                exitCode: exitCode ?? -1,
                stdout:stripAnsi(stdout),
                stderr:stripAnsi(stderr),
            });
        });
    });
}
