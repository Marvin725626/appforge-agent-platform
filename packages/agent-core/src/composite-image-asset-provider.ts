import type {
    ImageAssetProvider,
    ImageAssetRequest,
    ImageAssetResult,
} from "./image-asset-provider.js";

export class CompositeImageAssetProvider
    implements ImageAssetProvider
{
    constructor(
        private readonly providers: ImageAssetProvider[],
    ) {}

    async getImage(
        request: ImageAssetRequest,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult> {
        signal?.throwIfAborted();
        const errors: string[] = [];

        for (const provider of this.providers) {
            signal?.throwIfAborted();
            try {
                return await provider.getImage(request, signal);
            } catch (error) {
                if (signal?.aborted) {
                    signal.throwIfAborted();
                }
                errors.push(
                    error instanceof Error
                        ? error.message
                        : String(error),
                );
            }
        }

        throw new Error(
            `No image provider could handle ${request.mode} image request: ${errors.join(" | ")}`,
        );
    }
}
