import path from "node:path";

import {
    resolveWorkspacePath,
    writeWorkspaceBinaryFile,
} from "@appforge/workspace";

import {
    IMAGE_MEDIA_TYPES,
    type ImageAssetProvider,
    type ImageAssetRequest,
    type ImageMediaType,
} from "./image-asset-provider.js";
const DEFAULT_MAX_IMAGE_BYTES =
    5 * 1024 * 1024;
const ALLOWED_EXTENSIONS: Record<
    ImageMediaType,
    string[]
> = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "image/svg+xml": [".svg"],
};

function replaceExtension(
    filePath: string,
    extension: string,
): string {
    const currentExtension = path.extname(filePath);

    if (currentExtension.length === 0) {
        return `${filePath}${extension}`;
    }

    return `${filePath.slice(0, -currentExtension.length)}${extension}`;
}

export type ImageAssetToolOptions = {
    workspaceRoot: string;
    provider: ImageAssetProvider;
    maxImageBytes?: number;
};

export type SaveImageAssetInput = {
    request: ImageAssetRequest;
    outputPath: string;
    signal?: AbortSignal;
};

export type SavedImageAsset = {
    path: string;
    mediaType: ImageMediaType;
    source: string;
    attribution?: string;
    byteLength: number;
};

export class ImageAssetTool {
    constructor(
        private readonly options: ImageAssetToolOptions,
    ) {}

    async save(
        input: SaveImageAssetInput,
    ): Promise<SavedImageAsset> {
        input.signal?.throwIfAborted();
        const assetsRoot = resolveWorkspacePath(
            this.options.workspaceRoot,
            "public/assets",
        );
        const targetPath = resolveWorkspacePath(
            this.options.workspaceRoot,
            input.outputPath,
        );

        if (!targetPath.startsWith(`${assetsRoot}${path.sep}`)) {
            throw new Error(
                "Image assets must be stored inside public/assets",
            );
        }

        const result = await this.options.provider.getImage(
            input.request,
            input.signal,
        );
        input.signal?.throwIfAborted();

        if (!IMAGE_MEDIA_TYPES.includes(result.mediaType)) {
            throw new Error(
                `Unsupported image media type: ${result.mediaType}`,
            );
        }

        const maxImageBytes =
            this.options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

        if (result.data.byteLength === 0) {
            throw new Error("Image data is empty");
        }

        if (result.data.byteLength > maxImageBytes) {
            throw new Error(
                `Image exceeds maximum size of ${maxImageBytes} bytes`,
            );
        }

        const extension = path.extname(targetPath).toLowerCase();
        const allowedExtensions = ALLOWED_EXTENSIONS[result.mediaType];
        const outputPath = allowedExtensions.includes(extension)
            ? input.outputPath
            : replaceExtension(
                  input.outputPath,
                  allowedExtensions[0] ?? ".img",
              );
        const finalTargetPath = resolveWorkspacePath(
            this.options.workspaceRoot,
            outputPath,
        );

        if (!finalTargetPath.startsWith(`${assetsRoot}${path.sep}`)) {
            throw new Error(
                "Image assets must be stored inside public/assets",
            );
        }

        input.signal?.throwIfAborted();
        await writeWorkspaceBinaryFile(
            this.options.workspaceRoot,
            outputPath,
            result.data,
        );

        return {
            path: outputPath,
            mediaType: result.mediaType,
            source: result.source,
            ...(result.attribution
                ? { attribution: result.attribution }
                : {}),
            byteLength: result.data.byteLength,
        };
    }
}
