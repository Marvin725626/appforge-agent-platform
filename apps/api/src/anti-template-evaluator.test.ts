import { DesignPlanSchema } from "@appforge/protocol";
import { describe, expect, it } from "vitest";

import { evaluateAntiTemplate } from "./anti-template-evaluator.js";
import { generateStablePageContent } from "./stable-page-content.js";
import {
    createStableAppSource,
    createStableCssSource,
} from "./stable-page-renderer.js";

function createDashboardPlan() {
    return DesignPlanSchema.parse({
        version: 1,
        applicationType: "dashboard",
        designIntent: {
            audience: "运维工程师",
            primaryGoal: "查看服务器状态并处置故障",
            emotionalTone: ["专业", "紧凑"],
            brandTraits: ["数据优先", "可信"],
        },
        informationArchitecture: {
            routes: [{
                path: "/",
                purpose: "服务器监控后台",
                primaryContent: ["CPU", "内存", "延迟", "告警"],
                primaryActions: ["刷新数据"],
            }],
        },
        visualDNA: {
            composition: "运维控制台",
            density: "high",
            surfaceStrategy: "contained",
            navigationPattern: "侧边导航",
            heroPattern: "状态总览",
            sectionRhythm: ["指标", "异常服务", "告警", "流程"],
            typographyCharacter: "等宽数据",
            shapeLanguage: "小圆角数据面板",
            mediaStrategy: "数据图形",
            uniqueMotifs: ["阈值线", "状态点"],
            forbiddenPatterns: ["营销卡片堆砌"],
        },
        designTokens: {
            colorRoles: {
                background: "深色",
                surface: "深灰",
                foreground: "白色",
                mutedForeground: "浅灰",
                accent: "青色",
                accentForeground: "黑色",
            },
            radiusScale: [0, 2, 4, 8],
            spacingScale: [4, 8, 12, 16, 24],
        },
        acceptanceCriteria: [{
            id: "DESIGN-1",
            instruction: "必须包含核心运维模块",
            verification: "检查页面结构",
        }],
    });
}

describe("anti-template evaluator", () => {
    it("does not treat operational dashboard metrics as marketing card repetition", async () => {
        const goal = "创建服务器运行监控后台，包含 CPU、内存、延迟、异常服务、告警和流程";
        const designPlan = createDashboardPlan();
        const generated = await generateStablePageContent({ goal, designPlan });
        const appSource = createStableAppSource(generated.content, {
            heroAlt: generated.content.hero.imageAlt,
        });
        const cssSource = createStableCssSource(generated.content, designPlan);
        const report = evaluateAntiTemplate({
            applicationType: "dashboard",
            content: generated.content,
            appSource,
            cssSource,
        });

        expect(report.level).toBe("pass");
        expect(report.score).toBeGreaterThanOrEqual(90);
        expect(report.metrics.operationalPanelCount).toBeGreaterThan(0);
        expect(report.metrics.homogeneousThreeColumnGridCount).toBe(0);
        expect(report.metrics.largeRadiusContainerRatio).toBeLessThan(0.5);
    });

    it("detects large-radius card grids and repeated section structures", async () => {
        const goal = "创建模板化产品页面";
        const designPlan = createDashboardPlan();
        const generated = await generateStablePageContent({ goal, designPlan });
        const firstSection = generated.content.sections[0]!;
        const repeatedSections = generated.content.sections.map((section, index) => ({
            ...section,
            id: `repeated-${index + 1}`,
            kind: "feature-list" as const,
            items: firstSection.items,
        }));
        const content = {
            ...generated.content,
            applicationType: "product" as const,
            sections: repeatedSections,
        };
        const appSource = `
            export function App() {
                const items = [1, 2, 3];
                return <main>
                    <section className="feature-grid">{items.map((item) => <article className="feature-card" key={item}>{item}</article>)}</section>
                    <section className="benefit-grid">{items.map((item) => <article className="benefit-card" key={item}>{item}</article>)}</section>
                    <section className="pricing-grid">{items.map((item) => <article className="pricing-card" key={item}>{item}</article>)}</section>
                </main>;
            }
        `;
        const cssSource = `
            :root { --radius: 24px; }
            .feature-grid, .benefit-grid, .pricing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .feature-row, .feature-card, .benefit-card, .pricing-card { background: #fff; border: 1px solid #ddd; border-radius: var(--radius); }
        `;
        const report = evaluateAntiTemplate({
            applicationType: "product",
            content,
            appSource,
            cssSource,
        });

        expect(report.level).toBe("severe");
        expect(report.score).toBeLessThan(60);
        expect(report.metrics.cardContainerRatio).toBeGreaterThanOrEqual(0.8);
        expect(report.metrics.largeRadiusContainerRatio).toBeGreaterThanOrEqual(0.7);
        expect(report.metrics.homogeneousThreeColumnGridCount).toBe(3);
        expect(report.metrics.repeatedDomPatternRatio).toBe(1);
        expect(report.findings.map((finding) => finding.code)).toEqual(
            expect.arrayContaining([
                "card-container-ratio",
                "large-radius-container-ratio",
                "homogeneous-three-column-grid",
                "repeated-dom-pattern",
            ]),
        );
    });
});
