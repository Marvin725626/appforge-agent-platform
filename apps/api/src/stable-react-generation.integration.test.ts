import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeModelProvider } from "@appforge/agent-core";
import { afterEach, describe, expect, it } from "vitest";

import { createFallbackDesignPlan } from "./design-plan-utils.js";
import { runReactAppAgent } from "./run-react-app-agent.js";

const AI_GAME_CONTENT = {
    version: 1,
    applicationType: "game",
    templateVariant: "command-console",
    theme: {
        palette: "tactical-amber",
        fontPair: "condensed-mono",
        density: "compact",
    },
    brand: {
        name: "NIGHTFALL COMMAND",
        kicker: "OPERATION BLACK RAVEN",
        title: "黑鸦行动：零点突入",
        summary: "切断北部通信阵列，在预警窗口关闭前完成侦察、编成与突入。",
        primaryAction: "进入行动",
        secondaryAction: "查看战术",
        statusLabel: "THREAT DELTA",
    },
    hero: {
        imagePrompt: "cinematic tactical battlefield at night, no text, 16:9",
        imageAlt: "夜间战术行动现场",
        stats: [
            { label: "坐标", value: "N31°14′" },
            { label: "时间码", value: "04:42:18" },
            { label: "威胁", value: "DELTA" },
            { label: "状态", value: "ACTIVE" },
        ],
    },
    sections: [
        { id: "briefing", kind: "feature-list", eyebrow: "BRIEF 01", title: "作战简报", description: "明确任务目标与限制条件。", items: [
            { title: "主目标", meta: "OBJ-01", description: "关闭通信阵列。", value: "PRIMARY", status: "ACTIVE" },
            { title: "限制", meta: "RULE-02", description: "保持静默突入。", value: "STEALTH", status: "LOCKED" },
        ] },
        { id: "map", kind: "map", eyebrow: "MAP 02", title: "战场点位", description: "呈现关键区域与推进关系。", items: [
            { title: "北部阵列", meta: "A-01", description: "主要目标区域。", value: "620M", status: "HOSTILE" },
            { title: "撤离点", meta: "E-02", description: "行动结束集合点。", value: "180M", status: "CLEAR" },
        ] },
        { id: "loadout", kind: "matrix", eyebrow: "KIT 03", title: "干员与装备", description: "展示职责与装备配置。", items: [
            { title: "先锋", meta: "OP-01", description: "负责首轮突入。", value: "AR-7", status: "READY" },
            { title: "侦察", meta: "OP-02", description: "负责点位确认。", value: "DRONE", status: "READY" },
        ] },
        { id: "timeline", kind: "timeline", eyebrow: "ROUND 04", title: "回合时间线", description: "按阶段推进任务。", items: [
            { title: "侦察", meta: "T-15", description: "确认巡逻间隔。", value: "15 MIN", status: "DONE" },
            { title: "突入", meta: "T-00", description: "同步进入目标区。", value: "LIVE", status: "NEXT" },
        ] },
    ],
    footer: { statement: "黑鸦行动联合指挥终端", links: ["简报", "地图", "装备", "时间线"] },
};

