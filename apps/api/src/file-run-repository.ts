import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RunSchema, type Run } from "@appforge/protocol";
import { z } from "zod";

import type { RunReactAppAgentResult } from "./run-react-app-agent.js";
import type { RunRepositoryLike } from "./run-repository.js";

const StoreSchema = z.object({
    runs: z.array(RunSchema),
    results: z.record(z.string(), z.unknown()),
});

type StoreData = {
    runs: Run[];
    results: Record<string, RunReactAppAgentResult>;
};

function emptyStore(): StoreData {
    return {
        runs: [],
        results: {},
    };
}

export class FileRunRepository implements RunRepositoryLike {
    constructor(private readonly storePath: string) {}

    async list(): Promise<Run[]> {
        const store = await this.readStore();

        return store.runs;
    }

    async save(run: Run): Promise<Run> {
        const store = await this.readStore();
        const existingIndex = store.runs.findIndex(
            (existingRun) => existingRun.id === run.id,
        );

        if (existingIndex >= 0) {
            store.runs[existingIndex] = run;
        } else {
            store.runs.push(run);
        }

        await this.writeStore(store);

        return run;
    }

    async findById(id: string): Promise<Run | undefined> {
        const store = await this.readStore();

        return store.runs.find((run) => run.id === id);
    }

    async deleteById(id: string): Promise<boolean> {
        const store = await this.readStore();
        const initialRunCount = store.runs.length;

        store.runs = store.runs.filter((run) => run.id !== id);
        delete store.results[id];

        const deletedRun = store.runs.length !== initialRunCount;

        if (deletedRun) {
            await this.writeStore(store);
        }

        return deletedRun;
    }

    async saveResult(
        runId: string,
        result: RunReactAppAgentResult,
    ): Promise<void> {
        const store = await this.readStore();
        store.results[runId] = result;

        await this.writeStore(store);
    }

    async findResultByRunId(
        runId: string,
    ): Promise<RunReactAppAgentResult | undefined> {
        const store = await this.readStore();

        return store.results[runId];
    }

    private async readStore(): Promise<StoreData> {
        try {
            const rawStore = await readFile(this.storePath, "utf8");
            const parsedStore = StoreSchema.parse(JSON.parse(rawStore));

            return {
                runs: parsedStore.runs,
                results: parsedStore.results as Record<
                    string,
                    RunReactAppAgentResult
                >,
            };
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return emptyStore();
            }

            throw error;
        }
    }

    private async writeStore(store: StoreData): Promise<void> {
        await mkdir(path.dirname(this.storePath), {
            recursive: true,
        });

        await writeFile(
            this.storePath,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8",
        );
    }
}
