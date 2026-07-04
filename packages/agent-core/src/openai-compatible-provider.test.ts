import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

describe("OpenAICompatibleProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("sends messages and returns the model response", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: "Create src/App.tsx",
                            },
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            ),
        );

        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            model: "test-model",
        });

        const result = await provider.complete({
            messages: [
                {
                    role: "user",
                    content: "Create an application",
                },
            ],
        });

        expect(result.content).toBe("Create src/App.tsx");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://example.com/v1/chat/completions",
            expect.objectContaining({
                method: "POST",
            }),
        );
    });

    it("throws when the model request fails", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("Unauthorized", {
                status: 401,
            }),
        );

        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "invalid-key",
            model: "test-model",
        });

        await expect(
            provider.complete({
                messages: [],
            }),
        ).rejects.toThrow("Model request failed with 401");
    });

    it("throws a readable timeout error when the request is aborted", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
            new DOMException("This operation was aborted", "AbortError"),
        );

        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            model: "test-model",
            timeoutMs: 100,
        });

        await expect(
            provider.complete({
                messages: [],
            }),
        ).rejects.toThrow("Model request timed out after 100ms");
    });
});
