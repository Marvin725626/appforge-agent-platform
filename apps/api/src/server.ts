import path from "node:path";

import { WorkspaceManager } from "@appforge/workspace";

import { buildApp } from "./app.js";
import { FileRunRepository } from "./file-run-repository.js";
import { recoverInterruptedRuns } from "./recover-interrupted-runs.js";
import {
    runReactAppAgent,
    type RunReactAppAgentOptions,
} from "./run-react-app-agent.js";
import { FileMemoryRepository } from "./file-memory-repository.js";
import { PlaywrightBrowserEvaluator } from "@appforge/harness";
import { PreviewManager } from "./preview-manager.js";
import {
    CompositeImageAssetProvider,
    OpenAICompatibleImageProvider,
    SearchImageAssetProvider,
    type ImageAssetMode,
    WebImageAssetProvider,
} from "@appforge/agent-core";

const workspacesRoot = path.resolve(".appforge","workspaces");
const runsStorePath = path.resolve(".appforge", "runs.json");
const memoryStorePath = path.resolve(".appforge", "memory.json");
const templateRoot = path.resolve(
    "..",
    "..",
    "tests",
    "fixtures",
    "vite-react-starter",
);
const workspaceManager = new WorkspaceManager(workspacesRoot);
const runRepository = new FileRunRepository(runsStorePath);
const previewManager = new PreviewManager();
const browserEvaluator = new PlaywrightBrowserEvaluator();
const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;
const llmServiceTier = process.env.APPFORGE_LLM_SERVICE_TIER;
const imageBaseUrl = process.env.APPFORGE_IMAGE_BASE_URL;
const imageApiKey = process.env.APPFORGE_IMAGE_API_KEY;
const imageModel = process.env.APPFORGE_IMAGE_MODEL;


if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}

const hasAnyImageConfig =
    Boolean(imageBaseUrl) ||
    Boolean(imageApiKey) ||
    Boolean(imageModel);
const hasCompleteImageConfig =
    Boolean(imageBaseUrl) &&
    Boolean(imageApiKey) &&
    Boolean(imageModel);

if (hasAnyImageConfig && !hasCompleteImageConfig) {
    throw new Error(
        "Incomplete AppForge image environment variables",
    );
}

function createSearchImageAssetProvider(): SearchImageAssetProvider {
    const options = {
        timeoutMs: Number(
            process.env.APPFORGE_IMAGE_SEARCH_TIMEOUT_MS ?? 30_000,
        ),
        ...(process.env.APPFORGE_IMAGE_SEARCH_URL_TEMPLATE
            ? {
                  searchUrlTemplate:
                      process.env.APPFORGE_IMAGE_SEARCH_URL_TEMPLATE,
              }
            : {}),
    };

    return new SearchImageAssetProvider(options);
}

const imageAssetProvider =
    imageBaseUrl && imageApiKey && imageModel
        ? new CompositeImageAssetProvider([
              createSearchImageAssetProvider(),
              new WebImageAssetProvider(),
              new OpenAICompatibleImageProvider({
                  baseUrl: imageBaseUrl,
                  apiKey: imageApiKey,
                  model: imageModel,
                  timeoutMs: Number(
                      process.env.APPFORGE_IMAGE_TIMEOUT_MS ?? 120_000,
                  ),
              }),
          ])
        : new CompositeImageAssetProvider([
              createSearchImageAssetProvider(),
              new WebImageAssetProvider(),
          ]);
const imageAssetModes: ImageAssetMode[] =
    imageBaseUrl && imageApiKey && imageModel
        ? ["search", "generate"]
        : ["search"];

