export const AGENT_CORE_PACKAGE_VERSION = "0.1.0";
export type {
    ModelMessage,
    ModelProvider,
    ModelRequest,
    ModelResponse,
    ModelRole,
} from "./model-provider.js";
export { FakeModelProvider } from "./fake-model-provider.js";
export { createPlan } from "./create-plan.js";
export { CodingAgent } from "./coding-agent.js";
export { ActionExecutor } from "./action-executor.js";
export { runCodingAgentLoop } from "./run-coding-agent-loop.js";
export { runCodingAgentStep } from "./run-coding-agent-step.js";
export { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

export type {
    ActionExecutionResult,
    ActionExecutorOptions,
} from "./action-executor.js";
export type { CodingAgentOptions } from "./coding-agent.js";
export type {
    RunCodingAgentLoopOptions,
    RunCodingAgentLoopResult,
} from "./run-coding-agent-loop.js";
export type {
    RunCodingAgentStepOptions,
    RunCodingAgentStepResult,
} from "./run-coding-agent-step.js";
export type {
    OpenAICompatibleProviderOptions,
} from "./openai-compatible-provider.js";
export {
    coordinateAgents,
    formatCoordinationContext,
} from "./coordinator.js";
export type {
    AgentAssignment,
    AgentRole,
    CoordinateAgentsInput,
    CoordinateAgentsResult,
} from "./coordinator.js";
export {
    formatSkillInstructions,
    reactViteAppSkill,
} from "./skills.js";

export type {
    Skill,
} from "./skills.js";
