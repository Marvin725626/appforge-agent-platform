import type { AgentAction } from "@appforge/protocol";

import type { ModelProvider } from "./model-provider.js";
import { parseAgentAction } from "./parse-agent-action.js";

export type CodingAgentOptions = {
    model: ModelProvider;
};

export class CodingAgent {
    constructor(private readonly options: CodingAgentOptions) {}

    async decideNextAction(
        goal: string,
        context = "",
    ): Promise<AgentAction> {
        const response = await this.options.model.complete({
            messages: [
                {
                    role: "system",
                    content:
                        [
                            "You are a coding agent.",
                            "Return exactly one JSON object and no markdown.",
                            'For write_file, use: {"type":"write_file","path":"README.md","content":"..."}',
                            'For run_command, use: {"type":"run_command","command":"npm","args":["run","build"]}',
                            'For finish, use: {"type":"finish","summary":"..."}',
                            'Do not use {"action": "...", "args": {...}}.',
                            "Preserve the user's language exactly.",
                            "All user-facing UI text, page content, and finish summaries must use the same natural language as the user's goal.",
                            "If the user writes Chinese, generate readable UTF-8 Chinese text, never English-only content, mojibake, or garbled text.",
                            "If the previous execution context shows the requested work is already complete, return a finish action instead of repeating the same action.",
                        ].join(" "),
                },
                {
                    role: "user",
                    content:
                        context.length > 0
                            ? `${goal}\n\nPrevious execution context:\n${context}`
                            : goal,
                },
            ],
        });

        return parseAgentAction(response.content);
    }
}
