import type {
    ModelProvider,
    ModelRequest,
} from "./model-provider.js";

export type CompleteStructuredOutputOptions<T> = {
    model: ModelProvider;
    request: ModelRequest;
    parse: (text: string) => T;
    outputName: string;
    maxAttempts?: number;
    invalidResponseInstruction?: string;
};

function limitText(text: string, maxLength: number): string {
    return text.length > maxLength
        ? `${text.slice(0, maxLength)}...`
        : text;
}

function formatInvalidAssistantContent(text: string): string {
    if (text.length <= 1_200) {
        return text;
    }

    return [
        `[Previous invalid response omitted because it was ${text.length} characters and likely too large or truncated.]`,
        `Preview: ${limitText(text, 800)}`,
    ].join("\n");
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function completeStructuredOutput<T>(
    options: CompleteStructuredOutputOptions<T>,
): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 2;

    if (maxAttempts < 1) {
        throw new Error("maxAttempts must be at least 1");
    }

    let request: ModelRequest = {
        ...options.request,
        responseFormat: options.request.responseFormat ?? "json_object",
    };
    let lastError: unknown;
    let lastOutput = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        request.signal?.throwIfAborted();
        const response = await options.model.complete(request);
        request.signal?.throwIfAborted();
        lastOutput = response.content;

        try {
            return options.parse(response.content);
        } catch (error) {
            lastError = error;

            if (attempt === maxAttempts) {
                break;
            }

            request = {
                ...request,
                messages: [
                    ...request.messages,
                    {
                        role: "assistant",
                        content: formatInvalidAssistantContent(response.content),
                    },
                    {
                        role: "user",
                        content: [
                            `Your previous ${options.outputName} response was invalid.`,
                            `Validation error: ${limitText(describeError(error), 1_000)}`,
                            "Return a corrected JSON object only, with no markdown or explanation.",
                            options.invalidResponseInstruction ?? "",
                        ].join("\n"),
                    },
                ],
            };
        }
    }

    throw new Error(
        `${options.outputName} remained invalid after ${maxAttempts} attempt(s). Last validation error: ${limitText(describeError(lastError), 1_000)}. Output preview: ${limitText(lastOutput, 500)}`,
        {
            cause: lastError,
        },
    );
}
