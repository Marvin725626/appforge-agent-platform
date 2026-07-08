import { describe, expect, it } from "vitest";

import { retrieveRelevantMemory } from "./memory-retrieval.js";
import type { MemoryEntry } from "./memory-repository.js";

const memories: MemoryEntry[] = [
    {
        id: "memory-1",
        runId: "run-1",
        goal: "Create a task app",
        outcome: "succeeded",
        summary: "Generated a task list with input and add button.",
        createdAt: "2026-07-08T00:00:00.000Z",
    },
    {
        id: "memory-2",
        runId: "run-2",
        goal: "Create a Chinese Wenzhou landing page",
        outcome: "succeeded",
        summary: "Generated Chinese copy for food, attractions, and transportation.",
        createdAt: "2026-07-08T01:00:00.000Z",
    },
    {
        id: "memory-3",
        runId: "run-3",
        goal: "Fix Vite React export issue",
        outcome: "succeeded",
        summary: "Kept App.tsx exports aligned with main.tsx imports.",
        createdAt: "2026-07-08T02:00:00.000Z",
    },
];

describe("retrieveRelevantMemory", () => {
    it("returns memories that match the current goal", () => {
        const result = retrieveRelevantMemory({
            goal: "Build a Chinese Wenzhou travel page",
            entries: memories,
            maxEntries: 2,
        });

        expect(result.map((entry) => entry.id)).toEqual(["memory-2"]);
    });

    it("prefers newer memories when scores are tied", () => {
        const result = retrieveRelevantMemory({
            goal: "Create",
            entries: memories,
            maxEntries: 2,
        });

        expect(result.map((entry) => entry.id)).toEqual([
            "memory-2",
            "memory-1",
        ]);
    });

    it("falls back to recent memories when the goal has no useful tokens", () => {
        const result = retrieveRelevantMemory({
            goal: "!",
            entries: memories,
            maxEntries: 2,
        });

        expect(result.map((entry) => entry.id)).toEqual([
            "memory-2",
            "memory-3",
        ]);
    });
});
