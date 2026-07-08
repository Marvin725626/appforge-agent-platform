import type { MemoryEntry } from "./memory-repository.js";

export type RetrieveRelevantMemoryInput = {
    goal:string;
    entries:MemoryEntry[];
    maxEntries?:number;
};

function tokenize(text:string):string[]{
    return text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function scoreMemory(goalTokens:string[],entry:MemoryEntry):number{
    const memoryText = `${entry.goal} ${entry.summary}`.toLowerCase();

    return goalTokens.filter((token) => memoryText.includes(token)).length;
}

export function retrieveRelevantMemory(
    input: RetrieveRelevantMemoryInput,
): MemoryEntry[] {
    const maxEntries = input.maxEntries ?? 5;
    const goalTokens = tokenize(input.goal);
    if(goalTokens.length === 0 || input.entries.length === 0){
        return input.entries.slice(-maxEntries);
    }

    return input.entries
        .map((entry, index) => ({
            entry,
            index,
            score: scoreMemory(goalTokens, entry),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => {
            if (right.score !== left.score) {
                return right.score - left.score;
            }

            return right.index - left.index;
        })
        .slice(0, maxEntries)
        .map((candidate) => candidate.entry);
}