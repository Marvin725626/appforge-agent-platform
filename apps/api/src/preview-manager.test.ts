import { describe, expect, it, vi } from "vitest";

import { PreviewManager } from "./preview-manager.js";

function createPreviewManager() {
    const unref = vi.fn();
    const spawnProcess = vi.fn(() => ({
        unref,
    }));
    const checkPortAvailable = vi.fn(async () => true);

    return {
        previewManager: new PreviewManager(spawnProcess, checkPortAvailable),
        spawnProcess,
        checkPortAvailable,
        unref,
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
});
