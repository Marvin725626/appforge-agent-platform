import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RenameFunction = typeof import("node:fs/promises").rename;

const fileSystemMock = vi.hoisted(() => ({
    actualRename: undefined as RenameFunction | undefined,
    rename: vi.fn<RenameFunction>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();

    fileSystemMock.actualRename = actual.rename;
    fileSystemMock.rename.mockImplementation(actual.rename);

    return {
        ...actual,
        rename: fileSystemMock.rename,
    };
});

import {
    deleteRunVersionSnapshot,
    restoreRunVersionSnapshot,
    saveRunVersionSnapshot,
} from "./run-version-snapshot.js";

describe("saveRunVersionSnapshot", () => {
    const temporaryDirectories: string[] = [];

    beforeEach(() => {
        fileSystemMock.rename.mockReset();
        fileSystemMock.rename.mockImplementation((oldPath, newPath) =>
            fileSystemMock.actualRename!(oldPath, newPath),
        );
    });

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

    function createFileSystemError(code: string): Error & { code: string } {
        return Object.assign(new Error(`simulated ${code}`), { code });
    }

    async function listSavingDirectories(workspaceRoot: string) {
        return (await readdir(path.join(workspaceRoot, "versions"))).filter(
            (entry) => entry.startsWith(".saving-"),
        );
    }

    it("copies public assets into the version snapshot", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "public", "assets"), {
            recursive: true,
        });
        await writeFile(
            path.join(workspaceRoot, "public", "assets", "hero.jpg"),
            "fake image bytes",
            "utf8",
        );

        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });

        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    "v1",
                    "public",
                    "assets",
                    "hero.jpg",
                ),
                "utf8",
            ),
        ).resolves.toBe("fake image bytes");
    });

    it("retries a transient Windows EPERM while atomically publishing", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "transient lock candidate",
            "utf8",
        );

        let remainingFailures = 2;

        fileSystemMock.rename.mockImplementation((oldPath, newPath) => {
            if (remainingFailures > 0) {
                remainingFailures -= 1;
                return Promise.reject(createFileSystemError("EPERM"));
            }

            return fileSystemMock.actualRename!(oldPath, newPath);
        });

        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });

        expect(fileSystemMock.rename).toHaveBeenCalledTimes(3);
        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    "v1",
                    "src",
                    "App.tsx",
                ),
                "utf8",
            ),
        ).resolves.toBe("transient lock candidate");
        await expect(listSavingDirectories(workspaceRoot)).resolves.toEqual(
            [],
        );
    });

    it("keeps an existing immutable snapshot instead of overwriting it", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "first committed candidate",
            "utf8",
        );
        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
            snapshotId: "immutable-id",
        });

        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "later candidate that must not overwrite",
            "utf8",
        );
        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
            snapshotId: "immutable-id",
        });

        expect(fileSystemMock.rename).toHaveBeenCalledTimes(1);
        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    "immutable-id",
                    "src",
                    "App.tsx",
                ),
                "utf8",
            ),
        ).resolves.toBe("first committed candidate");
        await expect(listSavingDirectories(workspaceRoot)).resolves.toEqual(
            [],
        );
    });

    it("publishes concurrent saves once and cleans the losing temporary directory", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "shared concurrent candidate",
            "utf8",
        );

        await Promise.all([
            saveRunVersionSnapshot({
                workspaceRoot,
                versionNumber: 1,
                snapshotId: "concurrent-id",
            }),
            saveRunVersionSnapshot({
                workspaceRoot,
                versionNumber: 1,
                snapshotId: "concurrent-id",
            }),
        ]);

        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    "concurrent-id",
                    "src",
                    "App.tsx",
                ),
                "utf8",
            ),
        ).resolves.toBe("shared concurrent candidate");
        await expect(listSavingDirectories(workspaceRoot)).resolves.toEqual(
            [],
        );
    });

    it("falls back to direct copy when Windows rejects every publish rename", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "permanently locked candidate",
            "utf8",
        );

        fileSystemMock.rename.mockRejectedValue(
            createFileSystemError("EPERM"),
        );

        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });

        expect(fileSystemMock.rename).toHaveBeenCalledTimes(8);
        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    "v1",
                    "src",
                    "App.tsx",
                ),
                "utf8",
            ),
        ).resolves.toBe("permanently locked candidate");
        await expect(listSavingDirectories(workspaceRoot)).resolves.toEqual(
            [],
        );
    });

    it("copies root configs and custom task files while excluding runtime directories", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "scripts"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "vite.config.ts"),
            "export default { base: '/portal/' };",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "custom-root.json"),
            '{"theme":"wenzhou"}',
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "scripts", "generate-routes.ts"),
            "export const routes = ['home', 'food'];",
            "utf8",
        );

        for (const excludedDirectory of [
            "node_modules",
            "dist",
            ".git",
            "temp",
            ".saving-orphan",
            path.join("versions", "legacy"),
        ]) {
            await mkdir(path.join(workspaceRoot, excludedDirectory), {
                recursive: true,
            });
            await writeFile(
                path.join(workspaceRoot, excludedDirectory, "marker.txt"),
                "runtime only",
                "utf8",
            );
        }

        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });

        const snapshotRoot = path.join(workspaceRoot, "versions", "v1");

        await expect(
            readFile(path.join(snapshotRoot, "vite.config.ts"), "utf8"),
        ).resolves.toBe("export default { base: '/portal/' };");
        await expect(
            readFile(path.join(snapshotRoot, "custom-root.json"), "utf8"),
        ).resolves.toBe('{"theme":"wenzhou"}');
        await expect(
            readFile(
                path.join(snapshotRoot, "scripts", "generate-routes.ts"),
                "utf8",
            ),
        ).resolves.toContain("home");

        for (const excludedPath of [
            path.join("node_modules", "marker.txt"),
            path.join("dist", "marker.txt"),
            path.join(".git", "marker.txt"),
            path.join("temp", "marker.txt"),
            path.join(".saving-orphan", "marker.txt"),
            path.join("versions", "legacy", "marker.txt"),
        ]) {
            await expect(
                readFile(path.join(snapshotRoot, excludedPath), "utf8"),
            ).rejects.toMatchObject({ code: "ENOENT" });
        }
    });

    it("deletes only the requested snapshot", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        for (const versionNumber of [1, 2, 3]) {
            await mkdir(
                path.join(workspaceRoot, "versions", `v${versionNumber}`, "src"),
                { recursive: true },
            );
            await writeFile(
                path.join(
                    workspaceRoot,
                    "versions",
                    `v${versionNumber}`,
                    "src",
                    "App.tsx",
                ),
                `version ${versionNumber}`,
                "utf8",
            );
        }

        await deleteRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 2,
        });

        await expect(
            readFile(
                path.join(workspaceRoot, "versions", "v1", "src", "App.tsx"),
                "utf8",
            ),
        ).resolves.toBe("version 1");
        await expect(
            readFile(
                path.join(workspaceRoot, "versions", "v2", "src", "App.tsx"),
                "utf8",
            ),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
            readFile(
                path.join(workspaceRoot, "versions", "v3", "src", "App.tsx"),
                "utf8",
            ),
        ).resolves.toBe("version 3");
    });

    it("restores a snapshot without deleting version history", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "current version",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "vite.config.ts"),
            "export default { base: '/saved/' };",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "custom-root.txt"),
            "saved custom file",
            "utf8",
        );
        await saveRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "newer version",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "vite.config.ts"),
            "export default { base: '/newer/' };",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "custom-root.txt"),
            "newer custom file",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "newer-only.config.ts"),
            "export default {};",
            "utf8",
        );
        await mkdir(path.join(workspaceRoot, "newer-only-directory"), {
            recursive: true,
        });
        await writeFile(
            path.join(
                workspaceRoot,
                "newer-only-directory",
                "stale.ts",
            ),
            "stale",
            "utf8",
        );
        await mkdir(path.join(workspaceRoot, "public"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "public", "newer-only.txt"),
            "must be removed",
            "utf8",
        );
        await mkdir(path.join(workspaceRoot, "node_modules"), {
            recursive: true,
        });
        await writeFile(
            path.join(workspaceRoot, "node_modules", "runtime-cache.txt"),
            "keep runtime cache",
            "utf8",
        );
        await mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "dist", "runtime-build.txt"),
            "keep runtime build",
            "utf8",
        );

        await restoreRunVersionSnapshot({
            workspaceRoot,
            versionNumber: 1,
        });

        await expect(
            readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).resolves.toBe("current version");
        await expect(
            readFile(path.join(workspaceRoot, "vite.config.ts"), "utf8"),
        ).resolves.toBe("export default { base: '/saved/' };");
        await expect(
            readFile(path.join(workspaceRoot, "custom-root.txt"), "utf8"),
        ).resolves.toBe("saved custom file");
        await expect(
            readFile(
                path.join(workspaceRoot, "versions", "v1", "src", "App.tsx"),
                "utf8",
            ),
        ).resolves.toBe("current version");
        await expect(
            readFile(
                path.join(workspaceRoot, "public", "newer-only.txt"),
                "utf8",
            ),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
            readFile(
                path.join(workspaceRoot, "newer-only.config.ts"),
                "utf8",
            ),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "newer-only-directory",
                    "stale.ts",
                ),
                "utf8",
            ),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
            readFile(
                path.join(
                    workspaceRoot,
                    "node_modules",
                    "runtime-cache.txt",
                ),
                "utf8",
            ),
        ).resolves.toBe("keep runtime cache");
        await expect(
            readFile(
                path.join(workspaceRoot, "dist", "runtime-build.txt"),
                "utf8",
            ),
        ).resolves.toBe("keep runtime build");
    });

    it("fails instead of silently succeeding when a snapshot is missing", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-version-snapshot-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            restoreRunVersionSnapshot({
                workspaceRoot,
                versionNumber: 99,
            }),
        ).rejects.toThrow("Version snapshot not found");
    });
});
