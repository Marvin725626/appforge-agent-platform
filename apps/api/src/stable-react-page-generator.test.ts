import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeImageAssetProvider, ImageAssetTool } from "@appforge/agent-core";

import { createFallbackDesignPlan } from "./design-plan-utils.js";
import {
    extractStableProductGoal,
    generateStableReactPage,
    isGenericRepairRequest,
} from "./stable-react-page-generator.js";

describe("stable-react-page-generator", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    it.each(["修复", "继续修复", "重试", "fix", "repair", "retry"])(
        "treats %s as an execution instruction rather than a new requirement",
        (request) => {
            expect(isGenericRepairRequest(request)).toBe(true);
        },
    );

    it("does not classify substantive edit requests as generic repair", () => {
        expect(isGenericRepairRequest("修复导航并改成三页网站")).toBe(false);
        expect(isGenericRepairRequest("把标题改成黑鸦行动")).toBe(false);
    });

    it("extracts the original product goal from a repair contract", () => {
        const contract = [
            "Requirement contract (oldest to newest):",
            "Keep every non-conflicting requirement.",
            "",
            "Initial requirement:",
            "创建一个沉浸式战术游戏专题网站",
            "",
            "Current request (highest priority):",
            "修复",
            "",
            "Continuation repair request:",
            "Start from the current workspace draft shown in preview.",
        ].join("\n");

        expect(extractStableProductGoal(contract)).toBe(
            "创建一个沉浸式战术游戏专题网站",
        );
    });


    it("uses an optional AI hero image without making image success a build dependency", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-stable-image-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const imageProvider = new FakeImageAssetProvider({
            data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            mediaType: "image/png",
            source: "fake-image",
        });
        const imageAssetTool = new ImageAssetTool({
            workspaceRoot,
            provider: imageProvider,
        });
        const goal = "创建一个现代产品发布页";
        const designPlan = createFallbackDesignPlan({
            goal,
            plannerOutput: {
                summary: goal,
                steps: [
                    {
                        id: "step-1",
                        title: "生成页面",
                        description: "生成产品页面",
                        acceptanceCriteria: ["页面可以构建"],
                    },
                ],
            },
            routes: [{ path: "/", purpose: "产品首页" }],
        });
        designPlan.applicationType = "product";

        const result = await generateStableReactPage({
            workspaceRoot,
            goal,
            designPlan,
            imageAssetTool,
            imageModes: ["generate"],
        });
        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(imageProvider.requests).toHaveLength(1);
        expect(imageProvider.requests[0]?.mode).toBe("generate");
        expect(result.generatedFiles).toContain(
            "public/assets/generated-hero.png",
        );
        expect(appSource).toContain("/assets/generated-hero.png");
        expect(result.agent.steps.some((step) => step.action.type === "get_image")).toBe(true);
    });

    it("replaces the entire generated source tree with a build-safe page", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-stable-page-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "content.ts"),
            'export const broken = "unterminated;',
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "OldComponent.tsx"),
            "export function OldComponent(){ return <div>old</div>; }",
            "utf8",
        );

        const goal =
            "创建一个沉浸式战术游戏专题网站，使用电影化舞台和 HUD 语言，不要普通产品卡片";
        const designPlan = createFallbackDesignPlan({
            goal,
            plannerOutput: {
                summary: goal,
                steps: [
                    {
                        id: "step-1",
                        title: "生成稳定页面",
                        description: "生成可构建的战术专题页面",
                        acceptanceCriteria: ["页面可以稳定构建并渲染"],
                    },
                ],
            },
            routes: [{ path: "/", purpose: "战术游戏专题首页" }],
        });
        const result = await generateStableReactPage({
            workspaceRoot,
            goal,
            designPlan,
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );
        const mainSource = await readFile(
            path.join(workspaceRoot, "src", "main.tsx"),
            "utf8",
        );

        expect(result.agent.finished).toBe(true);
        expect(result.agent.stopReason).toBe("finish");
        expect(result.generatedFiles).toEqual([
            "src/App.tsx",
            "src/App.css",
            "src/main.tsx",
        ]);
        expect(appSource).toContain("export function App()");
        expect(appSource).toContain("沉浸式战术游戏专题网站");
        expect(appSource).not.toContain("AppForge Starter");
        expect(appSource).not.toContain('from "./content"');
        expect(cssSource).toContain("--project-composition:");
        expect(cssSource).toContain("--surface-strategy:");
        expect(cssSource).toContain("--unique-motifs:");
        expect(mainSource).toContain('import { App } from "./App.js"');

        await expect(
            readFile(path.join(workspaceRoot, "src", "content.ts"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
            readFile(
                path.join(workspaceRoot, "src", "OldComponent.tsx"),
                "utf8",
            ),
        ).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("does not generate a decorative hero image for operational dashboards", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-dashboard-policy-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const imageProvider = new FakeImageAssetProvider({
            data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            mediaType: "image/png",
            source: "fake-image",
        });
        const imageAssetTool = new ImageAssetTool({
            workspaceRoot,
            provider: imageProvider,
        });
        const goal =
            "创建一个服务器运行监控后台，包含 CPU、内存、请求延迟、异常服务、告警列表和故障处理流程";
        const designPlan = createFallbackDesignPlan({
            goal,
            plannerOutput: {
                summary: goal,
                steps: [
                    {
                        id: "step-1",
                        title: "生成监控后台",
                        description: "生成数据优先的运维控制台",
                        acceptanceCriteria: ["首屏展示核心监控指标"],
                    },
                ],
            },
            routes: [{ path: "/", purpose: "服务器监控后台" }],
        });
        designPlan.applicationType = "dashboard";

        const result = await generateStableReactPage({
            workspaceRoot,
            goal,
            designPlan,
            imageAssetTool,
            imageModes: ["generate"],
        });
        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(imageProvider.requests).toHaveLength(0);
        expect(result.generatedFiles.some((file) => file.includes("generated-hero"))).toBe(false);
        expect(appSource).toContain('data-appforge-role="dashboard-overview"');
        expect(appSource).toContain('data-appforge-metric');
        expect(result.agent.steps.at(-1)?.action).toMatchObject({
            type: "finish",
            summary: expect.stringContaining("heroImage=disabled_by_policy"),
        });
    });

});
