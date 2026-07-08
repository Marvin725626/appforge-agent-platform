import path from "node:path";
import { rm } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RunRepository, type RunRepositoryLike } from "./run-repository.js";
import {
    CreateRunInputSchema,
    RunReportSchema,
    type Run,
    type RunReport,
    type RunVersion,
} from "@appforge/protocol";
import {
    listWorkspaceFiles,
    readWorkspaceFile,
    WorkspaceManager,
} from "@appforge/workspace";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";
import { PreviewManager } from "./preview-manager.js";
import { coordinateAgents } from "@appforge/agent-core";
import { containsLikelyMojibake } from "@appforge/harness";
import {
    PlaywrightBrowserEvaluator,
    type BrowserEvaluator,
} from "@appforge/harness";
import {
    formatAgentMemoryContext,
    MemoryRepository,
    type MemoryEntry,
    type MemoryRepositoryLike,
} from "./memory-repository.js";
import { saveRunVersionSnapshot } from "./run-version-snapshot.js";
import {
    compactMemoryEntries,
    shouldCompactMemory,
} from "./memory-compactor.js";
import { retrieveRelevantMemory } from "./memory-retrieval.js";

const RepairRequestSchema = z.object({
    feedback: z.string().trim().min(1).max(2000),
});
const IterateRunInputSchema = z.object({
    prompt: z.string().trim().min(1).max(2000),
});
export type ExecuteRun = (input:{
    goal:string;
    workspaceRoot:string;
    maxRepairAttempts?:number;
    memoryContext?: string;
})=>Promise<RunReactAppAgentResult>;
const ExecuteRunInputSchema = z.object({
    maxRepairAttempts: z.number().int().min(0).max(3).optional(),
});
const PreviewRunInputSchema = z.object({
    versionNumber: z.number().int().min(1).optional(),
});
function summarizeRunMemory(result: RunReactAppAgentResult): string {
    const passedChecks = result.eval.checks.filter((check) => check.passed).length;

    return [
        `Review: ${result.review.reason}`,
        `Attempts: ${result.attempts.length}`,
        `Eval: ${passedChecks}/${result.eval.checks.length} checks passed`,
        `Build exit code: ${result.build.exitCode}`,
    ].join(" ");
}

function countPassedChecks(checks: { passed: boolean }[] = []): number {
    return checks.filter((check) => check.passed).length;
}

function buildRunReport(input: {
    run: Run;
    result?: RunReactAppAgentResult;
    versions: RunVersion[];
    files: string[];
    memory: MemoryEntry[];
}): RunReport {
    const evalChecks = input.result?.eval.checks ?? [];
    const browserChecks = input.result?.browserEval?.checks ?? [];
    const attempts = input.result?.attempts.length ?? 0;
    const reviewReason = input.result?.review.reason;
    const evalPassedChecks = countPassedChecks(evalChecks);
    const browserPassedChecks = countPassedChecks(browserChecks);

    const statusLine = input.result
        ? `Run ${input.run.status}: ${attempts} attempt(s), ${evalPassedChecks}/${evalChecks.length} eval checks, ${browserPassedChecks}/${browserChecks.length} browser checks.`
        : `Run ${input.run.status}: execution has not produced an agent result yet.`;

    const narrative = [
        `Goal: ${input.run.goal}`,
        statusLine,
        reviewReason ? `Review: ${reviewReason}` : "",
        input.versions.length > 0
            ? `Versions: ${input.versions.length} snapshot(s) saved.`
            : "Versions: no snapshots saved yet.",
        input.files.length > 0
            ? `Files: ${input.files.slice(0, 6).join(", ")}`
            : "Files: no generated files listed yet.",
    ]
        .filter((part) => part.length > 0)
        .join("\n");

    const report: RunReport = {
        run: input.run,
        generatedAt: new Date().toISOString(),
        statusLine,
        summary: {
            attempts,
            evalPassedChecks,
            evalTotalChecks: evalChecks.length,
            browserPassedChecks,
            browserTotalChecks: browserChecks.length,
            ...(input.result
                ? {
                    agentFinished: input.result.agent.finished,
                    buildExitCode: input.result.build.exitCode,
                    evalPassed: input.result.eval.passed,
                    reviewAccepted: input.result.review.accepted,
                    reviewReason: input.result.review.reason,
                }
                : {}),
            ...(input.result?.browserEval
                ? {
                    browserPassed: input.result.browserEval.passed,
                }
                : {}),
        },
        ...(input.result?.coordination
            ? {
                coordination: {
                    plan: input.result.coordination.plan,
                    assignments: input.result.coordination.assignments,
                },
            }
            : {}),
        trace: input.result?.trace ?? [],
        versions: input.versions,
        files: input.files,
        memory: input.memory.map((entry) => ({
            outcome: entry.outcome,
            summary: entry.summary,
            createdAt: entry.createdAt,
        })),
        narrative,
    };

    return RunReportSchema.parse(report);
}

