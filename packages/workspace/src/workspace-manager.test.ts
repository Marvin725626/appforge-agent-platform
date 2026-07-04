import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceManager } from "./workspace-manager.js";

describe("WorkspaceManager", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, {
                    recursive: true,
                    force: true,
                }),
            ),
        );

        temporaryDirectories.length = 0;
    });

    it("creates an isolated directory for a run", async () => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "appforge-manager-"),
        );

        temporaryDirectories.push(root);

        const manager = new WorkspaceManager(root);
        const workspaceRoot = await manager.create("run-001");
        const workspaceStats = await stat(workspaceRoot);

        expect(workspaceStats.isDirectory()).toBe(true);
        expect(workspaceRoot).toBe(path.join(root, "run-001"));
    });

    it("resolves different directories for different runs", () => {
        const root = path.resolve("workspaces");
        const manager = new WorkspaceManager(root);

        expect(manager.resolve("run-001")).not.toBe(
            manager.resolve("run-002"),
        );
    });

    it("rejects a run ID that escapes the workspace root", async () => {
        const root = path.resolve("workspaces");
        const manager = new WorkspaceManager(root);

        await expect(
            manager.create("../outside"),
        ).rejects.toThrow("Path escapes workspace root");
    });
});