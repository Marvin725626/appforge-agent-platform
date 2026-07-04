import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
} from "./model-provider.js";
import { z } from "zod";
export type OpenAICompatibleProviderOptions ={
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
};
const ChatCompletionResponseSchema = z.object({
    choices:z.array(
        z.object({
            message:z.object({content:z.string(),}),
        }),
    ).min(1)
})
export class OpenAICompatibleProvider implements ModelProvider {
    constructor(
        private readonly options: OpenAICompatibleProviderOptions,
    ) {}

    async complete(request: ModelRequest): Promise<ModelResponse> {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, this.options.timeoutMs ?? 60_000);

        const timeoutMs = this.options.timeoutMs ?? 60_000;

        try {
            const response = await fetch(
                `${this.options.baseUrl}/chat/completions`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.options.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: this.options.model,
                        messages: request.messages,
                    }),
                    signal: controller.signal,
                },
            );

            if (!response.ok) {
                const errorBody = await response.text();

                throw new Error(
                    `Model request failed with ${response.status}: ${errorBody}`,
                );
            }

            const data = ChatCompletionResponseSchema.parse(
                await response.json(),
            );

            const firstChoice = data.choices[0];

            if (!firstChoice) {
                throw new Error("Model response did not include a choice");
            }

            return {
                content: firstChoice.message.content,
            };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new Error(`Model request timed out after ${timeoutMs}ms`);
            }

            if (error instanceof TypeError && error.message === "fetch failed") {
                const cause =
                    error.cause instanceof Error ? `: ${error.cause.message}` : "";

                throw new Error(`Model request failed before receiving a response${cause}`);
            }

            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }
}
