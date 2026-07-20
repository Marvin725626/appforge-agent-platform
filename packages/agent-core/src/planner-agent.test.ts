import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import {
    PlannerAgent,
    PlannerOutputSchema,
} from "./planner-agent.js";

const PAGE_SITE = {
    title: "温州印象",
    tagline: "山海相拥，古今相映",
};

const PAGE_PLAN = [
    {
        id: "home",
        path: "/",
        label: "首页",
        purpose: "用完整首页介绍温州的山水、人文与城市气质。",
        acceptanceCriteria: [
            "首页包含主题明确的 hero 和至少三个真实内容板块",
        ],
    },
    {
        id: "culture",
        path: "/culture",
        label: "文化",
        purpose: "介绍南戏、永嘉学派与温州地方工艺。",
        acceptanceCriteria: [
            "文化页有独立标题和具体的温州文化内容",
        ],
    },
];

describe("PlannerAgent", () => {
    it("creates a structured plan from the model response", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                summary: "Build a task application",
                steps: [
                    {
                        id: "step-1",
                        title: "Build the interface",
                        description: "Create the task input and list.",
                        acceptanceCriteria: [
                            "The page contains a task input",
                            "The page contains an add button",
                        ],
                    },
                ],
            }),
        });

        const agent = new PlannerAgent({
            model: provider,
        });

        const plan = await agent.createPlan(
            "Create a React task application",
        );

        expect(plan.summary).toBe("Build a task application");
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0]?.id).toBe("step-1");
        expect(provider.requests[0]?.stream).toBe(true);
        expect(provider.requests[0]?.responseFormat).toMatchObject({
            type: "json_schema",
            name: "PlannerOutput",
            strict: true,
        });
    });

    it("sends the product goal to the model", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                summary: "Plan",
                steps: [
                    {
                        id: "step-1",
                        title: "Implement",
                        description: "Implement the application.",
                        acceptanceCriteria: ["The application builds"],
                    },
                ],
            }),
        });

        const agent = new PlannerAgent({ model: provider });

        await agent.createPlan("Create a weather dashboard");

        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0]?.messages[1]).toEqual({
            role: "user",
            content: "Create a weather dashboard",
        });
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Do not invent product features or business requirements",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Default page-generation contract",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "complete polished page rather than a small demo",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "at least three distinct meaningful content sections beyond the hero",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "real subject-specific information",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "three or more meaningful content sections or functional modules",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "do not accept a tiny card or one-section demo",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "summary header or overview",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Do not force a marketing hero or marketing footer onto a product interface",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "For an introduction or content page",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "same-document anchor navigation",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "browser Back/Forward",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "URL-aware #/ routes",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "information architecture and route map",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "small coherent design-token system",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "44px targets and visible focus",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "direct deep-link loading",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "route-specific headings and meaningful content",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "do not invent optional decorative assets",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "smallest coherent change",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "one initial Coding API call per pages entry",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Do not split fresh pages into content/styles/shell workstreams",
        );
        expect(provider.requests[0]?.messages[0]?.content).not.toContain(
            "exactly three independent workstreams",
        );
    });
    it("includes platform context in the planning request", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                summary: "Build a React application",
                steps: [
                    {
                        id: "step-1",
                        title: "Create React component",
                        description: "Implement src/App.tsx.",
                        acceptanceCriteria: [
                            "The Vite application builds successfully",
                        ],
                    },
                ],
            }),
        });

        const agent = new PlannerAgent({
            model: provider,
        });

        await agent.createPlan(
            "Create a task application",
            "Use React, TypeScript, TSX, and the existing Vite workspace.",
        );

        expect(
            provider.requests[0]?.messages[1]?.content,
        ).toContain(
            "Use React, TypeScript, TSX, and the existing Vite workspace.",
        );
    });

    it("keeps legacy content, styles, and shell workstreams parseable", async () => {
        const workstreams = [
            {
                id: "content",
                role: "content" as const,
                task: "Create route-specific Wenzhou content.",
                acceptanceCriteria: ["Every route has substantive content"],
            },
            {
                id: "styles",
                role: "styles" as const,
                task: "Create the responsive visual system.",
                acceptanceCriteria: ["Mobile layout has no overflow"],
            },
            {
                id: "shell",
                role: "shell" as const,
                task: "Create the URL-aware React route shell.",
                acceptanceCriteria: ["Back and Forward navigation work"],
            },
        ];
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                summary: "Build a routed Wenzhou site in parallel",
                steps: [
                    {
                        id: "step-1",
                        title: "Build the site",
                        description: "Merge three independent artifacts.",
                        acceptanceCriteria: ["The application builds"],
                    },
                ],
                workstreams,
            }),
        });
        const agent = new PlannerAgent({ model: provider });

        const plan = await agent.createPlan(
            "我想要一个介绍温州的界面并且可以跳转",
        );

        expect(plan.workstreams).toEqual(workstreams);
    });

    it("accepts a shared site contract and one plan entry per routed page", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                summary: "每个温州页面由一次独立 Coding API 调用生成",
                steps: [
                    {
                        id: "step-1",
                        title: "并发生成页面",
                        description:
                            "按照共享站点契约分别生成首页和文化页。",
                        acceptanceCriteria: [
                            "每个页面有独立 URL 和完整内容",
                        ],
                    },
                ],
                site: PAGE_SITE,
                pages: PAGE_PLAN,
            }),
        });
        const agent = new PlannerAgent({ model: provider });

        const plan = await agent.createPlan(
            "创建温州首页和文化页面，并支持真实 URL 跳转",
        );

        expect(plan.site).toEqual(PAGE_SITE);
        expect(plan.pages).toEqual(PAGE_PLAN);
        expect(plan.pages).toHaveLength(2);
        expect(plan.pages?.[0]?.path).toBe("/");
    });

    it.each([
        [
            "duplicate page ids",
            [
                PAGE_PLAN[0],
                {
                    ...PAGE_PLAN[1],
                    id: "home",
                },
            ],
        ],
        [
            "duplicate page paths",
            [
                PAGE_PLAN[0],
                {
                    ...PAGE_PLAN[1],
                    path: "/",
                },
            ],
        ],
        [
            "a route plan without a home page",
            [
                {
                    ...PAGE_PLAN[0],
                    id: "overview",
                    path: "/overview",
                },
                PAGE_PLAN[1],
            ],
        ],
    ])("rejects %s", (_label, pages) => {
        const result = PlannerOutputSchema.safeParse({
            summary: "Invalid routed page plan",
            steps: [
                {
                    id: "step-1",
                    title: "Build pages",
                    description: "Generate the requested pages.",
                    acceptanceCriteria: ["Every page is complete"],
                },
            ],
            site: PAGE_SITE,
            pages,
        });

        expect(result.success).toBe(false);
    });
});
