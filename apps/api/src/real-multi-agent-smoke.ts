import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runReactAppAgent } from "./run-react-app-agent.js";

const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}

const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-multi-agent-"),
);

const templateRoot = path.resolve(
    "..",
    "..",
    "tests",
    "fixtures",
    "vite-react-starter",
);

const result = await runReactAppAgent({
    goal: "创建一个简洁的中文待办事项页面，包含输入框、添加按钮和任务列表。",
    workspaceRoot,
    templateRoot,
    maxRepairAttempts: 0,
    llm: {
        baseUrl,
        apiKey,
        model,
        timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 300_000),
        maxTokens: Number(process.env.APPFORGE_LLM_MAX_TOKENS ?? 12_000),
    },
});

console.log(
    JSON.stringify(
        {
            workspaceRoot,
            plan: result.coordination.plan,
            assignments: result.coordination.assignments,
            llmReview: result.llmReview,
            accepted: result.review.accepted,
            trace: result.trace,
        },
        null,
        2,
    ),
);
