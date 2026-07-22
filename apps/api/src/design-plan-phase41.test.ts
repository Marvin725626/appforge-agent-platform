import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    DesignPlannerAgent,
    FakeModelProvider,
    type PlannerOutput,
} from "@appforge/agent-core";
import { describe, expect, it } from "vitest";

import {
    createFallbackDesignPlan,
    evaluateDesignPlanCompliance,
    formatDesignPlanForPrompt,
} from "./design-plan-utils.js";
import { formatProjectStyles } from "./project-styles.js";
import { createDesignPlanWithFallback } from "./run-react-app-agent.js";

const PLANNER_OUTPUT: PlannerOutput = {
    summary: "用编辑化路线呈现温州城市文化与旅行线索。",
    steps: [
        {
            id: "plan-1",
            title: "组织信息结构",
            description: "把城市文化、路线和地点组织成非模板化页面。",
            acceptanceCriteria: ["呈现温州特色", "避免通用卡片网格"],
        },
    ],
    pages: [
        {
            id: "home",
            path: "/",
            label: "首页",
            purpose: "建立温州城市文化第一印象。",
            acceptanceCriteria: ["山水、街区和工艺都要出现"],
        },
        {
            id: "culture",
            path: "/culture",
            label: "文化",
            purpose: "解释南戏、瓯绣和永嘉学派。",
            acceptanceCriteria: ["使用编辑化叙事结构"],
        },
    ],
};

