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
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

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

function terminateProcessTree(child: ChildProcess): Promise<void> {
    if (child.pid === undefined || child.exitCode !== null) {
        return Promise.resolve();
    }

    if (process.platform === "win32") {
        return new Promise((resolve) => {
            let finished = false;

            const finish = () => {
                if (finished) {
                    return;
                }

                finished = true;
                resolve();
            };

            child.once("close", finish);

            const killer = spawn(
                "taskkill",
                ["/pid", String(child.pid), "/T", "/F"],
                {
                    shell: false,
                    stdio: "ignore",
                },
            );

            killer.on("error", () => {
                child.kill();
            });

            killer.on("close", (exitCode) => {
                if (exitCode !== 0 && child.exitCode === null) {
                    child.kill();
                }

                if (child.exitCode !== null) {
                    finish();
                }
            });
        });
    }

    return new Promise((resolve) => {
        child.on("close", () => {
            resolve();
        });

        child.kill("SIGKILL");
    });
}

export async function runWorkspaceCommand(
    workspaceRoot:string,
    request:WorkspaceCommand,
    options: CommandOptions = {},
): Promise<CommandResult>{
    assertCommandAllowed(request);

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

        const finishWithError = (error: Error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
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

        child.stdout.on("data",(chunk)=>{
            stdout+=chunk.toString();
            checkOutputLimit();
        });
        child.stderr.on("data",(chunk)=>{
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
            resolve({
                exitCode: exitCode ?? -1,
                stdout:stripAnsi(stdout),
                stderr:stripAnsi(stderr),
            });
        });
    });
}
