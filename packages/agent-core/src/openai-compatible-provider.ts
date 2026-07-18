import { z } from "zod";

import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
} from "./model-provider.js";

export type OpenAICompatibleProviderOptions = {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
    maxRetries?: number;
    maxTokens?: number;
    stream?: boolean;
    serviceTier?: "auto" | "default";
    thinking?: "enabled" | "disabled" | "auto";
};

const ChatCompletionResponseSchema = z.object({
    choices: z
        .array(
            z.object({
                message: z.object({
                    content: z.string(),
                }),
            }),
        )
        .min(1),
});

const ChatCompletionChunkSchema = z.object({
    // Ark/OpenAI emit a final usage-only chunk with an empty choices array
    // when stream_options.include_usage is enabled.
    choices: z.array(
        z.object({
            delta: z
                .object({
                    content: z.string().nullable().optional(),
                })
                .passthrough(),
        }).passthrough(),
    ),
}).passthrough();

class ModelRequestIdleTimeoutError extends Error {}

class ResponseActivityTimeout {
    private timeout: ReturnType<typeof setTimeout> | undefined;
    private expiration: Promise<never> | undefined;

    constructor(
        private readonly timeoutMs: number,
        private readonly onTimeout: () => void,
    ) {
        this.reset();
    }

    reset(): void {
        this.clear();
        this.expiration = new Promise<never>((_resolve, reject) => {
            this.timeout = setTimeout(() => {
                this.onTimeout();
                reject(new ModelRequestIdleTimeoutError());
            }, this.timeoutMs);
        });
    }

    async wait<T>(operation: Promise<T>): Promise<T> {
        if (!this.expiration) {
            throw new Error("Response activity timeout is not active");
        }

        return await Promise.race([operation, this.expiration]);
    }

    clear(): void {
        if (this.timeout !== undefined) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
    }
}

async function consumeResponseText(
    response: Response,
    activityTimeout: ResponseActivityTimeout,
    consume: (text: string) => void,
    onActivity?: () => void,
): Promise<void> {
    if (!response.body) {
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const result = await activityTimeout.wait(reader.read());

            if (result.done) {
                break;
            }

            // Any body chunk is response activity, including reasoning-only,
            // usage-only, and SSE heartbeat chunks.
            activityTimeout.reset();
            reportModelActivity(onActivity);
            consume(decoder.decode(result.value, { stream: true }));
        }

        const trailingText = decoder.decode();

        if (trailingText.length > 0) {
            consume(trailingText);
        }
    } finally {
        // A timeout can reject our activity race just before the aborted fetch
        // settles its pending read. releaseLock throws in that narrow window.
        try {
            reader.releaseLock();
        } catch {
            // The request controller already owns cancellation of the body.
        }
    }
}

async function readResponseText(
    response: Response,
    activityTimeout: ResponseActivityTimeout,
    onActivity?: () => void,
): Promise<string> {
    const parts: string[] = [];

    await consumeResponseText(
        response,
        activityTimeout,
        (text) => {
            parts.push(text);
        },
        onActivity,
    );

    return parts.join("");
}

