import { describe, expect, it } from "vitest";

import { DESIGN_BENCHMARK_PROMPTS } from "./design-benchmark-prompts.js";
import { evaluateDesignQuality } from "./design-quality-evaluator.js";
import { generateStablePageContent } from "./stable-page-content.js";
import {
    createStableAppSource,
    createStableCssSource,
} from "./stable-page-renderer.js";
import { DesignPlanSchema } from "@appforge/protocol";

function createPlan() {
    return DesignPlanSchema.parse({
        version: 1,
        applicationType: "product",
        designIntent: {
            audience: "开发者",
            primaryGoal: "展示 Agent 工作流程、运行监控和 SDK 集成",
            emotionalTone: ["可信", "工程化"],
            brandTraits: ["清晰", "专业"],
        },
        informationArchitecture: {
            routes: [{
                path: "/",
                purpose: "产品首页",
                primaryContent: ["产品介绍", "工作流程", "运行监控", "SDK"],
                primaryActions: ["查看文档"],
            }],
        },
        visualDNA: {
            composition: "深色技术首屏与分层内容带",
            density: "medium",
            surfaceStrategy: "mixed",
            navigationPattern: "锚点导航",
            heroPattern: "技术产品首屏",
            sectionRhythm: ["产品介绍", "工作流程", "运行监控", "SDK 集成"],
            typographyCharacter: "工程化标题与等宽数据",
            shapeLanguage: "开放内容带和少量面板",
            mediaStrategy: "一张产品主视觉",
            uniqueMotifs: ["代码窗口", "状态点", "监控时间线"],
            forbiddenPatterns: ["lorem ipsum"],
        },
        designTokens: {
            colorRoles: {
                background: "深色",
                surface: "深灰",
                foreground: "白色",
                mutedForeground: "浅灰",
                accent: "紫色",
                accentForeground: "黑色",
            },
            radiusScale: [0, 4, 8],
            spacingScale: [4, 8, 16, 24],
        },
        acceptanceCriteria: [{
            id: "DESIGN-1",
            instruction: "覆盖产品工作流和 SDK 集成",
            verification: "检查对应内容区",
        }],
    });
}

describe("design quality evaluator", () => {
    it("scores a stable generated page across all five dimensions", async () => {
        const goal = "创建一个 AI Agent 平台产品官网，包含产品介绍、工作流程、运行监控和 SDK 集成";
        const designPlan = createPlan();
        const { content } = await generateStablePageContent({ goal, designPlan });
        const report = evaluateDesignQuality({
            goal,
            expectedApplicationType: "product",
            requiredConcepts: ["产品", "工作流程", "运行监控", "SDK"],
            expectedSectionKinds: ["feature-list", "story", "matrix", "faq"],
            designPlan,
            content,
            appSource: createStableAppSource(content, { heroAlt: content.hero.imageAlt }),
            cssSource: createStableCssSource(content, designPlan),
        });

        expect(report.passed).toBe(true);
        expect(report.score).toBeGreaterThanOrEqual(80);
        expect(report.dimensions).toHaveLength(5);
        expect(report.metadata.applicationType).toBe("product");
    });

    it("rejects placeholder-heavy content without responsive or accessible source", async () => {
        const goal = "创建产品页面";
        const designPlan = createPlan();
        const generated = await generateStablePageContent({ goal, designPlan });
        const content = {
            ...generated.content,
            brand: {
                ...generated.content.brand,
                title: "Lorem ipsum",
                summary: "TODO placeholder",
            },
            sections: generated.content.sections.map((section) => ({
                ...section,
                title: "占位文案",
                description: "待补充",
                items: section.items.map((item) => ({
                    ...item,
                    title: "示例文案",
                    description: "TODO",
                })),
            })),
        };
        const report = evaluateDesignQuality({
            goal,
            expectedApplicationType: "product",
            requiredConcepts: ["工作流程", "监控", "SDK"],
            expectedSectionKinds: ["feature-list", "story", "matrix", "faq"],
            designPlan,
            content,
            appSource: "export function App() { return <div>TODO</div>; }",
            cssSource: "body { margin: 0; }",
        });

        expect(report.passed).toBe(false);
        expect(report.score).toBeLessThan(75);
        expect(report.findings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    dimension: "contentQuality",
                    severity: "error",
                }),
            ]),
        );
    });
});

describe("design benchmark prompt fixtures", () => {
    it("contains three prompts for every supported application type", () => {
        const counts = new Map<string, number>();
        for (const prompt of DESIGN_BENCHMARK_PROMPTS) {
            counts.set(prompt.applicationType, (counts.get(prompt.applicationType) ?? 0) + 1);
        }

        expect(DESIGN_BENCHMARK_PROMPTS).toHaveLength(24);
        expect([...counts.values()]).toEqual(Array.from({ length: 8 }, () => 3));
        expect(new Set(DESIGN_BENCHMARK_PROMPTS.map((prompt) => prompt.id)).size).toBe(24);
    });
});
