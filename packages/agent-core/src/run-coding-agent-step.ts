import type { AgentAction } from "@appforge/protocol";

import { ActionExecutor, type ActionExecutionResult } from "./action-executor.js";
import { CodingAgent } from "./coding-agent.js";
import type { ModelProvider } from "./model-provider.js";

export type RunCodingAgentStepOptions = {
    goal:string;
    model:ModelProvider;
    workspaceRoot:string;
    context?: string;
};

export type RunCodingAgentStepResult = {
    action:AgentAction;
    execution:ActionExecutionResult;
};

export async function runCodingAgentStep(
    options:RunCodingAgentStepOptions,
):Promise<RunCodingAgentStepResult>{
    const agent= new CodingAgent({
        model:options.model,
    });

    const executor = new ActionExecutor({
        workspaceRoot:options.workspaceRoot,
    });
    const action = await agent.decideNextAction(
        options.goal,
        options.context,
    );
    const execution = await executor.execute(action);
    return{
        action,
        execution,
    };
}
