import { createPlan } from "./create-plan.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

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
  timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 60_000),
});

const plan = await createPlan(
  provider,
  "Create a React task management application",
);

console.log(plan);
