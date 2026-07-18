import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatibleImageProvider } from "./openai-compatible-image-provider.js";

const PNG_BYTES = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
]);

function createProvider() {
    return new OpenAICompatibleImageProvider({
        baseUrl: "https://example.com/v1/",
        apiKey: "test-key",
        model: "test-image-model",
    });
}

describe("OpenAICompatibleImageProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("requests and decodes a Base64 image", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            b64_json:
                                Buffer.from(PNG_BYTES).toString("base64"),
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

        const result = await createProvider().getImage({
            query: "A Wenzhou landscape",
            mode: "generate",
            altText: "Wenzhou landscape",
        });

        expect(result).toEqual({
            data: PNG_BYTES,
            mediaType: "image/png",
            source: "generated:test-image-model",
        });

        const [url, request] = fetchMock.mock.calls[0] ?? [];

        expect(url).toBe(
            "https://example.com/v1/images/generations",
        );
        expect(request?.method).toBe("POST");
        expect(request?.headers).toEqual({
            Authorization: "Bearer test-key",
            "Content-Type": "application/json",
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            model: "test-image-model",
            prompt: "A Wenzhou landscape",
            response_format: "b64_json",
        });
    });

    it("rejects search mode before making a request", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(
            createProvider().getImage({
                query: "Wenzhou",
                mode: "search",
                altText: "Wenzhou",
            }),
        ).rejects.toThrow(
            "OpenAICompatibleImageProvider only supports generate mode",
        );

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("includes the HTTP status when image generation fails", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("invalid model", {
                status: 400,
            }),
        );

        await expect(
            createProvider().getImage({
                query: "Wenzhou",
                mode: "generate",
                altText: "Wenzhou",
            }),
        ).rejects.toThrow(
            "Image request failed with 400: invalid model",
        );
    });

    it("rejects Base64 data that is not a supported image", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            b64_json:
                                Buffer.from("not an image").toString("base64"),
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

        await expect(
            createProvider().getImage({
                query: "Wenzhou",
                mode: "generate",
                altText: "Wenzhou",
            }),
        ).rejects.toThrow(
            "Image response is not a supported PNG, JPEG, or WebP file",
        );
    });
});
