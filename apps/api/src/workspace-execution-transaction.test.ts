import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeWithWorkspaceRollback } from "./workspace-execution-transaction.js";

describe("executeWithWorkspaceRollback", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    it("keeps workspace changes when execution succeeds", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-transaction-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const appPath = path.join(workspaceRoot, "App.tsx");
        await writeFile(appPath, "before", "utf8");

        const result = await executeWithWorkspaceRollback({
            workspaceRoot,
            execute: async () => {
                await writeFile(appPath, "after", "utf8");
                return "completed";
            },
        });

        await expect(readFile(appPath, "utf8")).resolves.toBe("after");
        expect(result).toBe("completed");
    });

    it("returns the complete result while restoring a rejected workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-transaction-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const appPath = path.join(workspaceRoot, "App.tsx");
        await writeFile(appPath, "accepted version", "utf8");
        const rejectedResult = {
            review: {
                accepted: false,
                reason: "The requested change was not completed",
            },
            trace: ["planner", "builder", "reviewer"],
        };

        const result = await executeWithWorkspaceRollback({
            workspaceRoot,
            execute: async () => {
                await writeFile(appPath, "rejected draft", "utf8");
                await writeFile(
                    path.join(workspaceRoot, "unfinished.ts"),
                    "partial",
                    "utf8",
                );
                return rejectedResult;
            },
            rollbackWhen: (executionResult) =>
                !executionResult.review.accepted,
        });

        expect(result).toBe(rejectedResult);
        await expect(readFile(appPath, "utf8")).resolves.toBe(
            "accepted version",
        );
        await expect(
            readFile(path.join(workspaceRoot, "unfinished.ts"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("restores the complete workspace when execution throws", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-transaction-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const appPath = path.join(workspaceRoot, "App.tsx");
        await writeFile(appPath, "stable version", "utf8");

        await expect(
            executeWithWorkspaceRollback({
                workspaceRoot,
                execute: async () => {
                    await writeFile(appPath, "partial draft", "utf8");
                    await writeFile(
                        path.join(workspaceRoot, "partial.ts"),
                        "incomplete",
                        "utf8",
                    );
                    throw new Error("Model request timed out");
                },
            }),
        ).rejects.toThrow("Model request timed out");

        await expect(readFile(appPath, "utf8")).resolves.toBe(
            "stable version",
        );
        await expect(
            readFile(path.join(workspaceRoot, "partial.ts"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rolls source back without copying dependency caches or version history", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-transaction-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const appPath = path.join(workspaceRoot, "App.tsx");
        const dependencyCachePath = path.join(
            workspaceRoot,
            "node_modules",
            "cache.txt",
        );
        const versionPath = path.join(
            workspaceRoot,
            "versions",
            "v1",
            "App.tsx",
        );
        await writeFile(appPath, "accepted source", "utf8");
        await Promise.all([
            mkdir(path.dirname(dependencyCachePath), { recursive: true }),
            mkdir(path.dirname(versionPath), { recursive: true }),
        ]);
        await writeFile(dependencyCachePath, "warm cache", "utf8");
        await writeFile(versionPath, "accepted snapshot", "utf8");

        await executeWithWorkspaceRollback({
            workspaceRoot,
            execute: async () => {
                await writeFile(appPath, "rejected source", "utf8");
                await writeFile(dependencyCachePath, "updated cache", "utf8");
                await writeFile(versionPath, "accepted snapshot", "utf8");
                return { accepted: false };
            },
            rollbackWhen: (result) => !result.accepted,
        });

        await expect(readFile(appPath, "utf8")).resolves.toBe(
            "accepted source",
        );
        await expect(readFile(dependencyCachePath, "utf8")).resolves.toBe(
            "updated cache",
        );
        await expect(readFile(versionPath, "utf8")).resolves.toBe(
            "accepted snapshot",
        );
    });

    it("preserves a partial draft when the caller requests recovery", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-transaction-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const appPath = path.join(workspaceRoot, "App.tsx");
        await writeFile(appPath, "stable version", "utf8");

        await expect(
            executeWithWorkspaceRollback({
                workspaceRoot,
                preserveWorkspaceOnError: true,
                execute: async () => {
                    await writeFile(appPath, "reviewable partial draft", "utf8");
                    throw new Error("Reviewer timed out");
                },
            }),
        ).rejects.toThrow("Reviewer timed out");

        await expect(readFile(appPath, "utf8")).resolves.toBe(
            "reviewable partial draft",
        );
    });
});
