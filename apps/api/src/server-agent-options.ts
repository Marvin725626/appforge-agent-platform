import type { ImageAssetMode, ImageAssetProvider } from "@appforge/agent-core";

import type { ExecuteRun } from "./app.js";
import type { RunReactAppAgentOptions } from "./run-react-app-agent.js";

export type ServerAgentOptionsConfig = {
    templateRoot: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    llmServiceTier?: string;
    env?: NodeJS.ProcessEnv;
    imageAssetProvider?: ImageAssetProvider;
    imageAssetModes?: ImageAssetMode[];
    evaluateBrowser?: RunReactAppAgentOptions["evaluateBrowser"];
};

export function createServerRunReactAppAgentOptions(
    input: Parameters<ExecuteRun>[0],
    config: ServerAgentOptionsConfig,
): RunReactAppAgentOptions {
    const env = config.env ?? process.env;
    const agentOptions: RunReactAppAgentOptions = {
        goal: input.goal,
        workspaceRoot: input.workspaceRoot,
        templateRoot: config.templateRoot,
        stableGeneration:
            env.APPFORGE_STABLE_GENERATION?.trim().toLowerCase() !== "false",
        parallelCoding:
            env.APPFORGE_PARALLEL_CODING?.trim().toLowerCase() !== "false",
        parallelCodingConcurrency: Number(
            env.APPFORGE_PARALLEL_CODER_CONCURRENCY ?? 2,
        ),
        parallelCodingTimeoutMs: Number(
            env.APPFORGE_PARALLEL_CODER_TIMEOUT_MS ?? 240_000,
        ),
        llm: {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            timeoutMs: Number(env.APPFORGE_LLM_TIMEOUT_MS ?? 120_000),
            maxRetries: Number(env.APPFORGE_LLM_MAX_RETRIES ?? 1),
            stream:
                env.APPFORGE_LLM_STREAM?.trim().toLowerCase() !== "false",
            ...(config.llmServiceTier === "auto" ||
            config.llmServiceTier === "default"
                ? { serviceTier: config.llmServiceTier }
                : {}),
            plannerTimeoutMs: Number(
                env.APPFORGE_PLANNER_TIMEOUT_MS ?? 30_000,
            ),
            reviewerTimeoutMs: Number(
                env.APPFORGE_REVIEWER_TIMEOUT_MS ?? 45_000,
            ),
            hardTimeoutMs: Number(
                env.APPFORGE_LLM_HARD_TIMEOUT_MS ?? 240_000,
            ),
            parallelMaxTokens: Number(
                env.APPFORGE_PARALLEL_CODER_MAX_TOKENS ?? 4_000,
            ),
            parallelThinking:
                env.APPFORGE_PARALLEL_CODER_THINKING === "enabled" ||
                env.APPFORGE_PARALLEL_CODER_THINKING === "auto"
                    ? env.APPFORGE_PARALLEL_CODER_THINKING
                    : "disabled",
            maxTokens: Number(env.APPFORGE_LLM_MAX_TOKENS ?? 8_000),
        },
    };

    if (input.currentRequest !== undefined) {
        agentOptions.currentRequest = input.currentRequest;
    }

    if (input.designPlan !== undefined) {
        agentOptions.designPlan = input.designPlan;
    }

    if (input.resetWorkspace !== undefined) {
        agentOptions.resetWorkspace = input.resetWorkspace;
    }

    if (input.signal !== undefined) {
        agentOptions.signal = input.signal;
    }

    if (input.onProgress !== undefined) {
        agentOptions.onProgress = input.onProgress;
    }

    if (input.maxRepairAttempts !== undefined) {
        agentOptions.maxRepairAttempts = input.maxRepairAttempts;
    }

    if (input.memoryContext !== undefined) {
        agentOptions.memoryContext = input.memoryContext;
    }

    if (config.imageAssetProvider) {
        agentOptions.imageAssetProvider = config.imageAssetProvider;
        agentOptions.imageAssetModes = config.imageAssetModes ?? [];
    }

    if (config.evaluateBrowser !== undefined) {
        agentOptions.evaluateBrowser = config.evaluateBrowser;
    }

    return agentOptions;
}
