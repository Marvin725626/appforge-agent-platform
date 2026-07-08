import type { MemoryEntry, MemorySummary } from "./memory-repository.js";

export type CompactMemoryInput = {
    entries:MemoryEntry[];
    now?:Date;
};
export type ShouldCompactMemoryInput = {
    memoryCount:number;
    summaryCount:number;
    threshold?:number;
};

export function compactMemoryEntries(
  input:CompactMemoryInput,
):MemorySummary|undefined{
    if (input.entries.length === 0 ){
        return undefined;
    }

    const createdAt = (input.now ?? new Date()).toISOString();
    const sourceMemoryIds = input.entries.map((entry)=>entry.id);
    const succeededCount = input.entries.filter(
        (entry)=>entry.outcome === "succeeded",
    ).length;
    const failedCount = input.entries.filter(
        (entry) => entry.outcome === "failed",
    ).length;
    const waitingForHumanCount = input.entries.filter(
        (entry) => entry.outcome === "waiting_for_human",
    ).length;

    const recentGoals = input.entries
        .slice(-5)
        .map((entry) => `- ${entry.goal}`)
        .join("\n");

    const content = [
        "Long-term lessons:",
        `- Source memories: ${input.entries.length}`,
        `- Successful runs: ${succeededCount}`,
        `- Failed runs: ${failedCount}`,
        `- Waiting for human review: ${waitingForHumanCount}`,
        "- Recent goals:",
        recentGoals,
    ].join("\n");
    return {
        id: `summary-${createdAt}`,
        content,
        sourceMemoryIds,
        createdAt,
    };
}
export function shouldCompactMemory(
    input:ShouldCompactMemoryInput,
):boolean{
    const threshold = input.threshold ?? 10;

    return input.memoryCount >= threshold && input.summaryCount === 0;
}