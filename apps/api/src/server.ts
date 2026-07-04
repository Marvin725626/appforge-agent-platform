import path from "node:path";

import { WorkspaceManager } from "@appforge/workspace";

import { buildApp } from "./app.js";
import { FileRunRepository } from "./file-run-repository.js";
import {
    runReactAppAgent,
    type RunReactAppAgentOptions,
} from "./run-react-app-agent.js";

const workspacesRoot = path.resolve(".appforge","workspaces");
const runsStorePath = path.resolve(".appforge", "runs.json");
const templateRoot = path.resolve(
    "..",
    "..",
    "tests",
    "fixtures",
    "vite-react-starter",
);

const workspaceManager = new WorkspaceManager(workspacesRoot);
const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}
const app = buildApp(
    new FileRunRepository(runsStorePath),
    workspaceManager,
    async ({ goal, workspaceRoot, maxRepairAttempts, memoryContext }) => {
        const agentOptions: RunReactAppAgentOptions = {
            goal,
            workspaceRoot,
            templateRoot,
            llm: {
                baseUrl,
                apiKey,
                model,
                timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 300_000),
            },
        };

        if (maxRepairAttempts !== undefined) {
            agentOptions.maxRepairAttempts = maxRepairAttempts;
        }

        if (memoryContext !== undefined) {
            agentOptions.memoryContext = memoryContext;
        }

        return runReactAppAgent(agentOptions);
    },
);

try {
    await app.listen({
        host: "127.0.0.1",
        port: 3000,
    });

    console.log("AppForge API listening on http://127.0.0.1:3000");
} catch (error) {
    app.log.error(error);
    process.exit(1);
}