describe("Phase 4.1 DesignPlan", () => {
    it("DesignPlannerAgent accepts valid DesignPlan JSON and preserves explicit forbidden patterns", async () => {
        const modelPlan = createFallbackDesignPlan({
            goal: "创建游戏专题页，不要卡片化，不要蓝色背景",
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
        });
        const provider = new FakeModelProvider({
            content: JSON.stringify(modelPlan),
        });
        const agent = new DesignPlannerAgent({ model: provider });

        const designPlan = await agent.createDesignPlan({
            goal: "创建游戏专题页，不要卡片化，不要蓝色背景",
            currentRequirements: [
                "REQ-1 [must]: 不要卡片化",
                "REQ-2 [must]: 不要蓝色背景",
            ],
            pagePlan: JSON.stringify(PLANNER_OUTPUT.pages),
            forbiddenPatterns: ["不要卡片化", "不要蓝色背景"],
        });

        expect(designPlan).toEqual(modelPlan);
        expect(designPlan.visualDNA.forbiddenPatterns).toEqual(
            expect.arrayContaining([
                "card grid",
                "repeated rounded cards",
                "dominant blue palette",
            ]),
        );
        expect(provider.requests[0]?.messages.at(-1)?.content).toContain(
            "不要卡片化",
        );
    });

    it("falls back when DesignPlannerAgent returns invalid JSON", async () => {
        const provider = new FakeModelProvider({
            content: "{not valid JSON",
        });
        const designPlannerAgent = new DesignPlannerAgent({ model: provider });

        const result = await createDesignPlanWithFallback({
            designPlannerAgent,
            goal: "做一个温州城市文化编辑页，不要卡片化",
            requirements: [
                {
                    id: "REQ-1",
                    instruction: "不要卡片化",
                    priority: "must",
                    verification: "Forbidden pattern is carried into DesignPlan.",
                },
            ],
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
            preserveExisting: false,
            designPlanningEnabled: true,
        });

        expect(result.designPlanSource).toBe("fallback");
        expect(result.designPlan.applicationType).toBe("editorial");
        expect(result.designPlan.visualDNA.forbiddenPatterns).toContain(
            "card grid",
        );
    });

    it("preserves an existing DesignPlan unless an overall style refresh is requested", async () => {
        const preservedPlan = createFallbackDesignPlan({
            goal: "创建城市文化编辑页",
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
        });
        const refreshedPlan = createFallbackDesignPlan({
            goal: "创建数据后台",
            plannerOutput: {
                ...PLANNER_OUTPUT,
                summary: "创建数据后台",
            },
            routes: [{ path: "/", purpose: "数据后台首页" }],
        });

        const preserved = await createDesignPlanWithFallback({
            designPlannerAgent: new DesignPlannerAgent({
                model: new FakeModelProvider([]),
            }),
            goal: "把标题改小一点",
            requirements: [],
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
            existingDesignPlan: preservedPlan,
            preserveExisting: true,
            designPlanningEnabled: true,
        });

        expect(preserved.designPlanSource).toBe("preserved");
        expect(preserved.designPlan).toEqual(preservedPlan);

        const provider = new FakeModelProvider({
            content: JSON.stringify(refreshedPlan),
        });
        const refreshed = await createDesignPlanWithFallback({
            designPlannerAgent: new DesignPlannerAgent({ model: provider }),
            goal: "重新设计整体风格，改成数据后台",
            requirements: [],
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
            existingDesignPlan: preservedPlan,
            preserveExisting: false,
            designPlanningEnabled: true,
        });

        expect(refreshed.designPlanSource).toBe("planner");
        expect(refreshed.designPlan).toEqual(refreshedPlan);
    });

    it("turns subject-specific anti-template requirements into structured DesignPlan fields", () => {
        const designPlan = createFallbackDesignPlan({
            goal: "做一个温州城市文化编辑页，不要卡片化，不要蓝色模板，不要 SaaS 那种 hero 三列模块",
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
        });

        expect(designPlan.version).toBe(1);
        expect(designPlan.applicationType).toBe("editorial");
        expect(designPlan.visualDNA.surfaceStrategy).toBe("mixed");
        expect(designPlan.visualDNA.composition).toContain("editorial");
        expect(designPlan.visualDNA.sectionRhythm).toContain("route timeline");
        expect(designPlan.visualDNA.uniqueMotifs).toContain("route timeline");
        expect(designPlan.visualDNA.forbiddenPatterns).toEqual(
            expect.arrayContaining([
                "card grid",
                "repeated rounded cards",
                "SaaS hero",
                "generic SaaS feature cards",
                "dominant blue palette",
            ]),
        );

        const prompt = formatDesignPlanForPrompt(designPlan);
        expect(prompt).toContain("Structured DesignPlan v1");
        expect(prompt).toContain("composition:");
        expect(prompt).toContain("forbiddenPatterns: card grid");
        expect(prompt).toContain("Layout family router:");
        expect(prompt).toContain("editorial/institution guide");
        expect(prompt).toContain("changing only copy, colors, or images is not enough");
    });

    it("routes different application types to different layout families instead of one card template", () => {
        const gamePlan = createFallbackDesignPlan({
            goal: "Create a Valorant game guide with maps, A/B/C sites, and tactical rounds",
            plannerOutput: PLANNER_OUTPUT,
            routes: [{ path: "/", purpose: "Game tactics" }],
        });
        const dashboardPlan = createFallbackDesignPlan({
            goal: "Create a server monitoring dashboard with CPU, memory, latency, alerts, and incident workflow",
            plannerOutput: PLANNER_OUTPUT,
            routes: [{ path: "/", purpose: "Operations dashboard" }],
        });
        const productPlan = createFallbackDesignPlan({
            goal: "Create a SaaS product page for an Agent debugging platform",
            plannerOutput: PLANNER_OUTPUT,
            routes: [{ path: "/", purpose: "Product overview" }],
        });

        const gamePrompt = formatDesignPlanForPrompt(gamePlan);
        const dashboardPrompt = formatDesignPlanForPrompt(dashboardPlan);
        const productPrompt = formatDesignPlanForPrompt(productPlan);

        expect(gamePlan.applicationType).toBe("game");
        expect(dashboardPlan.applicationType).toBe("dashboard");
        expect(productPlan.applicationType).toBe("product");
        expect(gamePrompt).toContain("Selected family: immersive game interface");
        expect(gamePrompt).toContain("match-hud");
        expect(dashboardPrompt).toContain("Selected family: operational console");
        expect(dashboardPrompt).toContain("KPI band");
        expect(productPrompt).toContain("Selected family: product/workflow surface");
        expect(productPrompt).toContain("product screen");
        expect(new Set([gamePrompt, dashboardPrompt, productPrompt]).size).toBe(3);
        for (const prompt of [gamePrompt, dashboardPrompt, productPrompt]) {
            expect(prompt).toContain(
                "Cards, panels, tiles, or modules are allowed when they are native to the chosen family",
            );
            expect(prompt).toContain(
                "must not become the universal page skeleton",
            );
        }
    });

    it("formats project CSS from DesignPlan instead of the old shared visual skeleton", () => {
        const designPlan = createFallbackDesignPlan({
            goal: "做一个无畏契约战术专题页，不要普通 SaaS 卡片，要像游戏官网一样高对比",
            plannerOutput: {
                ...PLANNER_OUTPUT,
                summary: "呈现无畏契约地图、点位和战术节奏。",
            },
            routes: [{ path: "/", purpose: "游戏战术首页" }],
        });

        const styles = formatProjectStyles({
            designPlan,
            pages: [{ id: "home", path: "/", label: "首页" }],
        });

        expect(designPlan.applicationType).toBe("game");
        expect(styles).toContain("--project-composition");
        expect(styles).toContain("--surface-strategy: mixed");
        expect(styles).toContain("--section-rhythm");
        expect(styles).toContain("--unique-motifs");
        expect(styles).toContain("HUD strip");
        expect(styles).toContain("angular");
        expect(styles).not.toContain("--radius-component");
        expect(styles).not.toContain("--color-ink-900");
    });

    it("reports DesignPlan compliance from source evidence and fails forbidden card-grid output", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-design-plan-test-"),
        );
        try {
            await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
            const designPlan = createFallbackDesignPlan({
                goal: "做一个温州城市文化编辑页，不要卡片化",
                plannerOutput: PLANNER_OUTPUT,
                routes: PLANNER_OUTPUT.pages ?? [],
            });

            await writeFile(
                path.join(workspaceRoot, "src", "App.css"),
                formatProjectStyles({
                    designPlan,
                    pages: [{ id: "home", path: "/", label: "首页" }],
                }),
                "utf8",
            );
            await writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                'export function App() { return <main className="editorial-flow"><section className="route-timeline">温州路线</section></main>; }',
                "utf8",
            );
            await writeFile(
                path.join(workspaceRoot, "src", "content.ts"),
                "export const routes = [];",
                "utf8",
            );

            const passingCompliance = await evaluateDesignPlanCompliance({
                workspaceRoot,
                designPlan,
                designPlanSource: "fallback",
            });

            expect(passingCompliance).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        criterion: "composition is represented",
                        status: "PASS",
                    }),
                    expect.objectContaining({
                        criterion: "forbiddenPatterns are avoided",
                        status: "PASS",
                    }),
                ]),
            );

            await writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                'export function App() { return <main className="page-grid"><section className="page-card">模板卡片</section></main>; }',
                "utf8",
            );

            const failingCompliance = await evaluateDesignPlanCompliance({
                workspaceRoot,
                designPlan,
                designPlanSource: "fallback",
            });
            expect(failingCompliance).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        criterion: "forbiddenPatterns are avoided",
                        status: "FAIL",
                        evidence: expect.stringContaining("card grid"),
                    }),
                ]),
            );

            const css = await readFile(
                path.join(workspaceRoot, "src", "App.css"),
                "utf8",
            );
            expect(css).toContain("--project-composition");
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it("ignores AppForge system contrast hardening selectors in forbidden pattern evidence", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-design-plan-system-css-test-"),
        );
        try {
            await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
            const designPlan = createFallbackDesignPlan({
                goal: "做一个瓦罗兰特专题页，不要通用 SaaS 功能卡片",
                plannerOutput: PLANNER_OUTPUT,
                routes: [{ path: "/", purpose: "战术游戏首页" }],
            });
            designPlan.visualDNA.forbiddenPatterns = ["不要通用 SaaS 功能卡片"];

            await writeFile(
                path.join(workspaceRoot, "src", "App.css"),
                [
                    formatProjectStyles({
                        designPlan,
                        pages: [{ id: "home", path: "/", label: "首页" }],
                    }),
                    "/* appforge browser-contrast-hardening start */",
                    'body :is(.card, .panel, [class*="card" i], [class*="panel" i]) { color: #f8fbff !important; }',
                    "/* appforge browser-contrast-hardening end */",
                ].join("\n"),
                "utf8",
            );
            await writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                'export function App() { return <main className="match-hud"><section className="round-timeline">ROUND 01</section></main>; }',
                "utf8",
            );
            await writeFile(
                path.join(workspaceRoot, "src", "content.ts"),
                "export const routes = [];",
                "utf8",
            );

            const compliance = await evaluateDesignPlanCompliance({
                workspaceRoot,
                designPlan,
                designPlanSource: "fallback",
            });

            expect(compliance).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        criterion: "forbiddenPatterns are avoided",
                        status: "PASS",
                    }),
                ]),
            );
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it("does not treat forbidden-pattern wording in acceptance copy as implementation evidence", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-design-plan-copy-test-"),
        );
        try {
            await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
            const designPlan = createFallbackDesignPlan({
                goal: "创建战术游戏专题页，不要重复圆角卡片网格",
                plannerOutput: PLANNER_OUTPUT,
                routes: [{ path: "/", purpose: "战术游戏首页" }],
            });
            designPlan.visualDNA.forbiddenPatterns = ["重复圆角卡片网格"];
            designPlan.acceptanceCriteria = [
                {
                    id: "DESIGN-1",
                    instruction: "不得使用重复圆角卡片网格作为主要布局。",
                    verification: "检查页面使用轨道、矩阵与终端结构。",
                },
            ];

            await writeFile(
                path.join(workspaceRoot, "src", "App.css"),
                [
                    ':root { --project-composition: "战术轨道"; --surface-strategy: mixed; --unique-motifs: "HUD"; }',
                    ".module-rail { display: grid; gap: 1px; }",
                    ".module-row { border: 1px solid currentColor; }",
                ].join("\n"),
                "utf8",
            );
            await writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                'export function App() { return <main className="module-rail"><section className="module-row"><p>不得使用重复圆角卡片网格作为主要布局。</p></section></main>; }',
                "utf8",
            );

            const compliance = await evaluateDesignPlanCompliance({
                workspaceRoot,
                designPlan,
                designPlanSource: "planner",
            });

            expect(compliance).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        criterion: "forbiddenPatterns are avoided",
                        status: "PASS",
                    }),
                ]),
            );
        } finally {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it("produces materially different plans for city, SaaS, game, and dashboard topics", () => {
        const scenarios = [
            {
                goal: "创建温州城市文化编辑网站",
                expectedType: "editorial",
            },
            {
                goal: "创建 Agent 调试 SaaS 产品页",
                expectedType: "product",
            },
            {
                goal: "创建无畏契约游戏专题页",
                expectedType: "game",
            },
            {
                goal: "创建运营数据后台",
                expectedType: "dashboard",
            },
        ] as const;

        const plans = scenarios.map((scenario) =>
            createFallbackDesignPlan({
                goal: scenario.goal,
                plannerOutput: {
                    ...PLANNER_OUTPUT,
                    summary: scenario.goal,
                },
                routes: [{ path: "/", purpose: scenario.goal }],
            }),
        );

        expect(plans.map((plan) => plan.applicationType)).toEqual(
            scenarios.map((scenario) => scenario.expectedType),
        );
        expect(new Set(plans.map((plan) => plan.visualDNA.composition)).size).toBe(
            plans.length,
        );
        expect(
            new Set(plans.map((plan) => plan.visualDNA.sectionRhythm.join(" / "))).size,
        ).toBe(plans.length);
        expect(
            new Set(plans.map((plan) => plan.visualDNA.surfaceStrategy)).size,
        ).toBeGreaterThanOrEqual(2);
    });
});
