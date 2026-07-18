import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import type {
    MemoryEntry,
    MemoryRepositoryLike,
    MemorySummary,
} from "./memory-repository.js";

const MemoryEntrySchema = z.object({
    id: z.string(),
    runId: z.string(),
    goal: z.string(),
    outcome: z.enum(["succeeded", "waiting_for_human", "failed"]),
    summary: z.string(),
    createdAt: z.string(),
});

const MemorySummarySchema = z.object({
    id: z.string(),
    content: z.string(),
    sourceMemoryIds: z.array(z.string()),
    createdAt: z.string(),
});

const MemoryStoreSchema = z.object({
    memories: z.array(MemoryEntrySchema).default([]),
    summaries: z.array(MemorySummarySchema).default([]),
});

type MemoryStore = {
    memories: MemoryEntry[];
    summaries: MemorySummary[];
};

function emptyMemoryStore(): MemoryStore {
    return {
        memories: [],
        summaries: [],
    };
}

export class FileMemoryRepository implements MemoryRepositoryLike {
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private readonly storePath: string) {}

    async list(): Promise<MemoryEntry[]> {
        const store = await this.readStore();
        return store.memories;
    }

    async save(entry: MemoryEntry): Promise<void> {
        await this.withWriteLock(async () => {
            const store = await this.readStore();
            store.memories.push(entry);
            await this.writeStore(store);
        });
    }

    async listSummaries(): Promise<MemorySummary[]> {
        const store = await this.readStore();
        return store.summaries;
    }

    async saveSummary(summary: MemorySummary): Promise<void> {
        await this.withWriteLock(async () => {
            const store = await this.readStore();
            store.summaries.push(summary);
            await this.writeStore(store);
        });
    }

    private async readStore(): Promise<MemoryStore> {
        try {
            const content = await readFile(this.storePath, "utf8");
            const parsedStore = MemoryStoreSchema.parse(JSON.parse(content));

            return {
                memories: parsedStore.memories,
                summaries: parsedStore.summaries,
            };
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return emptyMemoryStore();
            }

            throw error;
        }
    }

    private async writeStore(store: MemoryStore): Promise<void> {
        await mkdir(path.dirname(this.storePath), {
            recursive: true,
        });

        const temporaryStorePath = `${this.storePath}.${randomUUID()}.tmp`;

        await writeFile(
            temporaryStorePath,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8",
        );
        await rename(temporaryStorePath, this.storePath);
    }

    private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
        const previousWrite = this.writeQueue;
        let releaseWrite: () => void = () => undefined;
        this.writeQueue = new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });

        await previousWrite;

        try {
            return await operation();
        } finally {
            releaseWrite();
        }
    }
}
