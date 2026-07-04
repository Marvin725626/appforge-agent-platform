import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkspaceFile } from "./read-file.js";

describe("readWorkspaceFile", () => {
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

    it("reads a text file inside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-workspace-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeFile(
            path.join(workspaceRoot, "hello.txt"),
            "Hello AppForge",
            "utf8",
        );

        const content = await readWorkspaceFile(
            workspaceRoot,
            "hello.txt",
        );

        expect(content).toBe("Hello AppForge");
    });

    it("rejects reading a file outside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-workspace-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            readWorkspaceFile(workspaceRoot, "../secret.txt"),
        ).rejects.toThrow("Path escapes workspace root");
    });
});