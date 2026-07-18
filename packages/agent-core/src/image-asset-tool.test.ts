import {
    mkdtemp,
    readFile,
    rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";

import { FakeImageAssetProvider } from "./fake-image-asset-provider.js";
import { ImageAssetTool } from "./image-asset-tool.js";

describe("ImageAssetTool", () => {
    let workspaceRoot = "";

    beforeEach(async () => {
        workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-asset-tool-"),
        );
    });

    afterEach(async () => {
        await rm(workspaceRoot, {
            recursive: true,
            force: true,
        });
    });

    it("saves an image inside public assets", async () => {
        const imageData = Uint8Array.from([
            137, 80, 78, 71,
        ]);

        const provider = new FakeImageAssetProvider({
            data: imageData,
            mediaType: "image/png",
            source: "fake://wenzhou",
        });

        const tool = new ImageAssetTool({
            workspaceRoot,
            provider,
        });

        const saved = await tool.save({
            request: {
                query: "温州风景",
                mode: "search",
                altText: "温州风景图片",
            },
            outputPath: "public/assets/wenzhou.png",
        });

        expect(saved.path).toBe(
            "public/assets/wenzhou.png",
        );
        expect(saved.byteLength).toBe(4);

        const fileData = await readFile(
            path.join(
                workspaceRoot,
                "public",
                "assets",
                "wenzhou.png",
            ),
        );

        expect([...fileData]).toEqual([...imageData]);
    });

    it("rejects paths outside public assets", async () => {
        const provider = new FakeImageAssetProvider({
            data: Uint8Array.from([1]),
            mediaType: "image/png",
            source: "fake://image",
        });

        const tool = new ImageAssetTool({
            workspaceRoot,
            provider,
        });

        await expect(
            tool.save({
                request: {
                    query: "image",
                    mode: "search",
                    altText: "Image",
                },
                outputPath: "src/image.png",
            }),
        ).rejects.toThrow(
            "Image assets must be stored inside public/assets",
        );

        expect(provider.requests).toHaveLength(0);
    });

    it("rejects images larger than the limit", async () => {
        const provider = new FakeImageAssetProvider({
            data: Uint8Array.from([1, 2, 3, 4]),
            mediaType: "image/png",
            source: "fake://large-image",
        });

        const tool = new ImageAssetTool({
            workspaceRoot,
            provider,
            maxImageBytes: 3,
        });

        await expect(
            tool.save({
                request: {
                    query: "large image",
                    mode: "search",
                    altText: "Large image",
                },
                outputPath: "public/assets/large.png",
            }),
        ).rejects.toThrow(
            "Image exceeds maximum size of 3 bytes",
        );
    });

    it("adjusts an extension that does not match the media type", async () => {
        const provider = new FakeImageAssetProvider({
            data: Uint8Array.from([1, 2, 3]),
            mediaType: "image/png",
            source: "fake://image",
        });

        const tool = new ImageAssetTool({
            workspaceRoot,
            provider,
        });

        const saved = await tool.save({
            request: {
                query: "image",
                mode: "search",
                altText: "Image",
            },
            outputPath: "public/assets/image.jpg",
        });

        expect(saved.path).toBe("public/assets/image.png");

        const fileData = await readFile(
            path.join(
                workspaceRoot,
                "public",
                "assets",
                "image.png",
            ),
        );

        expect([...fileData]).toEqual([1, 2, 3]);
    });
});
