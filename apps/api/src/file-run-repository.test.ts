import {
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    utimes,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Run } from "@appforge/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { FileRunRepository } from "./file-run-repository.js";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";

const temporaryDirectories: string[] = [];

const TEST_COORDINATION = {
    goal: "Create an app",
    plan: [],
    assignments: [],
};

async function createRepository() {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-file-runs-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const storePath = path.join(temporaryRoot, "runs.json");

    return {
        repository: new FileRunRepository(storePath),
        storePath,
    };
}

async function listRepositoryArtifacts(storePath: string): Promise<string[]> {
    return (await readdir(path.dirname(storePath))).filter(
        (entry) =>
            entry === `${path.basename(storePath)}.lock` ||
            (entry.startsWith(`${path.basename(storePath)}.`) &&
                entry.endsWith(".tmp")),
    );
}

function createFileSystemError(code: string): Error & { code: string } {
    return Object.assign(new Error(`simulated ${code}`), { code });
}

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.map((directory) =>
            rm(directory, {
                recursive: true,
                force: true,
            }),
        ),
    );

    temporaryDirectories.length = 0;
});

describe("FileRunRepository", () => {
    it("persists runs and results to a JSON file", async () => {
        const { repository, storePath } = await createRepository();

        const run: Run = {
            id: "run-1",
            goal: "Create an app",
            status: "queued",
            createdAt: "2026-06-30T00:00:00.000Z",
        };

        await repository.save(run);

        expect(await repository.findById("run-1")).toEqual(run);

        const result: RunReactAppAgentResult = {
            workspaceRoot: "workspace-1",
            coordination: TEST_COORDINATION,
            agent: {
                steps: [],
                finished: true,
            },
            install: {
                exitCode: 0,
                stdout: "install ok",
                stderr: "",
            },
            build: {
                exitCode: 0,
                stdout: "build ok",
                stderr: "",
            },
            eval: {
                passed: true,
                checks: [
                    {
                        name: "has input",
                        passed: true,
                    },
                    {
                        name: "has button",
                        passed: true,
                    },
                    {
                        name: "has task rendering",
                        passed: true,
                    },
                ],
            },
            review: {
                accepted: true,
                reason: "Agent finished and install/build/eval passed.",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: true,
                    evalPassed: true,
                },
            },
            attempts: [
                {
                    kind: "initial" as const,
                    agent: {
                        steps: [],
                        finished: true,
                    },
                    install: {
                        exitCode: 0,
                        stdout: "install ok",
                        stderr: "",
                    },
                    build: {
                        exitCode: 0,
                        stdout: "build ok",
                        stderr: "",
                    },
                    eval: {
                        passed: true,
                        checks: [
                            {
                                name: "has input",
                                passed: true,
                            },
                            {
                                name: "has button",
                                passed: true,
                            },
                            {
                                name: "has task rendering",
                                passed: true,
                            },
                        ],
                    },
                    review: {
                        accepted: true,
                        reason: "Agent finished and install/build/eval passed.",
                        checks: {
                            agentFinished: true,
                            installPassed: true,
                            buildPassed: true,
                            evalPassed: true,
                        },
                    },
                },
            ],
        };

        await repository.saveResult(run.id, result);

        const restoredRepository = new FileRunRepository(storePath);

        expect(await restoredRepository.findById("run-1")).toEqual(run);
        expect(await restoredRepository.findResultByRunId("run-1")).toEqual(
            result,
        );
    });

    it("updates an existing run instead of duplicating it", async () => {
        const { repository } = await createRepository();

        const run: Run = {
            id: "run-1",
            goal: "Create an app",
            status: "queued",
            createdAt: "2026-06-30T00:00:00.000Z",
        };

        await repository.save(run);
        await repository.save({
            ...run,
            status: "succeeded",
        });

        expect(await repository.findById("run-1")).toEqual({
            ...run,
            status: "succeeded",
        });
    });

    it("keeps concurrent run saves instead of losing one update", async () => {
        const { repository } = await createRepository();
        const createdAt = "2026-07-10T00:00:00.000Z";

        await Promise.all([
            repository.save({
                id: "run-1",
                goal: "Create the first app",
                status: "queued",
                createdAt,
            }),
            repository.save({
                id: "run-2",
                goal: "Create the second app",
                status: "queued",
                createdAt,
            }),
        ]);

        expect((await repository.list()).map((run) => run.id).sort()).toEqual([
            "run-1",
            "run-2",
        ]);
    });

    it("serializes concurrent updates from separate repository instances", async () => {
        const { repository, storePath } = await createRepository();
        const secondRepository = new FileRunRepository(storePath);
        const createdAt = "2026-07-10T00:00:00.000Z";

        await Promise.all(
            Array.from({ length: 12 }, (_, index) => {
                const targetRepository =
                    index % 2 === 0 ? repository : secondRepository;

                return targetRepository.save({
                    id: `run-${index + 1}`,
                    goal: `Create app ${index + 1}`,
                    status: "queued",
                    createdAt,
                });
            }),
        );

        expect((await repository.list()).map((run) => run.id).sort()).toEqual(
            Array.from({ length: 12 }, (_, index) => `run-${index + 1}`).sort(),
        );
        expect(await listRepositoryArtifacts(storePath)).toEqual([]);
    });

    it("retries transient Windows rename errors and then commits the store", async () => {
        const { storePath } = await createRepository();
        let renameAttempts = 0;
        const repository = new FileRunRepository(storePath, {
            renameFile: async (...args: Parameters<typeof rename>) => {
                renameAttempts += 1;

                if (renameAttempts < 3) {
                    throw createFileSystemError("EPERM");
                }

                await rename(...args);
            },
            renameMaxAttempts: 3,
            renameBaseDelayMs: 0,
            sleep: async () => undefined,
        });

        await repository.save({
            id: "run-retried",
            goal: "Persist after a transient Windows lock",
            status: "queued",
            createdAt: "2026-07-10T00:00:00.000Z",
        });

        expect(renameAttempts).toBe(3);
        expect(await repository.findById("run-retried")).toMatchObject({
            id: "run-retried",
        });
        expect(await listRepositoryArtifacts(storePath)).toEqual([]);
    });

    it("cleans its temporary file and lock after a permanent rename failure", async () => {
        const { storePath } = await createRepository();
        let renameAttempts = 0;
        const repository = new FileRunRepository(storePath, {
            renameFile: async () => {
                renameAttempts += 1;
                throw createFileSystemError("EACCES");
            },
            renameMaxAttempts: 3,
            renameBaseDelayMs: 0,
            sleep: async () => undefined,
        });

        await expect(
            repository.save({
                id: "run-failed",
                goal: "This write cannot be renamed",
                status: "queued",
                createdAt: "2026-07-10T00:00:00.000Z",
            }),
        ).rejects.toMatchObject({ code: "EACCES" });

        expect(renameAttempts).toBe(3);
        expect(await listRepositoryArtifacts(storePath)).toEqual([]);
    });

    it("recovers an old lock only when its owner is no longer alive", async () => {
        const { storePath } = await createRepository();
        const lockPath = `${storePath}.lock`;
        const now = Date.now();
        const oldTimestamp = now - 60_000;

        await writeFile(
            lockPath,
            `${JSON.stringify({
                version: 1,
                ownerToken: "abandoned-owner",
                pid: 987_654,
                createdAt: oldTimestamp,
            })}\n`,
            "utf8",
        );
        await utimes(
            lockPath,
            new Date(oldTimestamp),
            new Date(oldTimestamp),
        );

        const repository = new FileRunRepository(storePath, {
            now: () => now,
            isProcessAlive: () => false,
            lockStaleAfterMs: 1_000,
            sleep: async () => undefined,
        });

        await repository.save({
            id: "run-after-stale-lock",
            goal: "Recover an abandoned lock",
            status: "queued",
            createdAt: "2026-07-10T00:00:00.000Z",
        });

        expect(await repository.findById("run-after-stale-lock")).toMatchObject(
            {
                id: "run-after-stale-lock",
            },
        );
        expect(await listRepositoryArtifacts(storePath)).toEqual([]);
    });

    it("does not delete a stale-looking lock whose owner is still alive", async () => {
        const { storePath } = await createRepository();
        const lockPath = `${storePath}.lock`;
        const oldTimestamp = Date.now() - 60_000;
        const liveLock = `${JSON.stringify({
            version: 1,
            ownerToken: "live-owner",
            pid: process.pid,
            createdAt: oldTimestamp,
        })}\n`;

        await writeFile(lockPath, liveLock, "utf8");
        await utimes(
            lockPath,
            new Date(oldTimestamp),
            new Date(oldTimestamp),
        );

        const repository = new FileRunRepository(storePath, {
            isProcessAlive: () => true,
            lockStaleAfterMs: 1,
            lockAcquireTimeoutMs: 10,
            lockBaseDelayMs: 1,
            lockMaxDelayMs: 1,
        });

        await expect(
            repository.save({
                id: "run-blocked-by-live-lock",
                goal: "Respect a live writer",
                status: "queued",
                createdAt: "2026-07-10T00:00:00.000Z",
            }),
        ).rejects.toThrow("Timed out waiting for run repository lock");

        expect(await readFile(lockPath, "utf8")).toBe(liveLock);
        await rm(lockPath, { force: true });
    });

    it("updates an identical version id and rejects a number collision", async () => {
        const { repository } = await createRepository();
        const version = {
            id: "version-1",
            runId: "run-1",
            versionNumber: 1,
            snapshotId: "snapshot-1",
            goal: "Create an app",
            summary: "Initial version",
            createdAt: "2026-07-10T00:00:00.000Z",
        };

        await repository.saveVersion(version);
        await repository.saveVersion({
            ...version,
            summary: "Updated metadata",
        });

        expect(await repository.listVersions("run-1")).toEqual([
            {
                ...version,
                summary: "Updated metadata",
            },
        ]);
        await expect(
            repository.saveVersion({
                ...version,
                id: "different-version-id",
            }),
        ).rejects.toThrow("already has version 1");
    });

    it("deletes a run and its stored result", async () => {
        const { repository } = await createRepository();

        const run: Run = {
            id: "run-1",
            goal: "Create an app",
            status: "queued",
            createdAt: "2026-06-30T00:00:00.000Z",
        };

        const result: RunReactAppAgentResult = {
            workspaceRoot: "workspace-1",
            coordination: TEST_COORDINATION,
            agent: {
                steps: [],
                finished: true,
            },
            install: {
                exitCode: 0,
                stdout: "",
                stderr: "",
            },
            build: {
                exitCode: 0,
                stdout: "",
                stderr: "",
            },
            eval: {
                passed: true,
                checks: [],
            },
            review: {
                accepted: true,
                reason: "ok",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: true,
                    evalPassed: true,
                },
            },
            attempts: [],
        };

        await repository.save(run);
        await repository.saveResult(run.id, result);

        expect(await repository.deleteById(run.id)).toBe(true);
        expect(await repository.findById(run.id)).toBeUndefined();
        expect(await repository.findResultByRunId(run.id)).toBeUndefined();
        expect(await repository.deleteById(run.id)).toBe(false);
    });

    it("preserves Chinese text in persisted runs and results", async () => {
        const { repository, storePath } = await createRepository();

        const run: Run = {
            id: "run-chinese",
            goal: "我想要一个介绍温州的界面",
            status: "queued",
            createdAt: "2026-07-02T00:00:00.000Z",
        };

        await repository.save(run);

        const result: RunReactAppAgentResult = {
            workspaceRoot: "workspace-chinese",
            coordination: TEST_COORDINATION,
            agent: {
                steps: [
                    {
                        action: {
                            type: "write_file",
                            path: "src/App.tsx",
                            content: "export function App() { return <h1>温州介绍</h1>; }",
                        },
                        execution: {
                            ok: true,
                            message: "Wrote file: src/App.tsx",
                        },
                    },
                ],
                finished: true,
            },
            install: {
                exitCode: 0,
                stdout: "安装成功",
                stderr: "",
            },
            build: {
                exitCode: 0,
                stdout: "构建成功",
                stderr: "",
            },
            eval: {
                passed: true,
                checks: [
                    {
                        name: "has heading",
                        passed: true,
                    },
                ],
            },
            review: {
                accepted: true,
                reason: "温州介绍页面通过检查。",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: true,
                    evalPassed: true,
                },
            },
            attempts: [
                {
                    kind: "initial" as const,
                    agent: {
                        steps: [],
                        finished: true,
                    },
                    install: {
                        exitCode: 0,
                        stdout: "安装成功",
                        stderr: "",
                    },
                    build: {
                        exitCode: 0,
                        stdout: "构建成功",
                        stderr: "",
                    },
                    eval: {
                        passed: true,
                        checks: [
                            {
                                name: "has heading",
                                passed: true,
                            },
                        ],
                    },
                    review: {
                        accepted: true,
                        reason: "温州介绍页面通过检查。",
                        checks: {
                            agentFinished: true,
                            installPassed: true,
                            buildPassed: true,
                            evalPassed: true,
                        },
                    },
                },
            ],
        };

        await repository.saveResult(run.id, result);

        const rawStore = await readFile(storePath, "utf8");
        expect(rawStore).toContain("我想要一个介绍温州的界面");
        expect(rawStore).toContain("温州介绍");

        const restoredRepository = new FileRunRepository(storePath);

        expect(await restoredRepository.findById(run.id)).toEqual(run);
        expect(await restoredRepository.findResultByRunId(run.id)).toEqual(
            result,
        );
    });
});