const app = buildApp(
    runRepository,
    workspaceManager,
    async ({
        goal,
        currentRequest,
        workspaceRoot,
        maxRepairAttempts,
        memoryContext,
        resetWorkspace,
        signal,
        onProgress,
    }) => {
        const agentOptions: RunReactAppAgentOptions = {
            goal,
            workspaceRoot,
            templateRoot,
            parallelCoding:
                process.env.APPFORGE_PARALLEL_CODING?.trim().toLowerCase() !==
                "false",
            parallelCodingConcurrency: Number(
                process.env.APPFORGE_PARALLEL_CODER_CONCURRENCY ?? 2,
            ),
            parallelCodingTimeoutMs: Number(
                process.env.APPFORGE_PARALLEL_CODER_TIMEOUT_MS ?? 240_000,
            ),
            llm: {
                baseUrl,
                apiKey,
                model,
                timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 120_000),
                maxRetries: Number(
                    process.env.APPFORGE_LLM_MAX_RETRIES ?? 1,
                ),
                stream:
                    process.env.APPFORGE_LLM_STREAM?.trim().toLowerCase() !==
                    "false",
                ...(llmServiceTier === "auto" || llmServiceTier === "default"
                    ? { serviceTier: llmServiceTier }
                    : {}),
                plannerTimeoutMs: Number(
                    process.env.APPFORGE_PLANNER_TIMEOUT_MS ?? 30_000,
                ),
                reviewerTimeoutMs: Number(
                    process.env.APPFORGE_REVIEWER_TIMEOUT_MS ?? 45_000,
                ),
                hardTimeoutMs: Number(
                    process.env.APPFORGE_LLM_HARD_TIMEOUT_MS ?? 240_000,
                ),
                parallelMaxTokens: Number(
                    process.env.APPFORGE_PARALLEL_CODER_MAX_TOKENS ?? 4_000,
                ),
                parallelThinking:
                    process.env.APPFORGE_PARALLEL_CODER_THINKING === "enabled" ||
                    process.env.APPFORGE_PARALLEL_CODER_THINKING === "auto"
                        ? process.env.APPFORGE_PARALLEL_CODER_THINKING
                        : "disabled",
                maxTokens: Number(process.env.APPFORGE_LLM_MAX_TOKENS ?? 8_000),
            },
        };

        if (currentRequest !== undefined) {
            agentOptions.currentRequest = currentRequest;
        }

        if (resetWorkspace !== undefined) {
            agentOptions.resetWorkspace = resetWorkspace;
        }

        if (signal !== undefined) {
            agentOptions.signal = signal;
        }

        if (onProgress !== undefined) {
            agentOptions.onProgress = onProgress;
        }

        if (maxRepairAttempts !== undefined) {
            agentOptions.maxRepairAttempts = maxRepairAttempts;
        }

        if (memoryContext !== undefined) {
            agentOptions.memoryContext = memoryContext;
        }

        if (imageAssetProvider) {
            agentOptions.imageAssetProvider = imageAssetProvider;
            agentOptions.imageAssetModes = imageAssetModes;
        }

        agentOptions.evaluateBrowser = async ({
            goal,
            workspaceRoot,
            signal: browserSignal,
        }) => {
            browserSignal?.throwIfAborted();
            const preview = await previewManager.start({
                runId: path.basename(workspaceRoot),
                workspaceRoot,
            });
            browserSignal?.throwIfAborted();

            return browserEvaluator.evaluate({
                url: preview.url,
                goal,
                ...(browserSignal ? { signal: browserSignal } : {}),
            });
        };

        return runReactAppAgent(agentOptions);
    },
    previewManager,
    new FileMemoryRepository(memoryStorePath),
    browserEvaluator,
);

try {
    const recoveredRunCount = await recoverInterruptedRuns(runRepository);

    if (recoveredRunCount > 0) {
        console.log(`Recovered ${recoveredRunCount} interrupted run(s)`);
    }

    await app.listen({
        host: "127.0.0.1",
        port: 3000,
    });

    console.log("AppForge API listening on http://127.0.0.1:3000");
    console.log("Preview launcher: direct Node/Vite process");
} catch (error) {
    app.log.error(error);
    process.exit(1);
}
