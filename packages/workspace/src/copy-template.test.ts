import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyWorkspaceTemplate } from "./copy-template.js";

describe("copyWorkspaceTemplate", () => {
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

    it("copies a template directory into the workspace", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await writeFile(path.join(templateRoot, "package.json"), "{}");
        await writeFile(path.join(templateRoot, "src", "App.tsx"), "app");

        await copyWorkspaceTemplate(workspaceRoot, templateRoot);

        expect(
            await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
        ).toBe("{}");

        expect(
            await readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).toBe("app");
    });

    it("rejects copying outside the workspace", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await expect(
            copyWorkspaceTemplate(workspaceRoot, templateRoot, "../outside"),
        ).rejects.toThrow("Path escapes workspace root");
    });
});