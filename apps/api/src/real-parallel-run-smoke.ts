import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { PlaywrightBrowserEvaluator } from "@appforge/harness";

import { PreviewManager } from "./preview-manager.js";
import { runReactAppAgent } from "./run-react-app-agent.js";

const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}

const serviceTierValue = process.env.APPFORGE_LLM_SERVICE_TIER;
const serviceTier =
    serviceTierValue === "auto" || serviceTierValue === "default"
        ? serviceTierValue
        : undefined;
const parallelThinkingValue =
    process.env.APPFORGE_PARALLEL_CODER_THINKING;
const parallelThinking =
    parallelThinkingValue === "enabled" || parallelThinkingValue === "auto"
        ? parallelThinkingValue
        : "disabled";
const workspaceRoot = await mkdtemp(
    path.join(
        path.resolve("..", "..", "node_modules"),
        "appforge-real-parallel-run-",
    ),
);
const previewManager = new PreviewManager();
const browserEvaluator = new PlaywrightBrowserEvaluator();
const previewOptions = {
    runId: path.basename(workspaceRoot),
    workspaceRoot,
};
const templateRoot = path.resolve(
    "..",
    "..",
    "tests",
    "fixtures",
    "vite-react-starter",
);
const startedAt = Date.now();
let smokePassed = false;

try {
    const result = await runReactAppAgent({
        goal: "创建一个完整精美的温州介绍界面，包含首页、文化和行程页面，并且可以通过真实 URL 跳转",
        workspaceRoot,
        templateRoot,
        parallelCoding: true,
        parallelCodingConcurrency: Number(
            process.env.APPFORGE_PARALLEL_CODER_CONCURRENCY ?? 2,
        ),
        parallelCodingTimeoutMs: Number(
            process.env.APPFORGE_PARALLEL_CODER_TIMEOUT_MS ?? 240_000,
        ),
        maxRepairAttempts: 0,
        evaluateBrowser: async ({ goal, signal }) => {
            signal?.throwIfAborted();
            const preview = await previewManager.start(previewOptions);
            signal?.throwIfAborted();

            return browserEvaluator.evaluate({
                url: preview.url,
                goal,
                timeoutMs: 15_000,
                ...(signal ? { signal } : {}),
            });
        },
        llm: {
            baseUrl,
            apiKey,
            model,
            timeoutMs: Number(
                process.env.APPFORGE_LLM_TIMEOUT_MS ?? 120_000,
            ),
            hardTimeoutMs: Number(
                process.env.APPFORGE_LLM_HARD_TIMEOUT_MS ?? 240_000,
            ),
            maxRetries: Number(
                process.env.APPFORGE_LLM_MAX_RETRIES ?? 1,
            ),
            stream:
                process.env.APPFORGE_LLM_STREAM?.trim().toLowerCase() !==
                "false",
            ...(serviceTier ? { serviceTier } : {}),
            plannerTimeoutMs: Number(
                process.env.APPFORGE_PLANNER_TIMEOUT_MS ?? 30_000,
            ),
            reviewerTimeoutMs: Number(
                process.env.APPFORGE_REVIEWER_TIMEOUT_MS ?? 45_000,
            ),
            maxTokens: Number(
                process.env.APPFORGE_LLM_MAX_TOKENS ?? 8_000,
            ),
            parallelMaxTokens: Number(
                process.env.APPFORGE_PARALLEL_CODER_MAX_TOKENS ?? 4_000,
            ),
            parallelThinking,
        },
    });
    const workstreams = result.attempts[0]?.parallelWorkstreams ?? [];
    const appSource = await readFile(
        path.join(workspaceRoot, "src", "App.tsx"),
        "utf8",
    ).catch(() => "");

    console.log(
        JSON.stringify(
            {
                completed: result.agent.finished,
                accepted: result.review.accepted,
                elapsedMs: Date.now() - startedAt,
                installExitCode: result.install.exitCode,
                buildExitCode: result.build.exitCode,
                evalPassed: result.eval.passed,
                browserEvalPassed: result.browserEval?.passed ?? false,
                diagnostics: {
                    appBytes: Buffer.byteLength(appSource),
                    hasLocationHash: /window\.location\.hash/u.test(appSource),
                    hasHashchange: /hashchange/u.test(appSource),
                    hasHashListener:
                        /addEventListener\s*\(\s*["']hashchange["']/u.test(
                            appSource,
                        ),
                    buildStderr: result.build.stderr.slice(0, 2_000),
                    browserChecks:
                        result.browserEval?.checks.map((check) => ({
                            name: check.name,
                            passed: check.passed,
                            ...(check.message
                                ? { message: check.message }
                                : {}),
                        })) ?? [],
                },
                workstreams: workstreams.map((workstream) => ({
                    role: workstream.role,
                    status: workstream.status,
                    generationAttempts: workstream.generationAttempts,
                })),
            },
            null,
            2,
        ),
    );

    if (
        !result.agent.finished ||
        result.install.exitCode !== 0 ||
        result.build.exitCode !== 0 ||
        !result.eval.passed ||
        !result.browserEval?.passed ||
        !result.review.accepted
    ) {
        throw new Error(`Full parallel run smoke failed: ${result.review.reason}`);
    }

    smokePassed = true;
} finally {
    await previewManager.stop(previewOptions).catch(() => undefined);
    if (
        smokePassed ||
        process.env.APPFORGE_KEEP_FAILED_SMOKE?.trim().toLowerCase() !== "true"
    ) {
        await rm(workspaceRoot, {
            recursive: true,
            force: true,
            maxRetries: 12,
            retryDelay: 250,
        }).catch((error: unknown) => {
            const message =
                error instanceof Error ? error.message : String(error);
            console.error(
                `Smoke result is unchanged, but its temporary workspace could not be removed: ${message}`,
            );
        });
    } else {
        console.error(`Preserved failed smoke workspace: ${workspaceRoot}`);
    }
}
