import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    CompositeImageAssetProvider,
    OpenAICompatibleImageProvider,
    WebImageAssetProvider,
} from "@appforge/agent-core";

import { runReactAppAgent } from "./run-react-app-agent.js";

const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;
const imageBaseUrl = process.env.APPFORGE_IMAGE_BASE_URL;
const imageApiKey = process.env.APPFORGE_IMAGE_API_KEY;
const imageModel = process.env.APPFORGE_IMAGE_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}

if (!imageBaseUrl || !imageApiKey || !imageModel) {
    throw new Error("Missing required AppForge image environment variables");
}

const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-multi-agent-image-"),
);

const templateRoot = path.resolve(
    "..",
    "..",
    "tests",
    "fixtures",
    "vite-react-starter",
);

const imageAssetProvider = new CompositeImageAssetProvider([
    new WebImageAssetProvider(),
    new OpenAICompatibleImageProvider({
        baseUrl: imageBaseUrl,
        apiKey: imageApiKey,
        model: imageModel,
        timeoutMs: Number(process.env.APPFORGE_IMAGE_TIMEOUT_MS ?? 120_000),
    }),
]);

const result = await runReactAppAgent({
    goal: "创建一个中文温州旅游介绍页面，必须生成并展示一张温州城市风景横幅图片，包含标题、简介、美食、景点和交通信息。",
    workspaceRoot,
    templateRoot,
    maxRepairAttempts: 0,
    imageAssetProvider,
    imageAssetModes: ["search", "generate"],
    llm: {
        baseUrl,
        apiKey,
        model,
        timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 300_000),
        maxTokens: Number(process.env.APPFORGE_LLM_MAX_TOKENS ?? 12_000),
    },
});

const assetsRoot = path.join(workspaceRoot, "public", "assets");
const assets = await readdir(assetsRoot).catch(() => []);

console.log(
    JSON.stringify(
        {
            workspaceRoot,
            assets,
            plan: result.coordination.plan,
            accepted: result.review.accepted,
            llmReview: result.llmReview,
            attempts: result.attempts.map((attempt) => ({
                kind: attempt.kind,
                finished: attempt.agent.finished,
                steps: attempt.agent.steps.map((step) => ({
                    action: step.action,
                    execution: step.execution,
                })),
                review: attempt.review,
            })),
            trace: result.trace,
        },
        null,
        2,
    ),
);
