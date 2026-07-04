import { runCodingAgentStep, type RunCodingAgentStepResult } from "./run-coding-agent-step.js";
import type { ModelProvider } from "./model-provider.js";


function formatStepContext(
    step:RunCodingAgentStepResult,
    stepNumber:number,
):string{
    return [
        `Step ${stepNumber}:`,
        `Action: ${JSON.stringify(step.action)}`,
        `Result: ${step.execution.message}`,
    ].join("\n");
}
export type RunCodingAgentLoopOptions = {
    goal: string;
    model: ModelProvider;
    workspaceRoot: string;
    maxSteps: number;
    context?: string;
};

export type RunCodingAgentLoopResult = {
    steps: RunCodingAgentStepResult[];
    finished: boolean;
};

export async function runCodingAgentLoop(
    options: RunCodingAgentLoopOptions,
): Promise<RunCodingAgentLoopResult> {
    const steps: RunCodingAgentStepResult[] = [];
    let context = options.context ?? "";

    for (let index = 0; index < options.maxSteps; index += 1) {
        const step = await runCodingAgentStep({
            goal: options.goal,
            model: options.model,
            workspaceRoot: options.workspaceRoot,
            context,
        });

        steps.push(step);
        context = [
            context,
            formatStepContext(step, steps.length),
        ]
            .filter((part) => part.length > 0)
            .join("\n\n");
        if (step.action.type === "finish") {
            return {
                steps,
                finished: true,
            };
        }

        if (!step.execution.ok) {
            return {
                steps,
                finished: false,
            };
        }
    }

    return {
        steps,
        finished: false,
    };
}
