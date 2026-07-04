import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";

export type PreviewSession = {
    runId: string;
    workspaceRoot: string;
    port: number;
    url: string;
};

export type StartPreviewOptions = {
    runId: string;
    workspaceRoot: string;
};

type PreviewProcess = Pick<ChildProcess, "unref">;

type SpawnPreviewProcessOptions = {
    port: number;
    workspaceRoot: string;
};

export type SpawnPreviewProcess = (
    options: SpawnPreviewProcessOptions,
) => PreviewProcess;

export type CheckPortAvailable = (port: number) => Promise<boolean>;

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
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "cmd.exe" : "npm";
    const args = isWindows
        ? [
              "/d",
              "/s",
              "/c",
              `npm exec vite -- --host 127.0.0.1 --port ${options.port} --strictPort`,
          ]
        : [
              "exec",
              "vite",
              "--",
              "--host",
              "127.0.0.1",
              "--port",
              String(options.port),
              "--strictPort",
          ];

    return spawn(
        command,
        args,
        {
            cwd: options.workspaceRoot,
            stdio: "ignore",
        },
    );
}

type StoredPreviewSession = {
    process: PreviewProcess;
    session: PreviewSession;
};

export class PreviewManager {
    private readonly sessions = new Map<string, StoredPreviewSession>();
    private nextPort = 5174;

    constructor(
        private readonly spawnProcess: SpawnPreviewProcess = defaultSpawnPreviewProcess,
        private readonly checkPortAvailable: CheckPortAvailable = defaultCheckPortAvailable,
    ) {}

    findByRunId(runId: string): PreviewSession | undefined {
        return this.sessions.get(runId)?.session;
    }

    async start(options: StartPreviewOptions): Promise<PreviewSession> {
        const existingSession = this.findByRunId(options.runId);

        if (existingSession) {
            return existingSession;
        }

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

        childProcess.unref();

        this.sessions.set(options.runId, {
            process: childProcess,
            session,
        });

        return session;
    }

    private async findNextAvailablePort(): Promise<number> {
        let port = this.nextPort;

        while (!(await this.checkPortAvailable(port))) {
            port += 1;
        }

        return port;
    }
}