describe("stable production generation", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    it("renders AI-authored content through the stable renderer", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-stable-run-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const templateRoot = path.resolve(
            process.cwd(),
            "../../tests/fixtures/vite-react-starter",
        );
        const plannerOutput = {
            summary: "生成沉浸式战术游戏专题页面",
            steps: [
                {
                    id: "step-1",
                    title: "生成页面",
                    description: "生成稳定可构建的单页应用",
                    acceptanceCriteria: ["页面成功构建并渲染"],
                },
            ],
        };
        const model = new FakeModelProvider([
            { content: JSON.stringify(plannerOutput) },
            { content: JSON.stringify(AI_GAME_CONTENT) },
        ]);
        const goal =
            "创建一个沉浸式战术游戏专题网站，使用电影化舞台和 HUD 语言，不要普通产品卡片";
        const designPlan = createFallbackDesignPlan({
            goal,
            plannerOutput,
            routes: [{ path: "/", purpose: "战术游戏专题首页" }],
        });
        designPlan.visualDNA.forbiddenPatterns = ["重复圆角卡片网格"];
        designPlan.acceptanceCriteria = [
            {
                id: "DESIGN-1",
                instruction: "不得使用重复圆角卡片网格作为主要布局。",
                verification: "检查页面使用轨道、矩阵与终端结构。",
            },
        ];

        const result = await runReactAppAgent({
            goal,
            workspaceRoot,
            templateRoot,
            model,
            stableGeneration: true,
            designPlan,
            designPlanning: false,
            parallelCoding: true,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(result.agent.finished).toBe(true);
        expect(result.agent.stopReason).toBe("finish");
        expect(result.metrics?.codingCalls).toBe(1);
        expect(result.build.exitCode).toBe(0);
        expect(result.typecheck?.exitCode).toBe(0);
        expect(result.eval.passed).toBe(true);
        expect(result.review.accepted).toBe(true);
        expect(result.designPlanCompliance).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    criterion: "forbiddenPatterns are avoided",
                    status: "PASS",
                }),
            ]),
        );
        expect(appSource).toContain("黑鸦行动：零点突入");
        expect(appSource).toContain("作战简报");
        expect(appSource).toContain("command-console");
        expect(appSource).not.toContain("React task app workspace");
        expect(cssSource).toContain("--project-composition:");
        expect(cssSource).toContain("--surface-strategy: mixed;");
    }, 30_000);
    it("routes Chinese 后台 requests through the stable renderer", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-stable-dashboard-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const templateRoot = path.resolve(
            process.cwd(),
            "../../tests/fixtures/vite-react-starter",
        );
        const plannerOutput = {
            summary: "生成服务器运行监控后台",
            steps: [
                {
                    id: "step-1",
                    title: "生成监控后台",
                    description: "生成稳定可构建的单页监控应用",
                    acceptanceCriteria: ["页面成功构建并渲染"],
                },
            ],
        };
        const dashboardContent = {
            ...AI_GAME_CONTENT,
            applicationType: "dashboard",
            templateVariant: "sidebar-console",
            brand: {
                ...AI_GAME_CONTENT.brand,
                name: "SENTRY OPS",
                kicker: "LIVE INFRASTRUCTURE",
                title: "服务器运行监控中心",
                summary: "集中呈现 CPU、内存、请求延迟、异常服务、告警列表与故障处理流程。",
                primaryAction: "查看告警",
                secondaryAction: "打开流程",
                statusLabel: "SYSTEM LIVE",
            },
        };
        const model = new FakeModelProvider([
            { content: JSON.stringify(plannerOutput) },
            { content: JSON.stringify(dashboardContent) },
        ]);
        const goal =
            "创建一个服务器运行监控后台，包含 CPU、内存、请求延迟、异常服务、告警列表和故障处理流程";
        const designPlan = createFallbackDesignPlan({
            goal,
            plannerOutput,
            routes: [{ path: "/", purpose: "服务器监控后台" }],
        });
        designPlan.applicationType = "dashboard";
        designPlan.visualDNA.surfaceStrategy = "contained";

        const result = await runReactAppAgent({
            goal,
            workspaceRoot,
            templateRoot,
            model,
            stableGeneration: true,
            designPlan,
            designPlanning: false,
            parallelCoding: true,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        const mainSource = await readFile(
            path.join(workspaceRoot, "src", "main.tsx"),
            "utf8",
        );

        expect(result.agent.finished).toBe(true);
        expect(result.metrics?.codingCalls).toBe(1);
        expect(result.build.exitCode).toBe(0);
        expect(result.typecheck?.exitCode).toBe(0);
        expect(result.review.accepted).toBe(true);
        expect(appSource).toContain("服务器运行监控中心");
        expect(appSource).toContain("sidebar-console");
        expect(mainSource).toContain("<App />");
    }, 30_000);

    it("keeps the original requirement when the user only says 修复", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-stable-repair-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const templateRoot = workspaceRoot;
        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                name: "stable-repair-fixture",
                private: true,
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "content.ts"),
            'export const broken = "unterminated;',
            "utf8",
        );
        const originalGoal =
            "创建一个沉浸式战术游戏专题网站，使用电影化舞台和 HUD 语言，不要普通产品卡片";
        const contract = [
            "Requirement contract (oldest to newest):",
            "Keep every non-conflicting requirement.",
            "",
            "Initial requirement:",
            originalGoal,
            "",
            "Current request (highest priority):",
            "修复",
            "",
            "Continuation repair request:",
            "Start from the current workspace draft shown in preview.",
        ].join("\n");
        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    summary: "修复并生成稳定页面",
                    steps: [
                        {
                            id: "step-1",
                            title: "修复页面",
                            description: "恢复可构建页面",
                            acceptanceCriteria: ["页面成功构建并渲染"],
                        },
                    ],
                }),
            },
            { content: JSON.stringify({ ...AI_GAME_CONTENT, applicationType: "custom", templateVariant: "adaptive-story" }) },
        ]);

        const result = await runReactAppAgent({
            goal: contract,
            currentRequest: "修复",
            workspaceRoot,
            templateRoot,
            resetWorkspace: false,
            model,
            stableGeneration: true,
            designPlanning: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.build.exitCode).toBe(0);
        expect(result.typecheck?.exitCode).toBe(0);
        expect(result.review.accepted).toBe(true);
        expect(result.requirements?.[0]?.instruction).toBe(originalGoal);
        expect(result.requirements?.[0]?.instruction).not.toBe("修复");
        await expect(
            readFile(path.join(workspaceRoot, "src", "content.ts"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
    }, 30_000);

});