async function listReportFiles(workspaceRoot: string): Promise<string[]> {
    const files = new Set<string>();

    for (const directory of [".", "src"]) {
        try {
            const directoryFiles = await listWorkspaceFiles(
                workspaceRoot,
                directory,
            );

            directoryFiles.forEach((filePath) =>
                files.add(filePath.replaceAll("\\", "/")),
            );
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                continue;
            }

            throw error;
        }
    }

    return [...files].sort();
}

async function maybeCompactMemory(
    memoryRepository: MemoryRepositoryLike,
): Promise<void> {
    const memories = await memoryRepository.list();
    const summaries = await memoryRepository.listSummaries();

    if (
        !shouldCompactMemory({
            memoryCount: memories.length,
            summaryCount: summaries.length,
        })
    ) {
        return;
    }

    const summary = compactMemoryEntries({
        entries: memories,
    });

    if (summary === undefined) {
        return;
    }

    await memoryRepository.saveSummary(summary);
}
export  function buildApp(
    runRepository: RunRepositoryLike = new RunRepository(),
    workspaceManager = new WorkspaceManager(
        path.resolve(".appforge", "workspaces"),
    ),
    executeRun?:ExecuteRun,
    previewManager=new PreviewManager(),
    memoryRepository: MemoryRepositoryLike = new MemoryRepository(),
    browserEvaluator: BrowserEvaluator = new PlaywrightBrowserEvaluator(),
) {
    const app = Fastify();

    void app.register(cors, {
        origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
    });

    app.get("/health", async () => {
        return {
            status: "ok",
        };

    });
    app.get("/memory", async () => {
        return {
            memories: await memoryRepository.list(),
        };
    });
    app.get("/runs", async () => {
        return {
            runs: await runRepository.list(),
        };
    });
    app.post("/runs", async (request, reply) => {
  const result = CreateRunInputSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid create run input",
    });
  }

  if (containsLikelyMojibake(result.data.goal)) {
    return reply.status(400).send({
      error: "Goal appears to be garbled text",
      message: "Please re-enter the goal using UTF-8 text.",
    });
  }

  const run = {
    id: randomUUID(),
    goal: result.data.goal,
    status: "queued" as const,
    createdAt: new Date().toISOString(),
  };
  await workspaceManager.create(run.id);
  await runRepository.save(run);

  return reply.status(201).send(run);
});
    app.post<{Params:{ id:string}}>(
        "/runs/:id/execute",
        async  (request,reply)=>{
            const run = await runRepository.findById(request.params.id);
            if (!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            if(!executeRun){
                return reply.status(501).send({
                  error:"Run execution is not configured",
                });
            }

            const input = ExecuteRunInputSchema.safeParse(request.body ?? {});

            if (!input.success) {
                return reply.status(400).send({
                    error: "Invalid execute run input",
                });
            }

            run.status = "running";
            await runRepository.save(run);

            try {
                const memoryEntries = await memoryRepository.list();
                const memorySummaries = await memoryRepository.listSummaries();
                const relevantMemoryEntries = retrieveRelevantMemory({
                    goal: run.goal,
                    entries: memoryEntries,
                    maxEntries: 5,
                });

                const memoryContext = formatAgentMemoryContext({
                    entries: relevantMemoryEntries,
                    summaries: memorySummaries,
                    maxEntries: 5,
                    maxCharacters: 2000,
                });

                const executeRunInput: Parameters<ExecuteRun>[0] = {
                    goal: run.goal,
                    workspaceRoot: workspaceManager.resolve(run.id),
                };

                if (memoryContext.length > 0) {
                    executeRunInput.memoryContext = memoryContext;
                }

                if (input.data.maxRepairAttempts !== undefined) {
                    executeRunInput.maxRepairAttempts =
                        input.data.maxRepairAttempts;
                }

                const result = await executeRun(executeRunInput);

                run.status = result.review.accepted
                    ? "succeeded"
                    : "waiting_for_human";
                await runRepository.save(run);
                await runRepository.saveResult(run.id,result);
                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: run.goal,
                    outcome: run.status,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);
                const existingVersion = await runRepository.listVersions(run.id);

                if(existingVersion.length === 0){
                    await runRepository.saveVersion({
                        id: randomUUID(),
                        runId: run.id,
                        versionNumber: 1,
                        goal: run.goal,
                        summary: result.agent.finished
                            ? "Initial generated version"
                            : "Initial attempt did not finish",
                        createdAt: new Date().toISOString(),
                    });

                    await saveRunVersionSnapshot({
                        workspaceRoot: workspaceManager.resolve(run.id),
                        versionNumber: 1,
                    });
                }

                return reply.send({
                    run,
                    result,
                    versions: await runRepository.listVersions(run.id),
                });
            } catch (error) {
                run.status = "failed";
                await runRepository.save(run);

                return reply.status(500).send({
                    error: "Run execution failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown execution error",
                });
            }
        },
    );

    app.post<{Params:{ id:string}}>(
        "/runs/:id/approve",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (run.status !== "waiting_for_human") {
                return reply.status(409).send({
                    error: "Run is not waiting for human review",
                });
            }

            run.status = "succeeded";
            await runRepository.save(run);

            return reply.send({
                run,
            });
        },
    );

    app.post<{Params:{ id:string}}>(
        "/runs/:id/request-repair",
        async (request, reply) => {
            const body = RepairRequestSchema.safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({
                    error: "Invalid repair request input",
                });
            }

            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (run.status !== "waiting_for_human") {
                return reply.status(409).send({
                    error: "Run is not waiting for human review",
                });
            }

            if (!executeRun) {
                return reply.status(501).send({
                    error: "Run execution is not configured",
                });
            }

            run.status = "repairing";
            await runRepository.save(run);

            try {
                const result = await executeRun({
                    goal: `${run.goal}\n\nHuman feedback:\n${body.data.feedback}`,
                    workspaceRoot: workspaceManager.resolve(run.id),
                });

                run.status = result.review.accepted
                    ? "succeeded"
                    : "waiting_for_human";
                await runRepository.save(run);
                await runRepository.saveResult(run.id, result);
                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: run.goal,
                    outcome: run.status,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);

                const existingVersions =
                    await runRepository.listVersions(run.id);
                const nextVersionNumber = existingVersions.length + 1;

                await runRepository.saveVersion({
                    id: randomUUID(),
                    runId: run.id,
                    versionNumber: nextVersionNumber,
                    goal: body.data.feedback,
                    summary: result.review.accepted
                        ? `Repair version ${nextVersionNumber}`
                        : `Repair attempt ${nextVersionNumber} needs review`,
                    createdAt: new Date().toISOString(),
                });
                await saveRunVersionSnapshot({
                    workspaceRoot: workspaceManager.resolve(run.id),
                    versionNumber: nextVersionNumber,
                });
                return reply.send({
                    run,
                    result,
                    versions: await runRepository.listVersions(run.id),
                });
            } catch (error) {
                run.status = "failed";
                await runRepository.save(run);

                return reply.status(500).send({
                    error: "Run repair failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown repair error",
                });
            }
        },
    );
    app.post<{ Params:{ id:string } }>(
        "/runs/:id/iterate",
        async (request,reply)=>{
            const body = IterateRunInputSchema.safeParse(request.body);
            if(!body.success){
                return reply.status(400).send({
                    error: "Invalid iterate run input",
                });
            }
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if(!executeRun) {
                return reply.status(501).send({
                    error: "Run execution is not configured",
                });
            }
            try{
                const existingVersionsBeforeIteration =
                    await runRepository.listVersions(run.id);
                const existingResult =
                    await runRepository.findResultByRunId(run.id);

                if (
                    existingVersionsBeforeIteration.length === 0 &&
                    existingResult
                ) {
                    await runRepository.saveVersion({
                        id: randomUUID(),
                        runId: run.id,
                        versionNumber: 1,
                        goal: run.goal,
                        summary: "Initial generated version",
                        createdAt: new Date().toISOString(),
                    });

                    await saveRunVersionSnapshot({
                        workspaceRoot: workspaceManager.resolve(run.id),
                        versionNumber: 1,
                    });
                }

                run.status = "running";
                await runRepository.save(run);

                const result = await executeRun({
                    goal: `${run.goal}\n\nIteration request:\n${body.data.prompt}`,
                    workspaceRoot: workspaceManager.resolve(run.id),
                });
                run.status = result.review.accepted
                ?"succeeded":"waiting_for_human";
                await runRepository.save(run);
                await runRepository.saveResult(run.id,result);

                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: run.goal,
                    outcome: run.status,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);

                const existingVersions = await runRepository.listVersions(run.id);
                const nextVersionNumber = existingVersions.length+1;

                await runRepository.saveVersion({
                    id: randomUUID(),
                    runId: run.id,
                    versionNumber: nextVersionNumber,
                    goal: body.data.prompt,
                    summary: result.review.accepted
                        ? `Iteration version ${nextVersionNumber}`
                        : `Iteration attempt ${nextVersionNumber} needs review`,
                    createdAt: new Date().toISOString(),
                });
                await saveRunVersionSnapshot({
                    workspaceRoot: workspaceManager.resolve(run.id),
                    versionNumber: nextVersionNumber,
                });
                return reply.send({
                    run,
                    result,
                    versions: await runRepository.listVersions(run.id),
                });
            }
            catch (error){run.status = "failed";
                await runRepository.save(run);

                return reply.status(500).send({
                    error: "Run iteration failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown iteration error",
                });
            }
        },
    );
    app.get<{Params:{ id:string }}>(
        "/runs/:id/coordination",
        async (request,reply)=>{
            const run = await runRepository.findById(request.params.id);
            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }
            return reply.send(
                coordinateAgents({
                    goal:run.goal,
                }),
            );
        },
    );

    app.delete<{ Params: { id: string } }>(
        "/runs/:id",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            await runRepository.deleteById(run.id);
            await rm(workspaceManager.resolve(run.id), {
                recursive: true,
                force: true,
            });

            return reply.status(204).send();
        },
    );


    app.get<{ Params:{ id: string }}>(
        "/runs/:id",
        async(request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if(!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            return reply.send({
                run,
                result: await runRepository.findResultByRunId(run.id),
                versions: await runRepository.listVersions(run.id),
            });
        },);
    app.get<{ Params: { id: string } }>(
        "/runs/:id/report",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            const result = await runRepository.findResultByRunId(run.id);
            const versions = await runRepository.listVersions(run.id);
            const files = await listReportFiles(workspaceManager.resolve(run.id));
            const memory = (await memoryRepository.list()).filter(
                (entry) => entry.runId === run.id,
            );

            return reply.send(
                buildRunReport({
                    run,
                    ...(result ? { result } : {}),
                    versions,
                    files,
                    memory,
                }),
            );
        },
    );
    app.get<{
        Params: { id: string };
        Querystring: { directory?: string; path?: string };
    }>("/runs/:id/files", async (request, reply) => {
        const run = await runRepository.findById(request.params.id);

        if (!run) {
            return reply.status(404).send({
                error: "Run not found",
            });
        }

        try {
            if (!request.query.path) {
                const directory = request.query.directory ?? ".";
                const files = await listWorkspaceFiles(
                    workspaceManager.resolve(run.id),
                    directory,
                );

                return reply.send({
                    directory,
                    files,
                });
            }

            const content = await readWorkspaceFile(
                workspaceManager.resolve(run.id),
                request.query.path,
            );

            return reply.send({
                path: request.query.path,
                content,
            });
        } catch (error) {
            if (error instanceof Error && error.message === "Path escapes workspace root") {
                return reply.status(400).send({
                    error: "Invalid file path",
                });
            }

            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return reply.status(404).send({
                    error: "File not found",
                });
            }

            throw error;
        }
    });
    app.get<{
        Params:{
            id:string;
            versionNumber:string;
        };
        Querystring:{
          path:string;
        };
    }>(
        "/runs/:id/versions/:versionNumber/files",
        async(request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if(!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            const versionNumber = Number(request.params.versionNumber);

            if (!Number.isInteger(versionNumber)||versionNumber<1){
                return reply.status(400).send({
                    error: "Invalid version number",
                });
            }
            const snapshotRoot = path.join(
              workspaceManager.resolve(run.id),
                "versions",
                `v${versionNumber}`,
            );
            const content = await  readWorkspaceFile(
                snapshotRoot,
                request.query.path,
            );
            return reply.send({
                path: request.query.path,
                content,
            });
        },
    );
    app.post<{Params:{ id: string}}>(
        "/runs/:id/preview",
        async (request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if (!run){
                return reply.status(404).send({
                    error: "Run not found",
                });
            }
            const input = PreviewRunInputSchema.safeParse(request.body??{});
            if (!input.success) {
                return reply.status(400).send({
                    error: "Invalid preview input",
                });
            }
            const preview = await previewManager.start({
               runId:run.id,
                workspaceRoot:
                    input.data.versionNumber === undefined
                        ? workspaceManager.resolve(run.id)
                        : path.join(
                            workspaceManager.resolve(run.id),
                            "versions",
                            `v${input.data.versionNumber}`,
                        ),
            });
            const browserEval = await browserEvaluator.evaluate({
                url: preview.url,
                goal: run.goal,
            });

            const result = await runRepository.findResultByRunId(run.id);

            if (result) {
                await runRepository.saveResult(run.id, {
                    ...result,
                    browserEval,
                });
            }

            return reply.send({
                preview,
                browserEval,
            });
        },
    );
    return app;
}
