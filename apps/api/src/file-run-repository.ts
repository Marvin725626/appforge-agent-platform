import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    RunSchema,
    RunVersionSchema,
    type Run,
    type RunVersion,
} from "@appforge/protocol";
import { z } from "zod";

import type { RunReactAppAgentResult } from "./run-react-app-agent.js";
import type { RunRepositoryLike } from "./run-repository.js";

const StoreSchema = z.object({
    runs: z.array(RunSchema),
    results: z.record(z.string(), z.unknown()),
    versions: z.record(z.string(), z.array(RunVersionSchema)).default({}),
});

type StoreData = {
    runs: Run[];
    results: Record<string, RunReactAppAgentResult>;
    versions: Record<string, RunVersion[]>;
};

function emptyStore(): StoreData {
    return {
        runs: [],
        results: {},
        versions: {},
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
        delete store.versions[id];

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

    async listVersions(runId: string): Promise<RunVersion[]> {
        const store = await this.readStore();

        return store.versions[runId] ?? [];
    }

    async saveVersion(version: RunVersion): Promise<RunVersion> {
        const store = await this.readStore();
        const existingVersions = store.versions[version.runId] ?? [];

        store.versions[version.runId] = [...existingVersions, version];

        await this.writeStore(store);

        return version;
    }

    async deleteVersions(runId: string): Promise<void> {
        const store = await this.readStore();
        delete store.versions[runId];

        await this.writeStore(store);
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
                versions: parsedStore.versions,
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
