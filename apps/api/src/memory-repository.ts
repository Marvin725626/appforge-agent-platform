export type MemoryEntry = {
    id: string;
    runId: string;
    goal: string;
    outcome: "succeeded" | "waiting_for_human" | "failed";
    summary: string;
    createdAt: string;
};
export type MemorySummary = {
    id: string;
    content: string;
    sourceMemoryIds: string[];
    createdAt: string;
};

export interface MemoryRepositoryLike {
    list(): MemoryEntry[] | Promise<MemoryEntry[]>;
    save(entry: MemoryEntry): void | Promise<void>;
    listSummaries(): MemorySummary[] | Promise<MemorySummary[]>;
    saveSummary(summary: MemorySummary): void | Promise<void>;
}

export class MemoryRepository implements MemoryRepositoryLike {
    private readonly entries: MemoryEntry[] = [];
    private readonly summaries: MemorySummary[] = [];

    list(): MemoryEntry[] {
        return [...this.entries];
    }

    save(entry: MemoryEntry): void {
        this.entries.push(entry);
    }

    listSummaries(): MemorySummary[] {
        return [...this.summaries];
    }

    saveSummary(summary: MemorySummary): void {
        this.summaries.push(summary);
    }
}

export type FormatMemoryContextOptions = {
    maxEntries?: number;
    maxCharacters?: number;
};

export function formatMemoryContext(
    entries: MemoryEntry[],
    options: FormatMemoryContextOptions = {},
): string {
    const maxEntries = Math.max(
        0,
        Math.floor(options.maxEntries ?? entries.length),
    );
    const maxCharacters = options.maxCharacters ?? Number.POSITIVE_INFINITY;
    const selectedEntries = entries.slice(-maxEntries);

    if (maxEntries === 0 || selectedEntries.length === 0 || maxCharacters <= 0) {
        return "";
    }

    const context = [
        "Recent memory:",
        ...selectedEntries.map((entry) =>
            [
                `- Goal: ${entry.goal}`,
                `  Outcome: ${entry.outcome}`,
                `  Summary: ${entry.summary}`,
            ].join("\n"),
        ),
    ].join("\n");

    return context.slice(0, maxCharacters);
}

export function formatAgentMemoryContext(input: {
    entries: MemoryEntry[];
    summaries?: MemorySummary[];
    maxEntries?: number;
    maxCharacters?: number;
}): string {
    const summaryContext =
        input.summaries && input.summaries.length > 0
            ? [
                "Long-term memory:",
                ...input.summaries.map((summary) => summary.content),
            ].join("\n")
            : "";

    const recentOptions: FormatMemoryContextOptions = {};

    if (input.maxEntries !== undefined) {
        recentOptions.maxEntries = input.maxEntries;
    }

    if (input.maxCharacters !== undefined) {
        recentOptions.maxCharacters = input.maxCharacters;
    }

    const recentContext = formatMemoryContext(input.entries, recentOptions);

    return [summaryContext, recentContext]
        .filter((part) => part.length > 0)
        .join("\n\n")
        .slice(0, input.maxCharacters ?? Number.POSITIVE_INFINITY);
}
