import { FakeModelProvider } from "@appforge/agent-core";
import type { ApplicationType } from "@appforge/protocol";
import { describe, expect, it } from "vitest";

import { createFallbackDesignPlan } from "./design-plan-utils.js";
import {
    generateStablePageContent,
    StablePageContentSchema,
} from "./stable-page-content.js";
import {
    createStableAppSource,
    createStableCssSource,
} from "./stable-page-renderer.js";

const APPLICATION_TYPES: ApplicationType[] = [
    "game",
    "dashboard",
    "product",
    "commerce",
    "editorial",
    "institution",
    "portfolio",
    "custom",
];

function createDesignPlan(applicationType: ApplicationType) {
    const goal = `创建一个 ${applicationType} 单页网站`;
    const designPlan = createFallbackDesignPlan({
        goal,
        plannerOutput: {
            summary: goal,
            steps: [
                {
                    id: "step-1",
                    title: "生成页面",
                    description: "生成可构建页面",
                    acceptanceCriteria: ["页面可以构建并渲染"],
                },
            ],
        },
        routes: [{ path: "/", purpose: `${applicationType} 首页` }],
    });
    designPlan.applicationType = applicationType;
    return designPlan;
}

describe("stable page content", () => {
    it.each(APPLICATION_TYPES)(
        "creates a schema-valid %s fallback with a compatible renderer",
        async (applicationType) => {
            const goal = `创建一个 ${applicationType} 单页网站`;
            const designPlan = createDesignPlan(applicationType);
            const result = await generateStablePageContent({
                goal,
                designPlan,
            });
            const parsed = StablePageContentSchema.parse(result.content);
            const appSource = createStableAppSource(parsed, {
                heroAlt: parsed.hero.imageAlt,
            });
            const cssSource = createStableCssSource(parsed, designPlan);

            expect(result.source).toBe("fallback");
            expect(parsed.applicationType).toBe(applicationType);
            expect(parsed.sections).toHaveLength(4);
            expect(appSource).toContain(`"applicationType": "${applicationType}"`);
            expect(appSource.length).toBeLessThan(40_000);
            expect(cssSource.length).toBeLessThan(40_000);
            expect(cssSource).toContain(`stable-app--${parsed.templateVariant}`);
        },
    );

    it("uses valid AI content while enforcing the DesignPlan application type", async () => {
        const designPlan = createDesignPlan("dashboard");
        const fallback = await generateStablePageContent({
            goal: "创建一个销售数据看板",
            designPlan,
        });
        const aiContent = {
            ...fallback.content,
            applicationType: "game",
            templateVariant: "cinematic-stage",
            brand: {
                ...fallback.content.brand,
                title: "区域销售实时指挥台",
            },
        };
        const model = new FakeModelProvider({
            content: JSON.stringify(aiContent),
        });

        const result = await generateStablePageContent({
            goal: "创建一个销售数据看板",
            designPlan,
            model,
        });

        expect(result.source).toBe("ai");
        expect(result.content.applicationType).toBe("dashboard");
        expect([
            "sidebar-console",
            "wide-monitor",
            "report-board",
        ]).toContain(result.content.templateVariant);
        expect(result.content.brand.title).toBe("区域销售实时指挥台");
    });

    it("falls back safely after invalid AI output", async () => {
        const designPlan = createDesignPlan("commerce");
        const model = new FakeModelProvider([
            { content: "{not-json" },
            { content: JSON.stringify({ version: 1 }) },
        ]);

        const result = await generateStablePageContent({
            goal: "创建一个服装新品发布页",
            designPlan,
            model,
        });

        expect(result.source).toBe("fallback");
        expect(result.content.applicationType).toBe("commerce");
        expect(result.warnings).toHaveLength(2);
    });
    it("enforces a data-first dashboard content contract around CPU, memory, latency, tables, alerts, and workflow", async () => {
        const designPlan = createDesignPlan("dashboard");
        const fallback = await generateStablePageContent({
            goal: "创建一个服务器运行监控后台，包含 CPU、内存、请求延迟、异常服务、告警列表和故障处理流程",
            designPlan,
        });
        const genericSections = fallback.content.sections.map((section, index) => ({
            ...section,
            id: `generic-${index + 1}`,
            kind: "story" as const,
            title: `通用内容 ${index + 1}`,
            items: section.items.map((item, itemIndex) => ({
                ...item,
                title: `通用项目 ${index + 1}-${itemIndex + 1}`,
                description: "这是一段没有监控指标语义的普通内容。",
            })),
        }));
        const model = new FakeModelProvider({
            content: JSON.stringify({
                ...fallback.content,
                hero: {
                    ...fallback.content.hero,
                    stats: [
                        { label: "受众", value: "运维团队" },
                        { label: "模块", value: "04" },
                        { label: "主题", value: "深色" },
                    ],
                },
                sections: genericSections,
            }),
        });

        const result = await generateStablePageContent({
            goal: "创建一个服务器运行监控后台，包含 CPU、内存、请求延迟、异常服务、告警列表和故障处理流程",
            designPlan,
            model,
        });

        expect(result.content.sections.slice(0, 4).map((section) => section.kind)).toEqual([
            "metrics",
            "data-table",
            "feature-list",
            "timeline",
        ]);
        const metrics = result.content.sections[0];
        expect(metrics?.items.map((item) => item.title).join(" ")).toMatch(/CPU/iu);
        expect(metrics?.items.map((item) => item.title).join(" ")).toMatch(/内存/iu);
        expect(metrics?.items.map((item) => item.title).join(" ")).toMatch(/延迟|P95/iu);
        expect(result.content.hero.stats.map((stat) => stat.label)).toEqual([
            "全局健康",
            "在线节点",
            "活动告警",
            "刷新频率",
        ]);
    });

    it("replaces generic game content with Valorant-specific stable content when requested", async () => {
        const designPlan = createDesignPlan("game");
        designPlan.designIntent.primaryGoal =
            "做一个瓦罗兰特 / 无畏契约专题页，内容必须围绕特工、地图点位、回合经济、武器负载和版本情报。";
        const fallback = await generateStablePageContent({
            goal: "内容不是无畏契约的，请换成瓦罗兰特相关内容",
            designPlan,
        });
        const genericContent = {
            ...fallback.content,
            brand: {
                ...fallback.content.brand,
                title: "通用战术档案",
                summary: "介绍一个普通战术行动的阶段、路线和装备。",
            },
            sections: fallback.content.sections.map((section, index) => ({
                ...section,
                id: `generic-${index + 1}`,
                title: `普通行动模块 ${index + 1}`,
                description: "这里是通用战术内容，没有具体游戏名词。",
                items: section.items.map((item, itemIndex) => ({
                    ...item,
                    title: `普通条目 ${itemIndex + 1}`,
                    description: "通用任务说明，不包含具体游戏点位或武器。",
                })),
            })),
        };
        const model = new FakeModelProvider({
            content: JSON.stringify(genericContent),
        });

        const result = await generateStablePageContent({
            goal: "内容不是无畏契约的，请换成瓦罗兰特相关内容",
            designPlan,
            model,
        });
        const text = JSON.stringify(result.content);

        expect(result.content.brand.name).toContain("VALORANT");
        expect(text).toMatch(/瓦罗兰特|无畏契约/iu);
        expect(text).toMatch(/特工/iu);
        expect(text).toMatch(/Ascent|Haven|Bind|点位/iu);
        expect(text).toMatch(/回合经济|手枪局|长枪局/iu);
        expect(text).toMatch(/Vandal|Phantom|Operator/iu);
    });

});
