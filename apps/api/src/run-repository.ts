import type { Run,RunVersion } from "@appforge/protocol";
import type {RunReactAppAgentResult} from "./run-react-app-agent.js";

export type RunRepositoryLike = {
    list(): Run[] | Promise<Run[]>;
    save(run: Run): Run | Promise<Run>;
    findById(id: string): Run | undefined | Promise<Run | undefined>;
    deleteById(id: string): boolean | Promise<boolean>;
    listVersions(runId: string): RunVersion[] | Promise<RunVersion[]>;
    saveVersion(version: RunVersion): RunVersion | Promise<RunVersion>;
    replaceVersions(
        runId: string,
        versions: RunVersion[],
    ): void | Promise<void>;
    deleteVersions(runId: string): void | Promise<void>;
    saveResult(
        runId: string,
        result: RunReactAppAgentResult,
    ): void | Promise<void>;
    findResultByRunId(
        runId: string,
    ): RunReactAppAgentResult | undefined | Promise<RunReactAppAgentResult | undefined>;
};

export class RunRepository implements RunRepositoryLike{
    private readonly runs = new Map<string,Run>();
    private readonly results = new Map<string, RunReactAppAgentResult>();
    private readonly versions = new Map<string,RunVersion[]>();
    list(): Run[] {
        return [...this.runs.values()];
    }

    save(run:Run):Run{
        this.runs.set(run.id,run);
        return run;
    }
    findById(id:string):Run | undefined{
        return  this.runs.get(id);
    }
    deleteById(id: string): boolean {
        const deletedRun = this.runs.delete(id);
        this.results.delete(id);
        this.deleteVersions(id);
        return deletedRun;
    }
    saveResult(runId: string, result: RunReactAppAgentResult): void {
        this.results.set(runId, result);
    }

    findResultByRunId(runId: string): RunReactAppAgentResult | undefined {
        return this.results.get(runId);
    }
    listVersions(runId: string):RunVersion[]{
        return this.versions.get(runId)??[];
    }

    saveVersion(version:RunVersion):RunVersion{
        const existingVersions = this.versions.get(version.runId) ?? [];
        const conflictingVersion = existingVersions.find(
            (candidate) =>
                candidate.versionNumber === version.versionNumber &&
                candidate.id !== version.id,
        );

        if (conflictingVersion) {
            throw new Error(
                `Run ${version.runId} already has version ${version.versionNumber}`,
            );
        }

        const existingIndex = existingVersions.findIndex(
            (candidate) => candidate.id === version.id,
        );

        if (existingIndex >= 0) {
            const updatedVersions = [...existingVersions];
            updatedVersions[existingIndex] = version;
            this.versions.set(version.runId, updatedVersions);
        } else {
            this.versions.set(version.runId,[...existingVersions, version]);
        }

        return version;
    }

    replaceVersions(runId: string, versions: RunVersion[]): void {
        this.versions.set(runId, [...versions]);
    }

    deleteVersions(runId:string):void{
        this.versions.delete(runId);
    }
}
