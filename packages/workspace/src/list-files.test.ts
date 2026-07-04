import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listWorkspaceFiles } from "./list-files.js";

describe("listWorkspaceFiles", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );

        temporaryDirectories.length = 0;
    });

    it("lists direct children of the workspace root", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-list-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(path.join(workspaceRoot, "package.json"), "{}");
        await writeFile(path.join(workspaceRoot, "README.md"), "hello");

        const files = await listWorkspaceFiles(workspaceRoot);

        expect(files).toEqual(["README.md", "package.json", "src"]);
    });

    it("lists direct children of a requested subdirectory", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-list-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(path.join(workspaceRoot, "src", "App.tsx"), "app");

        const files = await listWorkspaceFiles(workspaceRoot, "src");

        expect(files).toEqual([path.join("src", "App.tsx")]);
    });

    it("rejects listing outside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-list-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            listWorkspaceFiles(workspaceRoot, "../outside"),
        ).rejects.toThrow("Path escapes workspace root");
    });
});