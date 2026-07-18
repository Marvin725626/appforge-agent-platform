export const IMAGE_MEDIA_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/svg+xml",
] as const;

export type ImageMediaType =
    (typeof IMAGE_MEDIA_TYPES)[number];

export type ImageAssetMode =
    | "search"
    | "generate";

export type ImageAssetRequest = {
    query: string;
    mode: ImageAssetMode;
    altText: string;
};

export type ImageAssetResult = {
    data: Uint8Array;
    mediaType: ImageMediaType;
    source: string;
    attribution?: string;
};

export interface ImageAssetProvider {
    getImage(
        request: ImageAssetRequest,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult>;
}
