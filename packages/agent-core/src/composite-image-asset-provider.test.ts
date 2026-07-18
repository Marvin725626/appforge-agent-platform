import { describe, expect, it } from "vitest";

import { CompositeImageAssetProvider } from "./composite-image-asset-provider.js";
import type {
    ImageAssetProvider,
    ImageAssetRequest,
} from "./image-asset-provider.js";

const PNG_BYTES = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
]);

class ModeProvider implements ImageAssetProvider {
    constructor(private readonly mode: ImageAssetRequest["mode"]) {}

    async getImage(request: ImageAssetRequest) {
        if (request.mode !== this.mode) {
            throw new Error(`Unsupported mode: ${request.mode}`);
        }

        return {
            data: PNG_BYTES,
            mediaType: "image/png" as const,
            source: `${this.mode}:provider`,
        };
    }
}

describe("CompositeImageAssetProvider", () => {
    it("tries providers until one handles the request", async () => {
        const provider = new CompositeImageAssetProvider([
            new ModeProvider("search"),
            new ModeProvider("generate"),
        ]);

        await expect(
            provider.getImage({
                query: "hero",
                mode: "generate",
                altText: "Hero",
            }),
        ).resolves.toEqual({
            data: PNG_BYTES,
            mediaType: "image/png",
            source: "generate:provider",
        });
    });
});
