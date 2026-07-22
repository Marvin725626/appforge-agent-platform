import path from "node:path";

import { WorkspaceManager } from "@appforge/workspace";

import { buildApp } from "./app.js";
import { FileRunRepository } from "./file-run-repository.js";
import { recoverInterruptedRuns } from "./recover-interrupted-runs.js";
import {
    runReactAppAgent,
} from "./run-react-app-agent.js";
import { createServerRunReactAppAgentOptions } from "./server-agent-options.js";
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
        designPlan,
        resetWorkspace,
        signal,
        onProgress,
    }) => {
        const agentOptions = createServerRunReactAppAgentOptions(
            {
                goal,
                workspaceRoot,
                ...(currentRequest !== undefined ? { currentRequest } : {}),
                ...(maxRepairAttempts !== undefined
                    ? { maxRepairAttempts }
                    : {}),
                ...(memoryContext !== undefined ? { memoryContext } : {}),
                ...(designPlan !== undefined ? { designPlan } : {}),
                ...(resetWorkspace !== undefined ? { resetWorkspace } : {}),
                ...(signal !== undefined ? { signal } : {}),
                ...(onProgress !== undefined ? { onProgress } : {}),
            },
            {
                templateRoot,
                baseUrl,
                apiKey,
                model,
                ...(llmServiceTier !== undefined ? { llmServiceTier } : {}),
                imageAssetProvider,
                imageAssetModes,
            },
        );

        if (designPlan !== undefined) {
            agentOptions.designPlan = designPlan;
        }

        agentOptions.evaluateBrowser = async ({
            goal,
            workspaceRoot,
            attemptNumber,
            browserProbes,
            signal: browserSignal,
        }) => {
            browserSignal?.throwIfAborted();
            const preview = await previewManager.start({
                runId: path.basename(workspaceRoot),
                workspaceRoot,
            
                forceRestart: true,
            });
            browserSignal?.throwIfAborted();

            const runId = path.basename(workspaceRoot);
            const appforgeRoot = path.dirname(path.dirname(workspaceRoot));
            const artifactDirectory = path.join(
                appforgeRoot,
                "artifacts",
                runId,
                "visual-evaluation",
                `attempt-${attemptNumber}`,
            );

            return browserEvaluator.evaluate({
                url: preview.url,
                goal,
                artifactDirectory,
                ...(browserProbes && browserProbes.length > 0
                    ? { probes: browserProbes }
                    : {}),
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
