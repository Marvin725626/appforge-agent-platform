import { describe, expect, it } from "vitest";

import {
    formatMemoryContext,
    MemoryRepository,
} from "./memory-repository.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMemoryRepository } from "./file-memory-repository.js";
describe("MemoryRepository", () => {
    it("stores memory entries", () => {
        const repository = new MemoryRepository();

        repository.save({
            id: "memory-1",
            runId: "run-1",
            goal: "Create a task app",
            outcome: "succeeded",
            summary: "Generated and built a task app successfully.",
            createdAt: "2026-07-03T00:00:00.000Z",
        });

        expect(repository.list()).toEqual([
            {
                id: "memory-1",
                runId: "run-1",
                goal: "Create a task app",
                outcome: "succeeded",
                summary: "Generated and built a task app successfully.",
                createdAt: "2026-07-03T00:00:00.000Z",
            },
        ]);
    });
});
describe("formatMemoryContext", () => {
    it("returns an empty string when there is no memory", () => {
        expect(formatMemoryContext([])).toBe("");
    });

    it("formats memory entries for agent context", () => {
        const result = formatMemoryContext([
            {
                id: "memory-1",
                runId: "run-1",
                goal: "Create a task app",
                outcome: "succeeded",
                summary: "Review: ok Attempts: 1 Eval: 4/4 checks passed Build exit code: 0",
                createdAt: "2026-07-03T00:00:00.000Z",
            },
        ]);

        expect(result).toBe(
            [
                "Recent memory:",
                "- Goal: Create a task app",
                "  Outcome: succeeded",
                "  Summary: Review: ok Attempts: 1 Eval: 4/4 checks passed Build exit code: 0",
            ].join("\n"),
        );
    });
});
describe("FileMemoryRepository", () => {
    it("returns an empty list when the store file does not exist", async () => {
        const temporaryRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-memory-"),
        );

        try {
            const repository = new FileMemoryRepository(
                path.join(temporaryRoot, "memory.json"),
            );

            expect(await repository.list()).toEqual([]);
        } finally {
            await rm(temporaryRoot, {
                recursive: true,
                force: true,
            });
        }
    });

    it("persists memory entries to disk", async () => {
        const temporaryRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-memory-"),
        );

        try {
            const storePath = path.join(temporaryRoot, "memory.json");
            const repository = new FileMemoryRepository(storePath);

            await repository.save({
                id: "memory-1",
                runId: "run-1",
                goal: "Create a task app",
                outcome: "succeeded",
                summary: "Generated and built a task app successfully.",
                createdAt: "2026-07-03T00:00:00.000Z",
            });

            const reloadedRepository = new FileMemoryRepository(storePath);

            expect(await reloadedRepository.list()).toEqual([
                {
                    id: "memory-1",
                    runId: "run-1",
                    goal: "Create a task app",
                    outcome: "succeeded",
                    summary: "Generated and built a task app successfully.",
                    createdAt: "2026-07-03T00:00:00.000Z",
                },
            ]);
        } finally {
            await rm(temporaryRoot, {
                recursive: true,
                force: true,
            });
        }
    });
});