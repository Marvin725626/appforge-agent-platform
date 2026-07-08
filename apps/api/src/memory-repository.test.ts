import { describe, expect, it } from "vitest";

import {
    formatAgentMemoryContext,
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

    it("uses only the most recent memory entries when maxEntries is set", () => {
        const result = formatMemoryContext(
            [
                {
                    id: "memory-1",
                    runId: "run-1",
                    goal: "Create a weather app",
                    outcome: "succeeded",
                    summary: "Old memory.",
                    createdAt: "2026-07-03T00:00:00.000Z",
                },
                {
                    id: "memory-2",
                    runId: "run-2",
                    goal: "Create a task app",
                    outcome: "succeeded",
                    summary: "Recent memory.",
                    createdAt: "2026-07-04T00:00:00.000Z",
                },
            ],
            {
                maxEntries: 1,
            },
        );

        expect(result).not.toContain("Create a weather app");
        expect(result).toContain("Create a task app");
    });

    it("limits the total memory context length", () => {
        const result = formatMemoryContext(
            [
                {
                    id: "memory-1",
                    runId: "run-1",
                    goal: "Create a task app",
                    outcome: "succeeded",
                    summary: "Generated and built a task app successfully.",
                    createdAt: "2026-07-03T00:00:00.000Z",
                },
            ],
            {
                maxCharacters: 20,
            },
        );

        expect(result.length).toBeLessThanOrEqual(20);
    });
});
describe("formatAgentMemoryContext", () => {
    it("combines long-term summaries and recent memory entries", () => {
        const result = formatAgentMemoryContext({
            summaries: [
                {
                    id: "summary-1",
                    content: [
                        "Long-term lessons:",
                        "- Prefer Chinese UI copy when the goal is written in Chinese.",
                    ].join("\n"),
                    sourceMemoryIds: ["memory-1"],
                    createdAt: "2026-07-08T00:00:00.000Z",
                },
            ],
            entries: [
                {
                    id: "memory-2",
                    runId: "run-2",
                    goal: "Create a task app",
                    outcome: "succeeded",
                    summary: "Review: ok Attempts: 1 Eval: 5/5 checks passed Build exit code: 0",
                    createdAt: "2026-07-08T01:00:00.000Z",
                },
            ],
            maxEntries: 5,
            maxCharacters: 1000,
        });

        expect(result).toBe(
            [
                "Long-term memory:",
                "Long-term lessons:",
                "- Prefer Chinese UI copy when the goal is written in Chinese.",
                "",
                "Recent memory:",
                "- Goal: Create a task app",
                "  Outcome: succeeded",
                "  Summary: Review: ok Attempts: 1 Eval: 5/5 checks passed Build exit code: 0",
            ].join("\n"),
        );
    });

    it("limits the combined memory context length", () => {
        const result = formatAgentMemoryContext({
            summaries: [
                {
                    id: "summary-1",
                    content: "Long-term lessons: keep generated apps buildable.",
                    sourceMemoryIds: ["memory-1"],
                    createdAt: "2026-07-08T00:00:00.000Z",
                },
            ],
            entries: [],
            maxCharacters: 20,
        });

        expect(result.length).toBeLessThanOrEqual(20);
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
    it("persists memory summaries to disk", async () => {
        const temporaryRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-memory-"),
        );

        try {
            const storePath = path.join(temporaryRoot, "memory.json");
            const repository = new FileMemoryRepository(storePath);

            await repository.saveSummary({
                id: "summary-1",
                content: [
                    "Long-term lessons:",
                    "- Prefer Chinese UI copy when the goal is written in Chinese.",
                    "- Keep App.tsx exports aligned with main.tsx imports.",
                ].join("\n"),
                sourceMemoryIds: ["memory-1", "memory-2"],
                createdAt: "2026-07-07T00:00:00.000Z",
            });

            const reloadedRepository = new FileMemoryRepository(storePath);

            expect(await reloadedRepository.listSummaries()).toEqual([
                {
                    id: "summary-1",
                    content: [
                        "Long-term lessons:",
                        "- Prefer Chinese UI copy when the goal is written in Chinese.",
                        "- Keep App.tsx exports aligned with main.tsx imports.",
                    ].join("\n"),
                    sourceMemoryIds: ["memory-1", "memory-2"],
                    createdAt: "2026-07-07T00:00:00.000Z",
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
