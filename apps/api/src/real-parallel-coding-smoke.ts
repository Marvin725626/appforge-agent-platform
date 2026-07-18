import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    OpenAICompatibleProvider,
    type PlannerOutput,
} from "@appforge/agent-core";

import { runParallelReactPagesAgent } from "./run-parallel-react-pages-agent.js";

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
const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 120_000),
    maxRetries: 0,
    stream:
        process.env.APPFORGE_LLM_STREAM?.trim().toLowerCase() !== "false",
    ...(serviceTier ? { serviceTier } : {}),
    maxTokens: Number(
        process.env.APPFORGE_PARALLEL_CODER_MAX_TOKENS ?? 4_000,
    ),
    thinking:
        process.env.APPFORGE_PARALLEL_CODER_THINKING === "enabled" ||
        process.env.APPFORGE_PARALLEL_CODER_THINKING === "auto"
            ? process.env.APPFORGE_PARALLEL_CODER_THINKING
            : "disabled",
});
const plannerOutput: PlannerOutput = {
    summary: "并行生成一个具备真实 URL 跳转的温州介绍界面",
    steps: [
        {
            id: "smoke-step",
            title: "按页面并发生成并验证路由站点",
            description:
                "首页、文化和行程页面分别生成，全部验证后再本地合并。",
            acceptanceCriteria: [
                "至少三个独立温州主题路由",
                "支持深链、活动导航和浏览器前进后退",
            ],
        },
    ],
    site: {
        title: "山海温州",
        tagline: "从瓯江到东海的城市旅程",
    },
    pages: [
        {
            id: "home",
            path: "/",
            label: "首页",
            purpose: "完整介绍温州的城市气质与旅行入口。",
            acceptanceCriteria: ["有独特主标题和三个实质内容模块"],
        },
        {
            id: "culture",
            path: "/culture",
            label: "文化",
            purpose: "介绍瓯越文脉、南戏和地方工艺。",
            acceptanceCriteria: ["内容与首页明显不同且完整"],
        },
        {
            id: "itinerary",
            path: "/itinerary",
            label: "行程",
            purpose: "提供清晰的温州旅行路线与节奏。",
            acceptanceCriteria: ["包含可执行的行程信息"],
        },
    ],
};
const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-real-parallel-smoke-"),
);

try {
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    const result = await runParallelReactPagesAgent({
        goal: "创建一个可在首页、文化和行程页面之间跳转的温州介绍界面",
        plannerOutput,
        model: provider,
        workspaceRoot,
        routeRequest: true,
        maxConcurrency: Number(
            process.env.APPFORGE_PARALLEL_CODER_CONCURRENCY ?? 2,
        ),
        workstreamTimeoutMs: Number(
            process.env.APPFORGE_PARALLEL_CODER_TIMEOUT_MS ?? 240_000,
        ),
    });

    if (!result.agent.finished) {
        throw new Error(
            result.agent.errorMessage ??
                "Real parallel Coding Agent smoke did not finish",
        );
    }

    const files = await Promise.all(
        result.workstreams.map(async (workstream) => ({
            role: workstream.role,
            path: workstream.path,
            status: workstream.status,
            generationAttempts: workstream.generationAttempts,
            bytes: (await stat(path.join(workspaceRoot, workstream.path))).size,
        })),
    );

    console.log(
        JSON.stringify(
            {
                completed: true,
                concurrency: Number(
                    process.env.APPFORGE_PARALLEL_CODER_CONCURRENCY ?? 2,
                ),
                files,
            },
            null,
            2,
        ),
    );
} finally {
    await rm(workspaceRoot, { recursive: true, force: true });
}
