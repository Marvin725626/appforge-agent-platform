import type {
    ImageAssetProvider,
    ImageAssetRequest,
    ImageAssetResult,
} from "./image-asset-provider.js";

export class FakeImageAssetProvider
    implements ImageAssetProvider
{
    readonly requests: ImageAssetRequest[] = [];

    private readonly results: ImageAssetResult[];

    constructor(
        result: ImageAssetResult | ImageAssetResult[],
    ) {
        this.results = Array.isArray(result)
            ? result
            : [result];
    }

    async getImage(
        request: ImageAssetRequest,
    ): Promise<ImageAssetResult> {
        this.requests.push(request);

        const result =
            this.results[this.requests.length - 1];

        if (!result) {
            throw new Error(
                "FakeImageAssetProvider has no result for this request",
            );
        }

        return result;
    }
}