import { z } from "zod";

import type {
    ImageAssetProvider,
    ImageAssetRequest,
    ImageAssetResult,
} from "./image-asset-provider.js";

const ImageGenerationResponseSchema = z.object({
    data: z.array(
        z.object({
            b64_json: z.string().min(1).optional(),
        }),
    ).min(1),
});

export type OpenAICompatibleImageProviderOptions = {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
};

function detectImageMediaType(
    data: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" {
    const isPng =
        data.length >= 8 &&
        data[0] === 137 &&
        data[1] === 80 &&
        data[2] === 78 &&
        data[3] === 71;

    if (isPng) {
        return "image/png";
    }

    const isJpeg =
        data.length >= 3 &&
        data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255;

    if (isJpeg) {
        return "image/jpeg";
    }

    const isWebp =
        data.length >= 12 &&
        data[0] === 82 &&
        data[1] === 73 &&
        data[2] === 70 &&
        data[3] === 70 &&
        data[8] === 87 &&
        data[9] === 69 &&
        data[10] === 66 &&
        data[11] === 80;

    if (isWebp) {
        return "image/webp";
    }

    throw new Error(
        "Image response is not a supported PNG, JPEG, or WebP file",
    );
}

export class OpenAICompatibleImageProvider
    implements ImageAssetProvider
{
    constructor(
        private readonly options:
            OpenAICompatibleImageProviderOptions,
    ) {}

    async getImage(
        request: ImageAssetRequest,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult> {
        signal?.throwIfAborted();
        if (request.mode !== "generate") {
            throw new Error(
                "OpenAICompatibleImageProvider only supports generate mode",
            );
        }

        const timeoutMs = this.options.timeoutMs ?? 120_000;
        const controller = new AbortController();
        let timedOut = false;
        const abortFromRequest = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", abortFromRequest, { once: true });
        if (signal?.aborted) {
            abortFromRequest();
        }
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const baseUrl = this.options.baseUrl.replace(/\/+$/, "");
            const response = await fetch(
                `${baseUrl}/images/generations`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.options.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: this.options.model,
                        prompt: request.query,
                        response_format: "b64_json",
                    }),
                    signal: controller.signal,
                },
            );

            if (!response.ok) {
                const errorBody = await response.text();

                throw new Error(
                    `Image request failed with ${response.status}: ${errorBody.slice(0, 1_000)}`,
                );
            }

            const parsed = ImageGenerationResponseSchema.parse(
                await response.json(),
            );
            const base64 = parsed.data[0]?.b64_json;

            if (!base64) {
                throw new Error(
                    "Image response did not include b64_json",
                );
            }

            const data = Uint8Array.from(
                Buffer.from(base64, "base64"),
            );

            return {
                data,
                mediaType: detectImageMediaType(data),
                source: `generated:${this.options.model}`,
            };
        } catch (error) {
            if (signal?.aborted) {
                signal.throwIfAborted();
            }

            if (
                timedOut ||
                (error instanceof DOMException &&
                    error.name === "AbortError")
            ) {
                throw new Error(
                    `Image request timed out after ${timeoutMs}ms`,
                );
            }

            if (
                error instanceof TypeError &&
                error.message === "fetch failed"
            ) {
                throw new Error(
                    "Image request failed before receiving a response",
                );
            }

            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abortFromRequest);
        }
    }
}
