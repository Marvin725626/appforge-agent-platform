export type MemoryEntry = {
    id: string;
    runId: string;
    goal: string;
    outcome: "succeeded" | "waiting_for_human" | "failed";
    summary: string;
    createdAt: string;
};
export interface MemoryRepositoryLike{
    list():MemoryEntry[] | Promise<MemoryEntry[]>;
    save(entry:MemoryEntry):void | Promise<void>;
}
export class MemoryRepository implements MemoryRepositoryLike {
    private readonly entries: MemoryEntry[] = [];

    list(): MemoryEntry[] {
        return [...this.entries];
    }

    save(entry: MemoryEntry): void {
        this.entries.push(entry);
    }
}

export function formatMemoryContext(entries:MemoryEntry[]):string{
    if (entries.length === 0) {
        return "";
    }
        return [
            "Recent memory:",
            ...entries.map(
                (entry) =>
                    [
                        `- Goal: ${entry.goal}`,
                        `  Outcome: ${entry.outcome}`,
                        `  Summary: ${entry.summary}`,
                    ].join("\n"),
            ),
        ].join("\n");
    }