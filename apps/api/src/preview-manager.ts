import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

export type PreviewSession = {
    runId: string;
    workspaceRoot: string;
    port: number;
    url: string;
};

export type StartPreviewOptions = {
    runId: string;
    workspaceRoot: string;
    /** V9.4.2.3 preview freshness: do not reuse a document loaded before workspace edits. */
    forceRestart?: boolean;
};

type PreviewProcess = Pick<ChildProcess, "unref"> &
    Partial<Pick<ChildProcess, "kill" | "pid" | "once">>;

type SpawnPreviewProcessOptions = {
    port: number;
    workspaceRoot: string;
};

export type SpawnPreviewProcess = (
    options: SpawnPreviewProcessOptions,
) => PreviewProcess;

export type CheckPortAvailable = (port: number) => Promise<boolean>;
export type WaitForPreviewReady = (session: PreviewSession) => Promise<void>;

const PREVIEW_READY_TIMEOUT_MS = 15_000;
const PREVIEW_READY_PROBE_TIMEOUT_MS = 2_000;
const PREVIEW_READY_RETRY_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function fetchPreviewWithTimeout(
    url: string,
    timeoutMs: number,
): Promise<Response | undefined> {
    const abortController = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            fetch(url, { signal: abortController.signal }),
            new Promise<undefined>((resolve) => {
                timeoutHandle = setTimeout(() => {
                    abortController.abort();
                    resolve(undefined);
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
        }
    }
}

async function defaultCheckPortAvailable(port: number): Promise<boolean> {
    return await new Promise((resolve) => {
        const server = createServer();

        server.once("error", () => {
            resolve(false);
        });

        server.once("listening", () => {
            server.close(() => {
                resolve(true);
            });
        });

        server.listen(port, "127.0.0.1");
    });
}

function defaultSpawnPreviewProcess(
    options: SpawnPreviewProcessOptions,
): PreviewProcess {
    // Launch Vite with this API process's Node executable. Calling `npm exec`
    // through cmd.exe makes local preview depend on a Windows shell being in PATH.
    if (!existsSync(options.workspaceRoot)) {
        throw new Error(
            `Preview workspace does not exist: ${options.workspaceRoot}`,
        );
    }

    const viteCliCandidates = [
        path.join(
            options.workspaceRoot,
            "node_modules",
            "vite",
            "bin",
            "vite.js",
        ),
        path.resolve(
            options.workspaceRoot,
            "..",
            "..",
            "node_modules",
            "vite",
            "bin",
            "vite.js",
        ),
        path.resolve(
            process.cwd(),
            "..",
            "..",
            "node_modules",
            "vite",
            "bin",
            "vite.js",
        ),
    ];
    const viteCliPath = viteCliCandidates.find((candidate) =>
        existsSync(candidate),
    );

    if (!viteCliPath) {
        throw new Error(
            `Vite CLI was not found for preview workspace: ${options.workspaceRoot}`,
        );
    }

    const nodeExecutable = existsSync(process.execPath)
        ? process.execPath
        : "node";

    return spawn(
        nodeExecutable,
        [
            viteCliPath,
            "--host",
            "127.0.0.1",
            "--port",
            String(options.port),
            "--strictPort",
        ],
        {
            cwd: options.workspaceRoot,
            stdio: "ignore",
            windowsHide: true,
        },
    );
}

async function defaultWaitForPreviewReady(
    session: PreviewSession,
): Promise<void> {
    const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
        const remainingMs = deadline - Date.now();

        try {
            const response = await fetchPreviewWithTimeout(
                session.url,
                Math.min(PREVIEW_READY_PROBE_TIMEOUT_MS, remainingMs),
            );

            if (response?.ok) {
                return;
            }
        } catch {
            // Vite may still be starting. Retry until the startup timeout expires.
        }

        const retryDelayMs = Math.min(
            PREVIEW_READY_RETRY_DELAY_MS,
            deadline - Date.now(),
        );

        if (retryDelayMs > 0) {
            await delay(retryDelayMs);
        }
    }

    throw new Error(`Preview server did not start at ${session.url}`);
}

type StoredPreviewSession = {
    process: PreviewProcess;
    session: PreviewSession;
};

async function terminatePreviewProcess(
    childProcess: PreviewProcess,
): Promise<void> {
    if (os.platform() !== "win32" || childProcess.pid === undefined) {
        childProcess.kill?.();
        return;
    }

    await new Promise<void>((resolve) => {
        const taskKillProcess = spawn(
            "taskkill",
            ["/pid", String(childProcess.pid), "/t", "/f"],
            { stdio: "ignore" },
        );

        taskKillProcess.once("error", () => {
            childProcess.kill?.();
            resolve();
        });
        taskKillProcess.once("close", () => resolve());
    });
}

// V9.4.2.3 preview freshness
export class PreviewManager {
    private readonly sessions = new Map<string, StoredPreviewSession>();
    private readonly pendingStarts = new Map<string, Promise<PreviewSession>>();
    private readonly reservedPorts = new Set<number>();
    private startQueue: Promise<void> = Promise.resolve();
    private nextPort = 5174;

    constructor(
        private readonly spawnProcess: SpawnPreviewProcess = defaultSpawnPreviewProcess,
        private readonly checkPortAvailable: CheckPortAvailable = defaultCheckPortAvailable,
        private readonly waitForPreviewReady: WaitForPreviewReady = defaultWaitForPreviewReady,
    ) {}

    findByRunId(runId: string, workspaceRoot: string): PreviewSession | undefined {
        return this.sessions.get(this.createSessionKey(runId, workspaceRoot))?.session;
    }

    async start(options: StartPreviewOptions): Promise<PreviewSession> {
        const sessionKey = this.createSessionKey(
            options.runId,
            options.workspaceRoot,
        );
        const pendingStart = this.pendingStarts.get(sessionKey);
        if (pendingStart) {
            if (!options.forceRestart) {
                return await pendingStart;
            }

            try {
                await pendingStart;
            } catch {
                // The forced fresh start below reports its own failure.
            }
        }

        const startPromise = this.withStartLock(() =>
            this.startPreview(options, sessionKey),
        );
        this.pendingStarts.set(sessionKey, startPromise);

        try {
            return await startPromise;
        } finally {
            if (this.pendingStarts.get(sessionKey) === startPromise) {
                this.pendingStarts.delete(sessionKey);
            }
        }
    }

    private async startPreview(
        options: StartPreviewOptions,
        sessionKey: string,
    ): Promise<PreviewSession> {
        const existingSession = this.findByRunId(
            options.runId,
            options.workspaceRoot,
        );

        const existingPortIsListening = existingSession
            ? !(await this.checkPortAvailable(existingSession.port))
            : false;

        if (
            existingSession &&
            existingPortIsListening &&
            !options.forceRestart
        ) {
            return existingSession;
        }

        if (existingSession) {
            if (existingPortIsListening) {
                await this.stop(existingSession);
            } else {
                this.sessions.delete(sessionKey);
                this.reservedPorts.delete(existingSession.port);
            }
        }

        // A run only needs one live preview at a time. Keeping old version
        // previews alive locks their snapshot folders on Windows.
        await this.stopRun(options.runId, options.workspaceRoot);

        const port = await this.findNextAvailablePort();
        this.nextPort = port + 1;

        const session = {
            runId: options.runId,
            workspaceRoot: options.workspaceRoot,
            port,
            url: `http://127.0.0.1:${port}`,
        };

        const childProcess = this.spawnProcess({
            port,
            workspaceRoot: options.workspaceRoot,
        });

        const processError = new Promise<never>((_, reject) => {
            childProcess.once?.("error", reject);
        });
        const processExit = new Promise<never>((_, reject) => {
            childProcess.once?.("exit", (code, signal) => {
                reject(
                    new Error(
                        `Preview process exited before it became ready (code ${code ?? "unknown"}, signal ${signal ?? "none"})`,
                    ),
                );
            });
        });

        try {
            childProcess.unref();
            await Promise.race([
                this.waitForPreviewReady(session),
                processError,
                processExit,
            ]);
        } catch (error) {
            childProcess.kill?.();
            this.reservedPorts.delete(port);
            throw error;
        }

        this.sessions.set(sessionKey, {
            process: childProcess,
            session,
        });

        return session;
    }

    async stop(options: StartPreviewOptions): Promise<void> {
        const sessionKey = this.createSessionKey(
            options.runId,
            options.workspaceRoot,
        );
        const storedSession = this.sessions.get(sessionKey);

        if (!storedSession) {
            return;
        }

        await terminatePreviewProcess(storedSession.process);
        this.sessions.delete(sessionKey);
        this.reservedPorts.delete(storedSession.session.port);
    }

    async stopRun(
        runId: string,
        keepWorkspaceRoot?: string,
    ): Promise<void> {
        const sessionsToStop = [...this.sessions.values()].filter(
            ({ session }) =>
                session.runId === runId &&
                session.workspaceRoot !== keepWorkspaceRoot,
        );

        await Promise.all(
            sessionsToStop.map(({ session }) => this.stop(session)),
        );
    }

    private createSessionKey(runId: string, workspaceRoot: string): string {
        return `${runId}:${workspaceRoot}`;
    }

    private async findNextAvailablePort(): Promise<number> {
        let port = this.nextPort;

        while (
            this.reservedPorts.has(port) ||
            !(await this.checkPortAvailable(port))
        ) {
            port += 1;
        }

        this.reservedPorts.add(port);
        return port;
    }

    private async withStartLock<T>(
        operation: () => Promise<T>,
    ): Promise<T> {
        const previousStart = this.startQueue;
        let releaseStart: () => void = () => undefined;
        this.startQueue = new Promise<void>((resolve) => {
            releaseStart = resolve;
        });

        await previousStart;

        try {
            return await operation();
        } finally {
            releaseStart();
        }
    }
}
