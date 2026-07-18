import { describe, expect, it } from "vitest";

import { FakeImageAssetProvider } from "./fake-image-asset-provider.js";

describe("FakeImageAssetProvider", () => {
    it("records the request and returns the configured image", async () => {
        const imageData = Uint8Array.from([
            137, 80, 78, 71,
        ]);

        const provider = new FakeImageAssetProvider({
            data: imageData,
            mediaType: "image/png",
            source: "fake://wenzhou-image",
            attribution: "Test image",
        });

        const result = await provider.getImage({
            query: "温州江心屿",
            mode: "search",
            altText: "温州江心屿风景",
        });

        expect(provider.requests).toEqual([
            {
                query: "温州江心屿",
                mode: "search",
                altText: "温州江心屿风景",
            },
        ]);

        expect(result.data).toEqual(imageData);
        expect(result.mediaType).toBe("image/png");
        expect(result.source).toBe(
            "fake://wenzhou-image",
        );
    });

    it("throws when no configured image remains", async () => {
        const provider = new FakeImageAssetProvider({
            data: Uint8Array.from([1]),
            mediaType: "image/png",
            source: "fake://image",
        });

        await provider.getImage({
            query: "first image",
            mode: "search",
            altText: "First image",
        });

        await expect(
            provider.getImage({
                query: "second image",
                mode: "search",
                altText: "Second image",
            }),
        ).rejects.toThrow(
            "FakeImageAssetProvider has no result",
        );
    });
});