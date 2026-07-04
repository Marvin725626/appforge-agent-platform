import { mkdtemp, readFile, rm } from "node:fs/promises";
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
