import {
    mkdtemp,
    readFile,
    rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    afterEach,
    describe,
    expect,
    it,
} from "vitest";

import {
    writeWorkspaceBinaryFile,
} from "./write-binary-file.js";

describe("writeWorkspaceBinaryFile", () => {
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

    it("writes image bytes inside public assets", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-image-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const imageData = Uint8Array.from([
            137, 80, 78, 71,
        ]);

        await writeWorkspaceBinaryFile(
            workspaceRoot,
            "public/assets/wenzhou.png",
            imageData,
        );

        const savedData = await readFile(
            path.join(
                workspaceRoot,
                "public",
                "assets",
                "wenzhou.png",
            ),
        );

        expect([...savedData]).toEqual([...imageData]);
    });

    it("rejects paths outside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-image-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            writeWorkspaceBinaryFile(
                workspaceRoot,
                "../outside.png",
                Uint8Array.from([1, 2, 3]),
            ),
        ).rejects.toThrow(
            "Path escapes workspace root",
        );
    });
});