async function readChatCompletionEventStream(
    response: Response,
    activityTimeout: ResponseActivityTimeout,
    onActivity?: () => void,
): Promise<ModelResponse> {
    let lineBuffer = "";
    let dataLines: string[] = [];
    let content = "";
    let sawChoice = false;
    let reachedDone = false;

    const dispatchEvent = () => {
        if (dataLines.length === 0 || reachedDone) {
            dataLines = [];
            return;
        }

        const payload = dataLines.join("\n").trim();
        dataLines = [];

        if (payload === "[DONE]") {
            reachedDone = true;
            return;
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(payload) as unknown;
        } catch (error) {
            throw new Error("Model stream contained an invalid JSON event", {
                cause: error,
            });
        }

        const chunk = ChatCompletionChunkSchema.parse(parsed);
        const choice = chunk.choices[0];

        if (!choice) {
            // stream_options.include_usage adds a final usage-only event with
            // choices: []; it carries no assistant text and is intentionally
            // ignored.
            return;
        }

        sawChoice = true;

        if (typeof choice.delta.content === "string") {
            content += choice.delta.content;
        }
    };

    const consumeLine = (rawLine: string) => {
        if (reachedDone) {
            return;
        }

        const line = rawLine.endsWith("\r")
            ? rawLine.slice(0, -1)
            : rawLine;

        if (line.length === 0) {
            dispatchEvent();
            return;
        }

        if (line.startsWith(":")) {
            return;
        }

        const separatorIndex = line.indexOf(":");
        const field = separatorIndex >= 0
            ? line.slice(0, separatorIndex)
            : line;

        if (field !== "data") {
            return;
        }

        let value = separatorIndex >= 0
            ? line.slice(separatorIndex + 1)
            : "";

        if (value.startsWith(" ")) {
            value = value.slice(1);
        }

        dataLines.push(value);
    };

    await consumeResponseText(response, activityTimeout, (text) => {
        lineBuffer += text;

        while (true) {
            const newlineIndex = lineBuffer.indexOf("\n");

            if (newlineIndex < 0) {
                break;
            }

            const line = lineBuffer.slice(0, newlineIndex);
            lineBuffer = lineBuffer.slice(newlineIndex + 1);
            consumeLine(line);
        }
    }, onActivity);

    if (!reachedDone && lineBuffer.length > 0) {
        consumeLine(lineBuffer);
    }

    if (!reachedDone) {
        dispatchEvent();
    }

    if (!sawChoice) {
        throw new Error("Model stream did not include a choice");
    }

    return { content };
}

function isEventStreamResponse(response: Response): boolean {
    return (response.headers.get("content-type") ?? "")
        .toLowerCase()
        .includes("text/event-stream");
}

function reportModelActivity(onActivity: (() => void) | undefined): void {
    try {
        onActivity?.();
    } catch {
        // Progress reporting is observability only.
    }
}

export class OpenAICompatibleProvider implements ModelProvider {
    constructor(
        private readonly options: OpenAICompatibleProviderOptions,
    ) {}

