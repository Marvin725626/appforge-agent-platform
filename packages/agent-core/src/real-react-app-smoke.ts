import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    copyWorkspaceTemplate,
    runWorkspaceCommand,
} from "@appforge/workspace";

import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { runCodingAgentLoop } from "./run-coding-agent-loop.js";

const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
const apiKey = process.env.APPFORGE_LLM_API_KEY;
const model = process.env.APPFORGE_LLM_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error("Missing required AppForge LLM environment variables");
}

const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 300_000),
    maxTokens: Number(process.env.APPFORGE_LLM_MAX_TOKENS ?? 12_000),
});

const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-react-smoke-"),
);

const templateRoot = path.resolve(
    process.cwd(),
    "../../tests/fixtures/vite-react-starter",
);

await copyWorkspaceTemplate(workspaceRoot, templateRoot);

const agentResult = await runCodingAgentLoop({
    goal:
        "Modify src/App.tsx to implement a simple React task list UI with an input, an add button, and a visible list of example tasks. Only edit src/App.tsx, then finish.",
    model: provider,
    workspaceRoot,
    maxSteps: 3,
    context:
        "The workspace is an existing Vite React TypeScript project. Return only valid JSON. First write src/App.tsx using a write_file action. src/main.tsx imports a named export with `import { App } from \"./App.js\"`, so src/App.tsx must export `App` as a named export, for example `export function App() { ... }`. Do not use only `export default App`. If src/App.tsx has already been written successfully, return finish. Do not edit package.json.",
});

console.log("Agent result:");
console.log(JSON.stringify(agentResult, null, 2));

const installResult = await runWorkspaceCommand(workspaceRoot, {
    command: "npm",
    args: ["install"],
});

if (installResult.exitCode !== 0) {
    throw new Error(installResult.stderr || installResult.stdout);
}

const buildResult = await runWorkspaceCommand(workspaceRoot, {
    command: "npm",
    args: ["run", "build"],
});

if (buildResult.exitCode !== 0) {
    throw new Error(buildResult.stderr || buildResult.stdout);
}

const appContent = await readFile(
    path.join(workspaceRoot, "src", "App.tsx"),
    "utf8",
);

console.log(`Workspace: ${workspaceRoot}`);
console.log("src/App.tsx:");
console.log(appContent);
console.log("React app smoke passed.");
