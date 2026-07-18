import type { Run } from "@appforge/protocol";

import type { RunRepositoryLike } from "./run-repository.js";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";

export type RestoreRecoveredWorkspace = (run: Run) => Promise<void>;

type OperationScopedRunResult = RunReactAppAgentResult & {
    operationId?: string;
};

const INTERRUPTED_STATUSES = new Set<Run["status"]>([
    "planning",
    "running",
    "executing",
    "validating",
    "repairing",
    "evaluating",
]);

/**
 * A background run only exists in the API process memory. If that process
 * stops, its persisted status must not keep claiming that work is ongoing.
 */
export async function recoverInterruptedRuns(
    runRepository: RunRepositoryLike,
    restoreWorkspace?: RestoreRecoveredWorkspace,
): Promise<number> {
    const runs = await runRepository.list();
    let recoveredCount = 0;

    for (const run of runs) {
        if (!INTERRUPTED_STATUSES.has(run.status)) {
            continue;
        }

        const result = await runRepository.findResultByRunId(run.id);

        if (restoreWorkspace) {
            await restoreWorkspace(run);
        }

        const resultBelongsToInterruptedOperation =
            result !== undefined &&
            run.operationId !== undefined &&
            (result as OperationScopedRunResult).operationId === run.operationId;

        run.status = resultBelongsToInterruptedOperation
            ? getRecoveredRunStatus(result)
            : "failed";
        delete run.operation;
        if (!resultBelongsToInterruptedOperation) {
            run.errorMessage =
                result === undefined
                    ? "The API process stopped before this run saved a result. Please retry from the current workspace."
                    : "The API process stopped before this operation saved its result. The stored result belongs to an earlier operation, so the current workspace was preserved for retry.";
        } else if (result?.review.accepted) {
            delete run.errorMessage;
            delete run.operationPrompt;
        } else {
            delete run.errorMessage;
        }
        await runRepository.save(run);
        recoveredCount += 1;
    }

    return recoveredCount;
}

function getRecoveredRunStatus(
    result: RunReactAppAgentResult | undefined,
): Run["status"] {
    if (!result) {
        return "failed";
    }

    return result.review.accepted ? "succeeded" : "waiting_for_human";
}
