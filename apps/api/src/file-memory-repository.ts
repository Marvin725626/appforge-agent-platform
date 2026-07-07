import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type {
    MemoryEntry,
    MemoryRepositoryLike,
} from "./memory-repository.js";

const MemoryEntrySchema = z.object({
   id:z.string(),
   runId:z.string(),
    goal: z.string(),
    outcome: z.enum(["succeeded", "waiting_for_human", "failed"]),
    summary: z.string(),
    createdAt: z.string(),
});

const MemoryStoreSchema = z.object({
    memories:z.array(MemoryEntrySchema).default([]),
});

type MemoryStore = {
    memories:MemoryEntry[];
};

function emptyMemoryStore():MemoryStore{
    return {
        memories:[],
    };
}

export class FileMemoryRepository implements MemoryRepositoryLike {
    constructor(private readonly storePath: string) {}
    async list():Promise<MemoryEntry[]>{
        const store = await this.readStore();
        return store.memories;
    }
    async save(entry:MemoryEntry):Promise<void>{
        const store = await this.readStore();
        store.memories.push(entry);
        await this.writeStore(store);
    }
    private async readStore(): Promise<MemoryStore> {
        try {
            const content = await readFile(this.storePath, "utf8");
            const parsedStore = MemoryStoreSchema.parse(JSON.parse(content));

            return {
                memories: parsedStore.memories,
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
        await mkdir(path.dirname(this.storePath),{
           recursive:true,
        });
        await writeFile(
            this.storePath,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8",
        );
    }
}