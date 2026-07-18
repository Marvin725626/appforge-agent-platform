import { describe, expect, it, vi } from "vitest";

import { recoverInterruptedRuns } from "./recover-interrupted-runs.js";
import { RunRepository } from "./run-repository.js";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";

function createResult(
    accepted: boolean,
    operationId?: string,
): RunReactAppAgentResult {
    return {
        workspaceRoot: "workspace",
        coordination: {
            goal: "Create an app",
            plan: [],
            assignments: [],
        },
        agent: {
            finished: true,
            steps: [],
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
            accepted,
            reason: accepted ? "ok" : "needs review",
            checks: {
                agentFinished: true,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
            },
        },
        attempts: [],
        ...(operationId ? { operationId } : {}),
    };
}

describe("recoverInterruptedRuns", () => {
    it("recovers an interrupted run with a saved result for human review", async () => {
        const repository = new RunRepository();
        const restoreWorkspace = vi.fn(async () => undefined);
        const run = {
            id: "run-with-result",
            goal: "Create an app",
            status: "repairing" as const,
            operation: "repair" as const,
            operationId: "repair-1",
            operationPrompt: "Add a better layout",
            createdAt: "2026-07-10T00:00:00.000Z",
        };

        repository.save(run);
        repository.saveResult(run.id, createResult(false, "repair-1"));

        await expect(
            recoverInterruptedRuns(repository, restoreWorkspace),
        ).resolves.toBe(1);
        expect(repository.findById(run.id)?.status).toBe("waiting_for_human");
        expect(repository.findById(run.id)?.operation).toBeUndefined();
        expect(repository.findById(run.id)?.operationPrompt).toBe(
            "Add a better layout",
        );
        expect(restoreWorkspace).toHaveBeenCalledWith(run);
    });

    it("recovers an interrupted run with an accepted result as succeeded", async () => {
        const repository = new RunRepository();
        const run = {
            id: "accepted-run",
            goal: "Create an app",
            status: "running" as const,
            operation: "initial_generation" as const,
            operationId: "generation-1",
            operationPrompt: "Old prompt",
            errorMessage: "old error",
            createdAt: "2026-07-10T00:00:00.000Z",
        };

        repository.save(run);
        repository.saveResult(run.id, createResult(true, "generation-1"));

        await recoverInterruptedRuns(repository);

        const recoveredRun = repository.findById(run.id);
        expect(recoveredRun?.status).toBe("succeeded");
        expect(recoveredRun?.operation).toBeUndefined();
        expect(recoveredRun?.operationPrompt).toBeUndefined();
        expect(recoveredRun?.errorMessage).toBeUndefined();
    });

    it("marks an interrupted run without a result as failed", async () => {
        const repository = new RunRepository();
        const restoreWorkspace = vi.fn(async () => undefined);
        const run = {
            id: "run-without-result",
            goal: "Create an app",
            status: "running" as const,
            operationPrompt: "Make the hero section cleaner",
            createdAt: "2026-07-10T00:00:00.000Z",
        };

        repository.save(run);

        await recoverInterruptedRuns(repository, restoreWorkspace);

        expect(repository.findById(run.id)?.status).toBe("failed");
        expect(repository.findById(run.id)?.errorMessage).toContain(
            "API process stopped",
        );
        expect(repository.findById(run.id)?.operationPrompt).toBe(
            "Make the hero section cleaner",
        );
        expect(restoreWorkspace).toHaveBeenCalledWith(run);
    });

    it("does not accept a result saved by an earlier operation", async () => {
        const repository = new RunRepository();
        const run = {
            id: "stale-result-run",
            goal: "Create an app",
            status: "running" as const,
            operation: "iteration" as const,
            operationId: "iteration-2",
            operationPrompt: "Add a second page",
            createdAt: "2026-07-10T00:00:00.000Z",
        };

        repository.save(run);
        repository.saveResult(run.id, createResult(true, "generation-1"));

        await recoverInterruptedRuns(repository);

        expect(repository.findById(run.id)).toMatchObject({
            status: "failed",
            operationId: "iteration-2",
            operationPrompt: "Add a second page",
            errorMessage: expect.stringContaining("earlier operation"),
        });
    });

    it("keeps completed and queued runs unchanged", async () => {
        const repository = new RunRepository();
        repository.save({
            id: "completed-run",
            goal: "Create an app",
            status: "succeeded",
            createdAt: "2026-07-10T00:00:00.000Z",
        });
        repository.save({
            id: "queued-run",
            goal: "Create an app",
            status: "queued",
            createdAt: "2026-07-10T00:00:00.000Z",
        });

        await expect(recoverInterruptedRuns(repository)).resolves.toBe(0);
        expect(repository.findById("completed-run")?.status).toBe("succeeded");
        expect(repository.findById("queued-run")?.status).toBe("queued");
    });
});
