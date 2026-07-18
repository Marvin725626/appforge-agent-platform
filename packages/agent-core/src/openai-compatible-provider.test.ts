import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";

describe("OpenAICompatibleProvider", () => {
    afterEach(() => {
        vi.useRealTimers();
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

    it("sends Ark stream options and parses SSE across arbitrary chunk boundaries", async () => {
        const encoder = new TextEncoder();
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        for (const chunk of [
                            "da",
                            'ta: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r',
                            '\ndata: {"choices":[{"delta":{"content":"Create "}}]}\n\n',
                            'data: {"choices":[{"delta":{"content":"src/App',
                            '.tsx"}}]}\r\n\r\n',
                            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n',
                            "data: [DONE]\n\n",
                        ]) {
                            controller.enqueue(encoder.encode(chunk));
                        }
                        controller.close();
                    },
                }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "text/event-stream; charset=utf-8",
                    },
                },
            ),
        );
        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://ark.example.com/api/v3",
            apiKey: "test-key",
            model: "ep-test",
            stream: true,
            serviceTier: "auto",
            maxTokens: 3_000,
            maxRetries: 0,
        });
        const onActivity = vi.fn();

        await expect(
            provider.complete({
                responseFormat: "json_object",
                onActivity,
                messages: [
                    {
                        role: "user",
                        content: "Create an application",
                    },
                ],
            }),
        ).resolves.toEqual({
            content: "Create src/App.tsx",
        });

        const body = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(body).toMatchObject({
            model: "ep-test",
            max_tokens: 3_000,
            stream: true,
            stream_options: {
                include_usage: true,
            },
            service_tier: "auto",
            response_format: {
                type: "json_object",
            },
        });
        expect(onActivity).toHaveBeenCalled();
    });

    it("accepts a non-SSE JSON response when streaming was requested", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: "Non-stream fallback response",
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
            stream: true,
            maxRetries: 0,
        });

        await expect(
            provider.complete({ messages: [] }),
        ).resolves.toEqual({
            content: "Non-stream fallback response",
        });
    });

    it("falls back once when the service explicitly rejects streaming", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response("stream is not supported by this endpoint", {
                    status: 400,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: "Recovered without streaming",
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
            stream: true,
            serviceTier: "default",
            maxRetries: 0,
        });

        await expect(
            provider.complete({ messages: [] }),
        ).resolves.toEqual({
            content: "Recovered without streaming",
        });

        const firstBody = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;
        const secondBody = JSON.parse(
            String(fetchMock.mock.calls[1]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(firstBody.stream).toBe(true);
        expect(firstBody.stream_options).toEqual({ include_usage: true });
        expect(secondBody.stream).toBeUndefined();
        expect(secondBody.stream_options).toBeUndefined();
        expect(secondBody.service_tier).toBe("default");
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
        const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
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

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries a transient timeout once", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(
                new DOMException("This operation was aborted", "AbortError"),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: "Recovered after timeout",
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
            timeoutMs: 100,
        });

        await expect(
            provider.complete({
                messages: [],
            }),
        ).resolves.toEqual({
            content: "Recovered after timeout",
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries a transient rate limit response once", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response("Rate limited", {
                    status: 429,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: "Recovered after rate limit",
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

        await expect(
            provider.complete({
                messages: [],
            }),
        ).resolves.toEqual({
            content: "Recovered after rate limit",
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("forwards caller cancellation to fetch without converting it to a timeout", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
            (_input, init) =>
                new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal;

                    expect(signal).toBeInstanceOf(AbortSignal);
                    signal?.addEventListener(
                        "abort",
                        () => reject(new DOMException("aborted", "AbortError")),
                        { once: true },
                    );
                }),
        );
        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            model: "test-model",
            timeoutMs: 10_000,
        });
        const controller = new AbortController();
        const reason = new Error("run cancelled by user");
        const completion = provider.complete({
            messages: [],
            signal: controller.signal,
        });

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
        controller.abort(reason);

        await expect(completion).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("resets the idle timeout for reasoning, usage, and content SSE chunks", async () => {
        vi.useFakeTimers();
        const encoder = new TextEncoder();
        let bodyController:
            | ReadableStreamDefaultController<Uint8Array>
            | undefined;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        bodyController = controller;
                    },
                }),
                {
                    status: 200,
                    headers: {
                        "Content-Type": "text/event-stream",
                    },
                },
            ),
        );
        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            model: "test-model",
            stream: true,
            timeoutMs: 100,
            maxRetries: 0,
        });
        const completion = provider.complete({ messages: [] });

        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(80);
        bodyController?.enqueue(
            encoder.encode(
                'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
            ),
        );
        await vi.advanceTimersByTimeAsync(80);
        bodyController?.enqueue(
            encoder.encode(
                'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
            ),
        );
        await vi.advanceTimersByTimeAsync(80);
        bodyController?.enqueue(
            encoder.encode(
                'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
            ),
        );
        await vi.advanceTimersByTimeAsync(80);
        bodyController?.enqueue(encoder.encode("data: [DONE]\n\n"));
        bodyController?.close();

        await expect(completion).resolves.toEqual({ content: "A" });
    });

    it("cancels an active SSE read from the caller signal without retrying", async () => {
        const encoder = new TextEncoder();
        let bodyController:
            | ReadableStreamDefaultController<Uint8Array>
            | undefined;
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
            (_input, init) => {
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        bodyController = controller;
                        init?.signal?.addEventListener(
                            "abort",
                            () => controller.error(
                                new DOMException("aborted", "AbortError"),
                            ),
                            { once: true },
                        );
                    },
                });

                return Promise.resolve(
                    new Response(body, {
                        status: 200,
                        headers: {
                            "Content-Type": "text/event-stream",
                        },
                    }),
                );
            },
        );
        const provider = new OpenAICompatibleProvider({
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
            model: "test-model",
            stream: true,
            timeoutMs: 10_000,
        });
        const controller = new AbortController();
        const reason = new Error("run cancelled during stream");
        const completion = provider.complete({
            messages: [],
            signal: controller.signal,
        });

        await vi.waitFor(() => {
            expect(bodyController).toBeDefined();
        });
        bodyController?.enqueue(
            encoder.encode(
                'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
        );
        await Promise.resolve();
        controller.abort(reason);

        await expect(completion).rejects.toBe(reason);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries a transient network failure once", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockRejectedValueOnce(
                new TypeError("fetch failed", {
                    cause: new Error("read ECONNRESET"),
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: "Recovered",
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

        await expect(
            provider.complete({
                messages: [],
            }),
        ).resolves.toEqual({
            content: "Recovered",
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("requests JSON object responses when asked", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: '{"ok":true}',
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

        await provider.complete({
            responseFormat: "json_object",
            messages: [
                {
                    role: "user",
                    content: "Return JSON",
                },
            ],
        });

        const body = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(body.response_format).toEqual({
            type: "json_object",
        });
    });

    it("sends max_tokens when configured", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: "Done",
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
            maxTokens: 12_000,
        });

        await provider.complete({
            messages: [
                {
                    role: "user",
                    content: "Return a larger app",
                },
            ],
        });

        const body = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(body.max_tokens).toBe(12_000);
    });

    it("sends the configured thinking mode", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: '{"ok":true}',
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
            thinking: "disabled",
        });

        await provider.complete({
            messages: [
                {
                    role: "user",
                    content: "Return deterministic JSON",
                },
            ],
        });

        const body = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(body.thinking).toEqual({ type: "disabled" });
    });

    it("retries without thinking when a compatible service rejects it", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response("unknown parameter: thinking", {
                    status: 400,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: '{"ok":true}',
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
            thinking: "disabled",
        });

        await expect(
            provider.complete({
                messages: [
                    {
                        role: "user",
                        content: "Return JSON",
                    },
                ],
            }),
        ).resolves.toEqual({ content: '{"ok":true}' });

        const firstBody = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;
        const secondBody = JSON.parse(
            String(fetchMock.mock.calls[1]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(firstBody.thinking).toEqual({ type: "disabled" });
        expect(secondBody).not.toHaveProperty("thinking");
    });

    it("falls back when JSON object responses are unsupported", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response("response_format is not supported", {
                    status: 400,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                message: {
                                    content: '{"ok":true}',
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

        await expect(
            provider.complete({
                responseFormat: "json_object",
                messages: [
                    {
                        role: "user",
                        content: "Return JSON",
                    },
                ],
            }),
        ).resolves.toEqual({
            content: '{"ok":true}',
        });

        const firstBody = JSON.parse(
            String(fetchMock.mock.calls[0]?.[1]?.body),
        ) as Record<string, unknown>;
        const secondBody = JSON.parse(
            String(fetchMock.mock.calls[1]?.[1]?.body),
        ) as Record<string, unknown>;

        expect(firstBody.response_format).toEqual({
            type: "json_object",
        });
        expect(secondBody.response_format).toBeUndefined();
    });
});
