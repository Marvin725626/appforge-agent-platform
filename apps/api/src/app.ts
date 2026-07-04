import path from "node:path";
import { rm } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RunRepository, type RunRepositoryLike } from "./run-repository.js";
import { CreateRunInputSchema } from "@appforge/protocol";
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
    formatMemoryContext,
    MemoryRepository,
} from "./memory-repository.js";

const RepairRequestSchema = z.object({
    feedback: z.string().trim().min(1).max(2000),
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

function summarizeRunMemory(result: RunReactAppAgentResult): string {
    const passedChecks = result.eval.checks.filter((check) => check.passed).length;

    return [
        `Review: ${result.review.reason}`,
        `Attempts: ${result.attempts.length}`,
        `Eval: ${passedChecks}/${result.eval.checks.length} checks passed`,
        `Build exit code: ${result.build.exitCode}`,
    ].join(" ");
}

export  function buildApp(
    runRepository: RunRepositoryLike = new RunRepository(),
    workspaceManager = new WorkspaceManager(
        path.resolve(".appforge", "workspaces"),
    ),
    executeRun?:ExecuteRun,
    previewManager=new PreviewManager(),
    memoryRepository = new MemoryRepository(),
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
            memories: memoryRepository.list(),
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
                const memoryContext = formatMemoryContext(
                    memoryRepository.list().slice(-5),
                ).slice(0, 2000);

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
                memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: run.goal,
                    outcome: run.status,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });

                return reply.send({
                    run,
                    result,
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
                memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: run.goal,
                    outcome: run.status,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                return reply.send({
                    run,
                    result,
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
            });
        },);
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
    app.post<{Params:{ id: string}}>(
        "/runs/:id/preview",
        async (request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if (!run){
                return reply.status(404).send({
                    error: "Run not found",
                });
            }
            const preview = await previewManager.start({
               runId:run.id,
               workspaceRoot:workspaceManager.resolve(run.id),
            });
            return reply.send({
                preview,
            });
        },
    );
    return app;
}