    async complete(request: ModelRequest): Promise<ModelResponse> {
        request.signal?.throwIfAborted();
        const maxRetries = this.options.maxRetries ?? 1;
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
            request.signal?.throwIfAborted();

            try {
                return await this.completeOnce(request);
            } catch (error) {
                lastError = error;

                if (
                    !isTransientModelRequestError(error) ||
                    attempt === maxRetries
                ) {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    private async completeOnce(
        request: ModelRequest,
    ): Promise<ModelResponse> {
        let useStream = this.options.stream === true;
        let useJsonResponseFormat = request.responseFormat === "json_object";
        let useThinking = this.options.thinking !== undefined;

        // Compatibility fallbacks can omit unsupported response_format,
        // streaming, and provider-specific thinking controls independently.
        for (let fallback = 0; fallback < 4; fallback += 1) {
            try {
                return await this.completeOnceWithRequest(request, {
                    useStream,
                    useJsonResponseFormat,
                    useThinking,
                });
            } catch (error) {
                if (useStream && isUnsupportedStreamError(error)) {
                    useStream = false;
                    continue;
                }

                if (useThinking && isUnsupportedThinkingError(error)) {
                    useThinking = false;
                    continue;
                }

                if (
                    useJsonResponseFormat &&
                    isUnsupportedResponseFormatError(error)
                ) {
                    useJsonResponseFormat = false;
                    continue;
                }

                throw error;
            }
        }

        throw new Error("Model request compatibility fallbacks were exhausted");
    }

    private async completeOnceWithRequest(
        request: ModelRequest,
        compatibility: {
            useStream: boolean;
            useJsonResponseFormat: boolean;
            useThinking: boolean;
        },
    ): Promise<ModelResponse> {
        const controller = new AbortController();
        const timeoutMs = this.options.timeoutMs ?? 60_000;
        const abortFromRequest = () => {
            controller.abort(request.signal?.reason);
        };

        if (request.signal?.aborted) {
            request.signal.throwIfAborted();
        }

        request.signal?.addEventListener("abort", abortFromRequest, {
            once: true,
        });

        const activityTimeout = new ResponseActivityTimeout(
            timeoutMs,
            () => controller.abort(),
        );

        try {
            const response = await activityTimeout.wait(
                fetch(`${this.options.baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.options.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: this.options.model,
                        messages: request.messages,
                        ...(this.options.maxTokens !== undefined
                            ? { max_tokens: this.options.maxTokens }
                            : {}),
                        ...(compatibility.useJsonResponseFormat
                            ? {
                                  response_format: {
                                      type: "json_object",
                                  },
                              }
                            : {}),
                        ...(compatibility.useStream
                            ? {
                                  stream: true,
                                  stream_options: {
                                      include_usage: true,
                                  },
                              }
                            : {}),
                        ...(this.options.serviceTier
                            ? { service_tier: this.options.serviceTier }
                            : {}),
                        ...(compatibility.useThinking && this.options.thinking
                            ? {
                                  thinking: {
                                      type: this.options.thinking,
                                  },
                              }
                            : {}),
                    }),
                    signal: controller.signal,
                }),
            );
            activityTimeout.reset();
            reportModelActivity(request.onActivity);

            if (!response.ok) {
                const errorBody = await readResponseText(
                    response,
                    activityTimeout,
                    request.onActivity,
                );

                throw new Error(
                    `Model request failed with ${response.status}: ${errorBody}`,
                );
            }

            if (isEventStreamResponse(response)) {
                return await readChatCompletionEventStream(
                    response,
                    activityTimeout,
                    request.onActivity,
                );
            }

            // Some OpenAI-compatible services ignore stream=true and return a
            // normal JSON completion. Keep that response usable.
            const responseText = await readResponseText(
                response,
                activityTimeout,
                request.onActivity,
            );
            const data = ChatCompletionResponseSchema.parse(
                JSON.parse(responseText) as unknown,
            );
            const firstChoice = data.choices[0];

            if (!firstChoice) {
                throw new Error("Model response did not include a choice");
            }

            return {
                content: firstChoice.message.content,
            };
        } catch (error) {
            if (request.signal?.aborted) {
                request.signal.throwIfAborted();
            }

            if (
                error instanceof ModelRequestIdleTimeoutError ||
                (error instanceof DOMException && error.name === "AbortError")
            ) {
                throw new Error(
                    `Model request timed out after ${timeoutMs}ms of inactivity`,
                );
            }

            if (error instanceof TypeError && error.message === "fetch failed") {
                const cause = error.cause instanceof Error
                    ? `: ${error.cause.message}`
                    : "";

                throw new Error(
                    `Model request failed before receiving a response${cause}`,
                );
            }

            throw error;
        } finally {
            activityTimeout.clear();
            request.signal?.removeEventListener("abort", abortFromRequest);
        }
    }
}

function isTransientModelRequestError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    if (
        error.message.startsWith(
            "Model request failed before receiving a response",
        ) ||
        error.message.startsWith("Model request timed out after")
    ) {
        return true;
    }

    const statusMatch = /^Model request failed with (\d{3}):/u.exec(
        error.message,
    );
    const status = statusMatch?.[1]
        ? Number.parseInt(statusMatch[1], 10)
        : undefined;

    return (
        status !== undefined &&
        (status === 408 || status === 429 || status >= 500)
    );
}

function isUnsupportedStreamError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();
    const mentionsStreaming =
        /\bstream(?:ing)?\b|stream_options/u.test(message);

    return (
        mentionsStreaming &&
        /not supported|does not support|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|invalid (?:field|parameter)|must be false/u.test(
            message,
        )
    );
}

function isUnsupportedResponseFormatError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();

    return (
        message.includes("response_format") &&
        (message.includes("unsupported") ||
            message.includes("invalid") ||
            message.includes("not support") ||
            message.includes("not supported"))
    );
}

function isUnsupportedThinkingError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const message = error.message.toLowerCase();

    return (
        /\bthinking\b|reasoning mode/u.test(message) &&
        /not supported|does not support|unsupported|unknown (?:field|parameter)|unrecognized (?:field|parameter)|invalid (?:field|parameter)/u.test(
            message,
        )
    );
}
