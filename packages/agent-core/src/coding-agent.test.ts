import { describe, expect, it } from "vitest";

import {
    CodingAgent,
    isLikelyComplexReactPageRequest,
} from "./coding-agent.js";
import { FakeModelProvider } from "./fake-model-provider.js";

describe("CodingAgent", () => {
    it("returns a parsed action from the model response", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export default function App() {}",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        const action = await agent.decideNextAction(
            "Create a React task application",
        );

        expect(action).toEqual({
            type: "write_file",
            path: "src/App.tsx",
            content: "export default function App() {}",
        });
        expect(provider.requests[0]?.stream).toBe(true);
        expect(provider.requests[0]?.responseFormat).toMatchObject({
            type: "json_schema",
            name: "AgentAction",
            strict: true,
        });
    });

    it("rejects an action that is missing required fields", async () => {
        const provider = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                }),
            },
        ]);

        const agent = new CodingAgent({
            model: provider,
        });

        await expect(
            agent.decideNextAction("Create a React task application"),
        ).rejects.toThrow("AgentAction remained invalid after 2 attempt");
    });

    it("sends coding-agent instructions and the user goal", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction("Create a React task application");

        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0]?.messages[0]?.role).toBe("system");
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Return exactly one JSON object and no markdown.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            'For write_file, use: {"type":"write_file","path":"README.md","content":"..."}',
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Preserve the user's language exactly.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "If the user writes Chinese, generate readable UTF-8 Chinese text",
        );
        expect(provider.requests[0]?.messages[0]?.content).not.toContain(
            "Recommended complex-page batch",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "For an explicitly minimal page or a small non-page app request",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Distinguish explicit same-page scrolling",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "URL-aware hash router with hashchange handling",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            'A hash route such as "#/about"',
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            'Never use href="#"',
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "small coherent CSS-variable token system",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Choose the visual grammar from the user's domain",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "For dashboards/admin/analytics pages",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "do not build the main content from the same generic page-card/page-grid template",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Do not make every section a same-looking grid of boxes",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "solid-color surface fallback",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "at least 44px interaction targets",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "prefers-reduced-motion",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "do not invent optional decorative assets",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Default full-page contract",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "at least three distinct meaningful content sections beyond the hero",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Dashboards, portals, and embedded tools",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "summary header or overview",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Do not force a marketing hero or marketing footer onto a product interface",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Before returning finish, self-check",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "derive visible active navigation state",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "load every route directly as a deep link",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "smallest coherent change",
        );
        expect(provider.requests[0]?.messages[0]?.content).not.toContain(
            "get_image",
        );
        expect(provider.requests[0]?.messages[1]).toEqual({
            role: "user",
            content: "Create a React task application",
        });
    });

    it("includes image instructions only when image tools are enabled", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "Create a React travel application",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            'For get_image, use: {"type":"get_image"',
        );
        expect(systemPrompt).toContain(
            "Available image modes: search, generate.",
        );
        expect(systemPrompt).toContain(
            "Image outputPath must be inside public/assets.",
        );
        expect(systemPrompt).toContain(
            'reference it in React as "/assets/image.jpg"',
        );
        expect(systemPrompt).toContain(
            "If the goal asks for a logo, icon, badge, hero image, banner, or local visual asset",
        );
        expect(systemPrompt).toContain(
            "treat one local hero or topic visual asset as essential",
        );
        expect(systemPrompt).toContain(
            "If the previous execution context says a local /assets/... reference is missing",
        );
    });

    it("describes only the configured image modes", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
            imageToolModes: ["search"],
        });

        await agent.decideNextAction(
            "Create a React page using a logo from a URL",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "Available image modes: search.",
        );
        expect(systemPrompt).toContain(
            'Use mode "search" for official or existing brand assets such as logos, icons, badges, and known product imagery.',
        );
        expect(systemPrompt).toContain(
            'keyword phrase such as "Valorant official logo Riot Games svg png"',
        );
        expect(systemPrompt).toContain(
            "http(s) page/direct image URL",
        );
        expect(systemPrompt).not.toContain(
            'Use mode "generate" when the user asks for a new AI-created image.',
        );
    });

    it("includes previous execution context when provided", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction(
            "Create a React task application",
            "Step 1: Wrote file src/App.tsx",
        );

        expect(provider.requests[0]?.messages[1]?.content).toBe(
            "Create a React task application\n\nPrevious execution context:\nStep 1: Wrote file src/App.tsx",
        );
    });

    it("does not turn a focused logo contrast edit into a complex-page rewrite", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".logo { color: #fff; }",
                newText: ".logo { color: #111; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "把清华页面现有 logo 的颜色调整到和背景有明显对比，不要重做页面",
            "Current workspace source: a complete polished Apex Legends homepage with many sections",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).toContain(
            "do not regenerate the asset or rewrite the page",
        );
        expect(systemPrompt).not.toContain(
            "If the goal asks for a logo, icon, badge, hero image, banner, or local visual asset",
        );
    });

    it("treats Chinese readability and layout feedback as a focused visual iteration", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".page-card h2 { font-size: 3rem; }",
                newText: ".page-card h2 { font-size: 1.5rem; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "\u6587\u5316\u540d\u5b57\u91cc\u9762\u7684\u5b57\u770b\u4e0d\u89c1\uff0c\u6709\u4e9b\u5b57\u4f53\u592a\u5927\u4e86\u7f29\u5c0f\u70b9\uff0c\u6392\u7248\u91cd\u65b0\u641e\u4e00\u4e0b",
            "Current workspace source: a complete Wenzhou multi-page cultural guide with cards, images, and navigation.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).toContain(
            "smallest coherent change",
        );
        expect(systemPrompt).not.toContain(
            "Recommended complex-page batch",
        );
    });

    it("treats image fit and oversized font feedback as a focused visual iteration", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".metric strong { font-size: 5rem; }",
                newText: ".metric strong { font-size: 2.6rem; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "\u56fe\u7247\u4e0d\u80fd\u5f88\u597d\u7684\u653e\u5728\u91cc\u9762\uff0c\u800c\u4e14\u5b57\u4f53\u5f88\u5927",
            "Current workspace source: a complete Wenzhou page with image cards and metric cards.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
    });

    it("treats card-like oversized game UI feedback as a focused visual iteration", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".game-panel h2 { font-size: 3rem; }",
                newText: ".game-panel h2 { font-size: 1.35rem; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "\u8fd9\u4e0d\u8fd8\u662f\u5361\u7247\u7684\u5417\uff0c\u800c\u4e14\u5b57\u4f53\u8d85\u7ea7\u5927",
            "Current workspace source: a complete Valorant game page with page-genre-game, game-stage, and game-panel UI.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).toContain(
            "visual-grammar correction",
        );
        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
    });

    it("treats oversized route-stop names as a focused visual iteration", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".feature-list strong { font-size: 3.8rem; }",
                newText: ".feature-list strong { font-size: 1.2rem; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "\u6c5f\u5fc3\u5c7f\uff1a\u96c1\u8361\u5c71\uff1a\u6960\u6eaa\u6c5f\uff1a\u4e94\u9a6c\u8857\u2014\u7985\u8857\uff1a\u5b57\u4f53\u8fc7\u5927\u4e86",
            "Current workspace source: a complete Wenzhou guide with route stop names in a feature list.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
    });

    it.each([
        "这些景点名太抢眼了，小一点",
        "路线节点别那么大，看起来压过正文",
        "地点清单名称太夸张了，收一点",
        "五马街—禅街这个名字断行很丑，别撑开卡片",
    ])("normalizes alternate Chinese size feedback: %s", async (request) => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.css",
                oldText: ".feature-list strong { font-size: 3.8rem; }",
                newText: ".feature-list strong { font-size: 1.2rem; }",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            request,
            "Current workspace source: a complete Wenzhou guide with route stop names in a feature list.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "This is a focused visual iteration.",
        );
        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
    });

    it("prioritizes the App.tsx route shell before complex-page content", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "edit_file",
                path: "src/App.tsx",
                oldText: "const current = 'home';",
                newText: "const current = window.location.hash;",
            }),
        });
        const agent = new CodingAgent({ model: provider });

        await agent.decideNextAction(
            "Add page switching to the Apex site",
            "Route-shell-first execution order: edit App.tsx first.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "first implementation action must be an edit_file for src/App.tsx",
        );
        expect(systemPrompt).toContain(
            "Do not start with content.ts, App.css, images, or visual polish.",
        );
        expect(systemPrompt).not.toContain(
            "If src/content.ts and src/App.css have not already been written",
        );
        expect(systemPrompt).not.toContain(
            "Recommended complex-page batch",
        );
        expect(systemPrompt).not.toContain(
            "For an explicitly minimal page or a small non-page app request",
        );
    });



    it("prioritizes a runnable App.tsx for entrypoint-first initial generation", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export function App(){return <main><h1>战术行动</h1></main>}",
            }),
        });
        const agent = new CodingAgent({
            model: provider,
            entrypointFirst: true,
            imageToolsEnabled: true,
        });

        await agent.decideNextAction(
            "创建一个沉浸式战术游戏专题网站",
            "Workspace execution mode: initial generation.",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";

        expect(systemPrompt).toContain(
            "This request uses entrypoint-first execution.",
        );
        expect(systemPrompt).toContain(
            "first implementation action must be a write_file for src/App.tsx",
        );
        expect(systemPrompt).toContain(
            "Do not start with content.ts, App.css, images, or visual polish.",
        );
        expect(systemPrompt).not.toContain(
            "Preferred action order: get_image",
        );
        expect(systemPrompt).not.toContain(
            "If src/content.ts and src/App.css have not already been written",
        );
    });

    it("treats ordinary page requests as complete polished pages by default", async () => {
        expect(
            isLikelyComplexReactPageRequest(
                "Create a page introducing Wenzhou",
            ),
        ).toBe(true);
        expect(
            isLikelyComplexReactPageRequest(
                "我想要一个介绍温州的界面",
            ),
        ).toBe(true);

        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });
        const agent = new CodingAgent({ model: provider });

        await agent.decideNextAction("我想要一个介绍温州的界面");

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";
        expect(systemPrompt).toContain(
            "This request is being treated as a complex page.",
        );
        expect(systemPrompt).toContain(
            "clear high-contrast brand, useful navigation, a topic-specific hero",
        );
        expect(systemPrompt).toContain("visible media or visual panel");
        expect(systemPrompt).toContain(
            "avoid default card grids",
        );
        expect(systemPrompt).toContain(
            "asymmetric section rhythm",
        );
        expect(systemPrompt).toContain(
            "at least three distinct meaningful content sections beyond the hero",
        );
        expect(systemPrompt).toContain(
            "For content, official-site, landing, or introduction pages, still verify",
        );
        expect(systemPrompt).toContain(
            "media or visual panel, post-hero sections",
        );
        expect(systemPrompt).toContain(
            "never substitute lorem ipsum",
        );
        expect(systemPrompt).toContain(
            "do not put page content, CSS, JSX, and assets into one huge src/App.tsx",
        );
        expect(systemPrompt).not.toContain(
            "For an explicitly minimal page or a small non-page app request",
        );
    });

    it("keeps a page small only when the user explicitly requests it", async () => {
        expect(
            isLikelyComplexReactPageRequest(
                "Create a simple single-screen Wenzhou introduction page",
            ),
        ).toBe(false);
        expect(
            isLikelyComplexReactPageRequest(
                "做一个极简单屏的温州介绍界面",
            ),
        ).toBe(false);

        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });
        const agent = new CodingAgent({ model: provider });

        await agent.decideNextAction(
            "Create a simple single-screen Wenzhou introduction page",
        );

        const systemPrompt =
            provider.requests[0]?.messages[0]?.content ?? "";
        expect(systemPrompt).not.toContain(
            "This request is being treated as a complex page.",
        );
        expect(systemPrompt).toContain(
            "For an explicitly minimal page or a small non-page app request",
        );
    });

    it("allows one correction attempt for malformed action output", async () => {
        const provider = new FakeModelProvider([
            {
                content: "not json",
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        const agent = new CodingAgent({
            model: provider,
        });

        const action = await agent.decideNextAction(
            "Create a React task application",
        );

        expect(action).toEqual({
            type: "finish",
            summary: "Done",
        });
        expect(provider.requests).toHaveLength(2);
    });

    it("asks the model to switch to smaller file batches after invalid action output", async () => {
        const provider = new FakeModelProvider([
            {
                content:
                    '{"type":"write_file","path":"src/App.tsx","content":"too large',
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: "export const title = 'Small batch';",
                }),
            },
        ]);

        const agent = new CodingAgent({
            model: provider,
        });

        const action = await agent.decideNextAction(
            "Create a complex university homepage",
        );

        expect(action).toEqual({
            type: "write_file",
            path: "src/content.ts",
            content: "export const title = 'Small batch';",
        });
        expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
            "do not repeat a huge src/App.tsx response",
        );
        expect(provider.requests[1]?.messages.at(-1)?.content).toContain(
            "next corrected action must be src/content.ts or src/App.css",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "This request is being treated as a complex page.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "do not write src/App.tsx yet",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "compact components",
        );
    });

    it("treats Chinese image-heavy official pages as complex page requests", async () => {
        expect(
            isLikelyComplexReactPageRequest(
                "我希望图片是 Apex Legends 里面的图片，不是自然生成的，而且要做完整好看的游戏官网首页",
            ),
        ).toBe(true);

        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction(
            "我希望图片是 Apex Legends 里面的图片，不是自然生成的，而且要做完整好看的游戏官网首页",
        );

        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "This request is being treated as a complex page.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Preferred action order",
        );
    });

    it("treats readable Chinese complex page requests as complex", async () => {
        expect(
            isLikelyComplexReactPageRequest(
                "我希望图片是 Apex 里面的图片，不是自然生成的，而且要做完整好看的游戏官网首页",
            ),
        ).toBe(true);

        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction(
            "我希望图片是 Apex 里面的图片，不是自然生成的，而且要做完整好看的游戏官网首页",
        );

        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "This request is being treated as a complex page.",
        );
    });
});
