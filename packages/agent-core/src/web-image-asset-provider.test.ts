import { afterEach, describe, expect, it, vi } from "vitest";

import { WebImageAssetProvider } from "./web-image-asset-provider.js";

const PNG_BYTES = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
]);

describe("WebImageAssetProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("downloads a direct image URL", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(
                new Response(PNG_BYTES, {
                    status: 200,
                    headers: {
                        "Content-Type": "image/png",
                    },
                }),
            );

        const result = await new WebImageAssetProvider().getImage({
            query: "https://example.com/logo.png",
            mode: "search",
            altText: "Example logo",
        });

        expect(fetchMock).toHaveBeenCalledWith(
            new URL("https://example.com/logo.png"),
            expect.objectContaining({
                headers: expect.objectContaining({
                    "User-Agent":
                        "AppForgeAgentPlatform/0.1 image-fetch",
                }),
            }),
        );
        expect(result).toEqual({
            data: PNG_BYTES,
            mediaType: "image/png",
            source: "web:https://example.com/logo.png",
            attribution:
                "Found on https://example.com/logo.png",
        });
    });

    it("finds an image from a page", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(
                    '<html><img src="/assets/brand-logo.png" alt="Tsinghua logo"></html>',
                    {
                        status: 200,
                        headers: {
                            "Content-Type": "text/html",
                        },
                    },
                ),
            )
            .mockResolvedValueOnce(
                new Response(PNG_BYTES, {
                    status: 200,
                    headers: {
                        "Content-Type": "image/png",
                    },
                }),
            );

        const result = await new WebImageAssetProvider().getImage({
            query: "Tsinghua logo https://example.edu/about",
            mode: "search",
            altText: "Tsinghua logo",
        });

        expect(fetchMock.mock.calls[1]?.[0]).toEqual(
            new URL("https://example.edu/assets/brand-logo.png"),
        );
        expect(result.source).toBe(
            "web:https://example.edu/assets/brand-logo.png",
        );
        expect(result.attribution).toBe(
            "Found on https://example.edu/about",
        );
    });

    it("rejects local network URLs", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(
            new WebImageAssetProvider().getImage({
                query: "http://127.0.0.1/logo.png",
                mode: "search",
                altText: "Local logo",
            }),
        ).rejects.toThrow(
            "Local and private network URLs are not allowed",
        );

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects generate mode", async () => {
        await expect(
            new WebImageAssetProvider().getImage({
                query: "A new hero image",
                mode: "generate",
                altText: "Hero",
            }),
        ).rejects.toThrow(
            "WebImageAssetProvider only supports search mode",
        );
    });
});
