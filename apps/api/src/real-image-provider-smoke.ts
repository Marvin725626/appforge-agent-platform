import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    ImageAssetTool,
    OpenAICompatibleImageProvider,
    type ImageMediaType,
} from "@appforge/agent-core";

const baseUrl = process.env.APPFORGE_IMAGE_BASE_URL;
const apiKey = process.env.APPFORGE_IMAGE_API_KEY;
const model = process.env.APPFORGE_IMAGE_MODEL;

if (!baseUrl || !apiKey || !model) {
    throw new Error(
        "Missing required AppForge image environment variables",
    );
}

const provider = new OpenAICompatibleImageProvider({
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number(
        process.env.APPFORGE_IMAGE_TIMEOUT_MS ?? 120_000,
    ),
});

const request = {
    query:
        "生成一张现代、简洁的温州城市风景横幅，蓝色天空，适合中文旅游介绍网页，不要添加文字",
    mode: "generate" as const,
    altText: "现代简洁的温州城市风景",
};

const generatedImage = await provider.getImage(request);
const extensionByMediaType: Record<ImageMediaType, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
};
const extension = extensionByMediaType[generatedImage.mediaType];
const outputPath = `public/assets/wenzhou-hero${extension}`;
const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-real-image-"),
);

const imageAssetTool = new ImageAssetTool({
    workspaceRoot,
    provider: {
        async getImage() {
            return generatedImage;
        },
    },
});

const saved = await imageAssetTool.save({
    request,
    outputPath,
});
const savedFile = await stat(
    path.join(workspaceRoot, ...outputPath.split("/")),
);

console.log(
    JSON.stringify(
        {
            workspaceRoot,
            saved,
            fileSize: savedFile.size,
        },
        null,
        2,
    ),
);
