import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeWorkspaceFile } from "./write-file.js";

describe("writeWorkspaceFile", () => {
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

    it("creates nested directories and writes a text file", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-write-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeWorkspaceFile(
            workspaceRoot,
            "src/components/Button.tsx",
            "export const Button = () => null;",
        );

        const content = await readFile(
            path.join(workspaceRoot, "src", "components", "Button.tsx"),
            "utf8",
        );

        expect(content).toBe("export const Button = () => null;");
    });

    it("overwrites an existing file", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-write-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeWorkspaceFile(workspaceRoot, "note.txt", "first");
        await writeWorkspaceFile(workspaceRoot, "note.txt", "second");

        const content = await readFile(
            path.join(workspaceRoot, "note.txt"),
            "utf8",
        );

        expect(content).toBe("second");
    });

    it("rejects writing outside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-write-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            writeWorkspaceFile(
                workspaceRoot,
                "../outside.txt",
                "unsafe",
            ),
        ).rejects.toThrow("Path escapes workspace root");
    });
});