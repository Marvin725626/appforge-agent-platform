import { describe, expect, it } from "vitest";

import { completeStructuredOutput } from "./complete-structured-output.js";
import { FakeModelProvider } from "./fake-model-provider.js";

describe("completeStructuredOutput", () => {
    it("retries once after an invalid structured response", async () => {
        const provider = new FakeModelProvider([
            {
                content: "not json",
            },
            {
                content: JSON.stringify({
                    accepted: true,
                }),
            },
        ]);

        const result = await completeStructuredOutput({
            model: provider,
            request: {
                messages: [
                    {
                        role: "user",
                        content: "Return review JSON",
                    },
                ],
            },
            parse: (text) => JSON.parse(text) as { accepted: boolean },
            outputName: "ReviewerOutput",
        });

        expect(result).toEqual({
            accepted: true,
        });
        expect(provider.requests).toHaveLength(2);
        expect(
            provider.requests[1]?.messages.at(-1)?.content,
        ).toContain("response was invalid");
        expect(provider.requests[0]?.responseFormat).toBe("json_object");
        expect(provider.requests[1]?.responseFormat).toBe("json_object");
    });

    it("throws after the configured attempts remain invalid", async () => {
        const provider = new FakeModelProvider([
            {
                content: "first invalid response",
            },
            {
                content: "second invalid response",
            },
        ]);

        await expect(
            completeStructuredOutput({
                model: provider,
                request: {
                    messages: [
                        {
                            role: "user",
                            content: "Return JSON",
                        },
                    ],
                },
                parse: (text) => JSON.parse(text) as unknown,
                outputName: "PlannerOutput",
            }),
        ).rejects.toThrow(
            "PlannerOutput remained invalid after 2 attempt(s). Last validation error:",
        );
        expect(provider.requests).toHaveLength(2);
    });

    it("adds a custom invalid-response instruction to retry prompts", async () => {
        const provider = new FakeModelProvider([
            {
                content: "not json",
            },
            {
                content: JSON.stringify({
                    accepted: true,
                }),
            },
        ]);

        await completeStructuredOutput({
            model: provider,
            request: {
                messages: [
                    {
                        role: "user",
                        content: "Return review JSON",
                    },
                ],
            },
            parse: (text) => JSON.parse(text) as { accepted: boolean },
            outputName: "ReviewerOutput",
            invalidResponseInstruction: "Use a smaller response.",
        });

        expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
            "Use a smaller response.",
        );
    });

    it("uses strict json_schema and disables streaming when a schema is provided", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                accepted: true,
            }),
        });

        await completeStructuredOutput({
            model: provider,
            request: {
                messages: [
                    {
                        role: "user",
                        content: "Return review JSON",
                    },
                ],
            },
            schema: {
                type: "object",
                properties: {
                    accepted: { type: "boolean" },
                },
                required: ["accepted"],
                additionalProperties: false,
            },
            parse: (text) => JSON.parse(text) as { accepted: boolean },
            outputName: "ReviewerOutput",
        });

        expect(provider.requests[0]?.stream).toBe(false);
        expect(provider.requests[0]?.responseFormat).toEqual({
            type: "json_schema",
            name: "ReviewerOutput",
            strict: true,
            schema: {
                type: "object",
                properties: {
                    accepted: { type: "boolean" },
                },
                required: ["accepted"],
                additionalProperties: false,
            },
        });
    });

    it("returns output_truncated instead of retrying length-finished output", async () => {
        const provider = new FakeModelProvider([
            {
                content: '{"accepted":',
                finishReason: "length",
            },
            {
                content: JSON.stringify({
                    accepted: true,
                }),
            },
        ]);

        await expect(
            completeStructuredOutput({
                model: provider,
                request: {
                    messages: [
                        {
                            role: "user",
                            content: "Return review JSON",
                        },
                    ],
                },
                schema: {
                    type: "object",
                    properties: {
                        accepted: { type: "boolean" },
                    },
                    required: ["accepted"],
                    additionalProperties: false,
                },
                parse: (text) => JSON.parse(text) as { accepted: boolean },
                outputName: "ReviewerOutput",
            }),
        ).rejects.toThrow("output_truncated");
        expect(provider.requests).toHaveLength(1);
    });

    it("does not echo an oversized invalid response back into the retry prompt", async () => {
        const oversizedInvalidResponse = `{ "content": "${"x".repeat(2_000)}`;
        const provider = new FakeModelProvider([
            {
                content: oversizedInvalidResponse,
            },
            {
                content: JSON.stringify({
                    accepted: true,
                }),
            },
        ]);

        await completeStructuredOutput({
            model: provider,
            request: {
                messages: [
                    {
                        role: "user",
                        content: "Return review JSON",
                    },
                ],
            },
            parse: (text) => JSON.parse(text) as { accepted: boolean },
            outputName: "ReviewerOutput",
        });

        const retryAssistantMessage =
            provider.requests[1]?.messages.at(-2)?.content ?? "";

        expect(retryAssistantMessage).toContain(
            "Previous invalid response omitted",
        );
        expect(retryAssistantMessage.length).toBeLessThan(1_000);
    });
});
