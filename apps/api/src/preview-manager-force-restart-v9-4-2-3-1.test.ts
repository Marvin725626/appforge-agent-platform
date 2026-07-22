import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    PreviewManager,
    type CheckPortAvailable,
    type SpawnPreviewProcess,
    type WaitForPreviewReady,
} from "./preview-manager.js";

class FakePreviewProcess extends EventEmitter {
    public killed = false;
    public readonly pid = undefined;

    public kill(): boolean {
        this.killed = true;
        this.emit("exit", 0, null);
        return true;
    }

    public unref(): void {
        // No-op for tests.
    }
}

describe("V9.4.2.3.1 PreviewManager forceRestart", () => {
    it("reuses a healthy session by default and restarts it when requested", async () => {
        const processes: FakePreviewProcess[] = [];
        const occupiedPorts = new Set<number>();
        const spawnPorts: number[] = [];

        const spawnProcess: SpawnPreviewProcess = (options) => {
            spawnPorts.push(options.port);
            const child = new FakePreviewProcess();
            processes.push(child);
            occupiedPorts.add(options.port);
            child.once("exit", () => occupiedPorts.delete(options.port));
            return child as unknown as ReturnType<SpawnPreviewProcess>;
        };
        const checkPortAvailable: CheckPortAvailable = async (port) =>
            !occupiedPorts.has(port);
        const waitForPreviewReady: WaitForPreviewReady = async () => undefined;

        const manager = new PreviewManager(
            spawnProcess,
            checkPortAvailable,
            waitForPreviewReady,
        );

        const workspaceRoot = path.resolve("fixtures", "preview-current");

        const first = await manager.start({
            runId: "run-preview-freshness",
            workspaceRoot,
        });
        const reused = await manager.start({
            runId: "run-preview-freshness",
            workspaceRoot,
        });
        const restarted = await manager.start({
            runId: "run-preview-freshness",
            workspaceRoot,
            forceRestart: true,
        });

        expect(reused).toEqual(first);
        expect(spawnPorts).toHaveLength(2);
        expect(processes[0]!.killed).toBe(true);
        expect(restarted.port).not.toBe(first.port);
        expect(restarted.url).not.toBe(first.url);

        await manager.stop(restarted);
    });

    it("keeps distinct workspace sessions isolated", async () => {
        const occupiedPorts = new Set<number>();

        const spawnProcess: SpawnPreviewProcess = (options) => {
            const child = new FakePreviewProcess();
            occupiedPorts.add(options.port);
            child.once("exit", () => occupiedPorts.delete(options.port));
            return child as unknown as ReturnType<SpawnPreviewProcess>;
        };
        const checkPortAvailable: CheckPortAvailable = async (port) =>
            !occupiedPorts.has(port);
        const waitForPreviewReady: WaitForPreviewReady = async () => undefined;

        const manager = new PreviewManager(
            spawnProcess,
            checkPortAvailable,
            waitForPreviewReady,
        );

        const one = await manager.start({
            runId: "same-run",
            workspaceRoot: path.resolve("workspace-one"),
        });
        const two = await manager.start({
            runId: "same-run",
            workspaceRoot: path.resolve("workspace-two"),
        });

        expect(one.port).not.toBe(two.port);
        expect(one.workspaceRoot).not.toBe(two.workspaceRoot);

        await manager.stop(one);
        await manager.stop(two);
    });
});
