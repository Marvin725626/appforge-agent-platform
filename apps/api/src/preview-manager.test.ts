import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { PreviewManager } from "./preview-manager.js";

function createPreviewManager() {
    const unref = vi.fn();
    const kill = vi.fn();
    const activePorts = new Set<number>();
    const spawnProcess = vi.fn(({ port }: { port: number }) => {
        activePorts.add(port);

        return {
            unref,
            kill,
        };
    });
    const checkPortAvailable = vi.fn(
        async (port: number) => !activePorts.has(port),
    );
    const waitForPreviewReady = vi.fn(async () => undefined);

    return {
        previewManager: new PreviewManager(
            spawnProcess,
            checkPortAvailable,
            waitForPreviewReady,
        ),
        spawnProcess,
        checkPortAvailable,
        waitForPreviewReady,
        unref,
        kill,
    };
}

describe("PreviewManager", () => {
    it("creates a preview session for a run", async () => {
        const { previewManager, spawnProcess, unref } = createPreviewManager();

        const session = await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        expect(session).toEqual({
            runId: "run-1",
            workspaceRoot: "workspace-1",
            port: 5174,
            url: "http://127.0.0.1:5174",
        });
        expect(spawnProcess).toHaveBeenCalledWith({
            port: 5174,
            workspaceRoot: "workspace-1",
        });
        expect(unref).toHaveBeenCalledOnce();
    });

    it("returns the existing session for the same run", async () => {
        const { previewManager, spawnProcess } = createPreviewManager();

        const firstSession = await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        const secondSession = await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        expect(secondSession).toBe(firstSession);
        expect(spawnProcess).toHaveBeenCalledOnce();
    });

    it("shares an in-flight preview start for the same workspace", async () => {
        const unref = vi.fn();
        const spawnProcess = vi.fn(() => ({ unref }));
        let markPreviewReady: (() => void) | undefined;
        const waitForPreviewReady = vi.fn(
            () => new Promise<void>((resolve) => {
                markPreviewReady = resolve;
            }),
        );
        const previewManager = new PreviewManager(
            spawnProcess,
            vi.fn(async () => true),
            waitForPreviewReady,
        );
        const options = {
            runId: "run-1",
            workspaceRoot: "workspace-1",
        };

        const firstStart = previewManager.start(options);
        const secondStart = previewManager.start(options);

        await vi.waitFor(() => {
            expect(spawnProcess).toHaveBeenCalledOnce();
        });
        markPreviewReady?.();

        await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([
            {
                runId: "run-1",
                workspaceRoot: "workspace-1",
                port: 5174,
                url: "http://127.0.0.1:5174",
            },
            {
                runId: "run-1",
                workspaceRoot: "workspace-1",
                port: 5174,
                url: "http://127.0.0.1:5174",
            },
        ]);
    });

    it("uses a new port for a different run", async () => {
        const { previewManager, spawnProcess } = createPreviewManager();

        await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        const secondSession = await previewManager.start({
            runId: "run-2",
            workspaceRoot: "workspace-2",
        });

        expect(secondSession).toEqual({
            runId: "run-2",
            workspaceRoot: "workspace-2",
            port: 5175,
            url: "http://127.0.0.1:5175",
        });
        expect(spawnProcess).toHaveBeenCalledTimes(2);
    });

    it("uses a new port for the same run with a different workspace", async () => {
        const { previewManager, spawnProcess, kill } = createPreviewManager();

        await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        const secondSession = await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1/versions/v2",
        });

        expect(secondSession).toEqual({
            runId: "run-1",
            workspaceRoot: "workspace-1/versions/v2",
            port: 5175,
            url: "http://127.0.0.1:5175",
        });
        expect(spawnProcess).toHaveBeenCalledTimes(2);
        expect(kill).toHaveBeenCalledOnce();
    });

    it("skips a port that is already in use", async () => {
        const unref = vi.fn();
        const spawnProcess = vi.fn(() => ({
            unref,
        }));
        const checkPortAvailable = vi
            .fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const previewManager = new PreviewManager(
            spawnProcess,
            checkPortAvailable,
            vi.fn(async () => undefined),
        );

        const session = await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });

        expect(session.port).toBe(5175);
        expect(session.url).toBe("http://127.0.0.1:5175");
        expect(spawnProcess).toHaveBeenCalledWith({
            port: 5175,
            workspaceRoot: "workspace-1",
        });
    });

    it("fails immediately when the preview process exits before readiness", async () => {
        const unref = vi.fn();
        const kill = vi.fn();
        const childProcess = Object.assign(new EventEmitter(), {
            unref,
            kill,
        }) as unknown as ChildProcess;
        const waitForPreviewReady = vi.fn(
            () => new Promise<void>(() => undefined),
        );
        const previewManager = new PreviewManager(
            vi.fn(() => childProcess),
            vi.fn(async () => true),
            waitForPreviewReady,
        );
        const start = previewManager.start({
            runId: "run-exits",
            workspaceRoot: "workspace-exits",
        });

        await vi.waitFor(() => {
            expect(unref).toHaveBeenCalledOnce();
        });
        childProcess.emit("exit", 1, null);

        await expect(start).rejects.toThrow(
            "Preview process exited before it became ready (code 1, signal none)",
        );
        expect(kill).toHaveBeenCalledOnce();
    });

    it("bounds stalled readiness probes and cleans up the failed start", async () => {
        vi.useFakeTimers();

        const unref = vi.fn();
        const kill = vi.fn();
        const spawnProcess = vi.fn(() => ({ unref, kill }));
        const checkPortAvailable = vi.fn(async () => true);
        const observedSignals: AbortSignal[] = [];
        const fetchMock = vi.fn(
            (
                _input: string | URL | Request,
                init?: RequestInit,
            ): Promise<Response> => {
                if (init?.signal) {
                    observedSignals.push(init.signal);
                }

                return new Promise<Response>(() => undefined);
            },
        );
        vi.stubGlobal("fetch", fetchMock);

        const previewManager = new PreviewManager(
            spawnProcess,
            checkPortAvailable,
        );
        const options = {
            runId: "run-stalled",
            workspaceRoot: "workspace-stalled",
        };

        try {
            const start = previewManager.start(options);
            const rejection = expect(start).rejects.toThrow(
                "Preview server did not start at http://127.0.0.1:5174",
            );

            await vi.advanceTimersByTimeAsync(15_001);
            await rejection;

            expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
            expect(observedSignals).toHaveLength(fetchMock.mock.calls.length);
            expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
            expect(kill).toHaveBeenCalledOnce();
            expect(
                previewManager.findByRunId(
                    options.runId,
                    options.workspaceRoot,
                ),
            ).toBeUndefined();

            fetchMock.mockResolvedValueOnce(
                new Response("ready", { status: 200 }),
            );
            await expect(previewManager.start(options)).resolves.toMatchObject({
                runId: options.runId,
                workspaceRoot: options.workspaceRoot,
                port: 5175,
            });
            expect(spawnProcess).toHaveBeenCalledTimes(2);
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });

    it("stops a preview before its workspace is changed or removed", async () => {
        const { previewManager, kill } = createPreviewManager();
        const options = {
            runId: "run-1",
            workspaceRoot: "workspace-1/versions/v2",
        };

        await previewManager.start(options);
        await previewManager.stop(options);

        expect(kill).toHaveBeenCalledOnce();
        expect(previewManager.findByRunId(options.runId, options.workspaceRoot)).toBeUndefined();
    });

    it("stops every preview for a run", async () => {
        const { previewManager, kill } = createPreviewManager();

        await previewManager.start({
            runId: "run-1",
            workspaceRoot: "workspace-1",
        });
        await previewManager.start({
            runId: "run-2",
            workspaceRoot: "workspace-2",
        });
        await previewManager.stopRun("run-1");

        expect(kill).toHaveBeenCalledOnce();
        expect(previewManager.findByRunId("run-1", "workspace-1")).toBeUndefined();
        expect(previewManager.findByRunId("run-2", "workspace-2")).toBeDefined();
    });
});
