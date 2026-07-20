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
});
