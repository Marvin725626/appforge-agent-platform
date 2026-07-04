import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 180_000),
});

const workspaceRoot = await mkdtemp(
  path.join(os.tmpdir(), "appforge-real-loop-"),
);

const result = await runCodingAgentLoop({
  goal:
    "Create a README.md file for a tiny React task app. First return a write_file action for README.md, then return finish.",
  model: provider,
  workspaceRoot,
  maxSteps: 2,
  context:
    "Return only valid JSON. Do not wrap it in markdown. Allowed action types are write_file, run_command, and finish.",
});

console.log(JSON.stringify(result, null, 2));

const readmePath = path.join(workspaceRoot, "README.md");
const readmeContent = await readFile(readmePath, "utf8");

console.log(`Workspace: ${workspaceRoot}`);
console.log("README.md:");
console.log(readmeContent);
