import { describe, expect, it } from "vitest";

import {
    compactMemoryEntries,
    shouldCompactMemory,
} from "./memory-compactor.js";

describe("compactMemoryEntries", () => {
    it("returns undefined when there are no memory entries", () => {
        expect(
            compactMemoryEntries({
                entries: [],
                now: new Date("2026-07-08T00:00:00.000Z"),
            }),
        ).toBeUndefined();
    });

    it("creates a summary from memory entries", () => {
        const summary = compactMemoryEntries({
            entries: [
                {
                    id: "memory-1",
                    runId: "run-1",
                    goal: "Create a task app",
                    outcome: "succeeded",
                    summary: "Review: ok Attempts: 1 Eval: 5/5 checks passed Build exit code: 0",
                    createdAt: "2026-07-07T00:00:00.000Z",
                },
                {
                    id: "memory-2",
                    runId: "run-2",
                    goal: "Create a Chinese Wenzhou landing page",
                    outcome: "waiting_for_human",
                    summary: "Review requested more Chinese copy.",
                    createdAt: "2026-07-07T01:00:00.000Z",
                },
                {
                    id: "memory-3",
                    runId: "run-3",
                    goal: "Create a broken app",
                    outcome: "failed",
                    summary: "Build failed.",
                    createdAt: "2026-07-07T02:00:00.000Z",
                },
            ],
            now: new Date("2026-07-08T00:00:00.000Z"),
        });

        expect(summary).toEqual({
            id: "summary-2026-07-08T00:00:00.000Z",
            createdAt: "2026-07-08T00:00:00.000Z",
            sourceMemoryIds: ["memory-1", "memory-2", "memory-3"],
            content: [
                "Long-term lessons:",
                "- Source memories: 3",
                "- Successful runs: 1",
                "- Failed runs: 1",
                "- Waiting for human review: 1",
                "- Recent goals:",
                "- Create a task app",
                "- Create a Chinese Wenzhou landing page",
                "- Create a broken app",
            ].join("\n"),
        });
    });
});
describe("shouldCompactMemory", () => {
    it("returns false when memory count is below the threshold", () => {
        expect(
            shouldCompactMemory({
                memoryCount: 9,
                summaryCount: 0,
                threshold: 10,
            }),
        ).toBe(false);
    });

    it("returns true when memory count reaches the threshold and no summary exists", () => {
        expect(
            shouldCompactMemory({
                memoryCount: 10,
                summaryCount: 0,
                threshold: 10,
            }),
        ).toBe(true);
    });

    it("returns false when a summary already exists", () => {
        expect(
            shouldCompactMemory({
                memoryCount: 10,
                summaryCount: 1,
                threshold: 10,
            }),
        ).toBe(false);
    });
});