import type { AgentAction } from "@appforge/protocol";
import type { ImageAssetMode } from "./image-asset-provider.js";
import type { ImageAssetTool } from "./image-asset-tool.js";
import { ActionExecutor, type ActionExecutionResult } from "./action-executor.js";
import { CodingAgent } from "./coding-agent.js";
import { RepairAgent } from "./repair-agent.js";
import type { ModelProvider } from "./model-provider.js";

export type CodingAgentStepMode = "coding" | "repair";

export type RunCodingAgentStepOptions = {
    goal: string;
    model: ModelProvider;
    workspaceRoot: string;
    context?: string;
    imageAssetTool?: ImageAssetTool;
    imageAssetModes?: ImageAssetMode[];
    mode?: CodingAgentStepMode;
    entrypointFirst?: boolean;
    signal?: AbortSignal;
    validateAction?: (
        action: AgentAction,
    ) => ActionExecutionResult | undefined | Promise<ActionExecutionResult | undefined>;
};

export type RunCodingAgentStepResult = {
    action:AgentAction;
    execution:ActionExecutionResult;
};

export async function runCodingAgentStep(
    options:RunCodingAgentStepOptions,
):Promise<RunCodingAgentStepResult>{
    options.signal?.throwIfAborted();
    const signal = options.signal;
    const agentOptions = {
        model: signal
            ? {
                  complete: (request: Parameters<ModelProvider["complete"]>[0]) =>
                      options.model.complete({
                          ...request,
                          signal,
                      }),
              }
            : options.model,
        imageToolsEnabled:
            options.imageAssetTool !== undefined,
        ...(options.imageAssetModes
            ? { imageToolModes: options.imageAssetModes }
            : {}),
        ...(options.entrypointFirst
            ? { entrypointFirst: true }
            : {}),
    };
    const agent =
        options.mode === "repair"
            ? new RepairAgent(agentOptions)
            : new CodingAgent(agentOptions);

    const executor = new ActionExecutor({
        workspaceRoot: options.workspaceRoot,
        ...(signal ? { signal } : {}),
        ...(options.imageAssetTool
            ? {
                imageAssetTool:
                options.imageAssetTool,
            }
            : {}),
    });
    const action = await agent.decideNextAction(
        options.goal,
        options.context,
    );
    options.signal?.throwIfAborted();
    const validationResult = await options.validateAction?.(action);

    if (validationResult) {
        return {
            action,
            execution: validationResult,
        };
    }

    const execution = await executor.execute(action);
    return{
        action,
        execution,
    };
}
