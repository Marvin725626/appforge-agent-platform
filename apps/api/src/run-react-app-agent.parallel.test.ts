import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
} from "@appforge/agent-core";
import { afterEach, describe, expect, it } from "vitest";

import { runReactAppAgent } from "./run-react-app-agent.js";

type PagePath =
    | "src/pages/home.tsx"
    | "src/pages/culture.tsx"
    | "src/pages/itinerary.tsx";

const PAGE_PATHS: readonly PagePath[] = [
    "src/pages/home.tsx",
    "src/pages/culture.tsx",
    "src/pages/itinerary.tsx",
];

const GENERATED_PATHS = [
    "src/content.ts",
    "public/assets/site-logo.svg",
    "public/assets/home-visual.svg",
    "public/assets/culture-visual.svg",
    "public/assets/itinerary-visual.svg",
    ...PAGE_PATHS,
    "src/App.css",
    "src/App.tsx",
] as const;

function createPageSource(input: {
    id: "home" | "culture" | "itinerary";
    componentName: "HomePage" | "CulturePage" | "ItineraryPage";
    kicker: string;
    title: string;
    lead: string;
    cards: readonly [
        readonly [string, string],
        readonly [string, string],
        readonly [string, string],
    ];
}): string {
    const visualPath = `/assets/${input.id}-visual.svg`;
    const themeClassById = {
        home: "page-theme-1",
        culture: "page-theme-2",
        itinerary: "page-theme-3",
    } as const;
    return `import React from "react";

export const pageId = ${JSON.stringify(input.id)} as const;

export function ${input.componentName}() {
    return (
        <article className="page-view ${themeClassById[input.id]}" data-page-id=${JSON.stringify(input.id)}>
            <section className="page-hero">
                <div className="page-copy">
                    <p className="page-kicker">${input.kicker}</p>
                    <h1 className="page-title">${input.title}</h1>
                    <p className="page-lead">${input.lead}</p>
                </div>
                <div className="page-media">
                    <img className="page-image" src="${visualPath}" alt="${input.title}主题视觉" />
                </div>
            </section>
            <section className="page-grid" aria-label=${JSON.stringify(input.title)}>
                <section className="page-card page-card--wide">
                    <h2>${input.cards[0][0]}</h2>
                    <p>${input.cards[0][1]}</p>
                </section>
                <section className="page-card page-card--accent">
                    <h2>${input.cards[1][0]}</h2>
                    <p>${input.cards[1][1]}</p>
                </section>
                <section className="page-card">
                    <h2>${input.cards[2][0]}</h2>
                    <p>${input.cards[2][1]}</p>
                </section>
            </section>
            <section className="callout">
                <h2>从真实细节开始认识温州</h2>
                <p>页面以具体地点、文化线索和可执行建议构成完整叙事，而不是重复其他页面或使用占位文案。</p>
            </section>
        </article>
    );
}
`;
}

const PAGE_ARTIFACTS: Record<PagePath, string> = {
    "src/pages/home.tsx": createPageSource({
        id: "home",
        componentName: "HomePage",
        kicker: "山海温州",
        title: "一座山水与烟火共同生长的城市",
        lead: "从瓯江潮声到江心屿灯影，在山、江、海与街巷生活之间建立对温州的第一印象。",
        cards: [
            [
                "山水之城",
                "雁荡奇峰、楠溪清流与东海岛屿共同勾勒城市自然轮廓，四季都能找到不同的抵达方式。",
            ],
            [
                "开放气质",
                "港口、商贸与手工业塑造务实而敢为的城市性格，也让传统与当代持续发生连接。",
            ],
            [
                "温暖日常",
                "糯米饭、鱼丸、茶馆与夜色中的五马街，让宏大的城市故事落到真实可感的生活。",
            ],
        ],
    }),
    "src/pages/culture.tsx": createPageSource({
        id: "culture",
        componentName: "CulturePage",
        kicker: "瓯越文脉",
        title: "在戏曲、书院与手艺之间读懂温州",
        lead: "南戏故里、永嘉学派和精巧地方工艺，共同保存一座城市绵延千年的创造力。",
        cards: [
            [
                "南戏故里",
                "沿着古老声腔与当代舞台的线索，理解南戏如何从温州出发并融入今天的社区文化。",
            ],
            [
                "永嘉学派",
                "经世致用的思想传统把知识与现实生活相连，至今仍能解释温州务实开放的精神来源。",
            ],
            [
                "瓯绣瓯塑",
                "细腻针法、色彩层次与立体塑造展现地方审美，也记录手艺人在时间中积累的耐心。",
            ],
        ],
    }),
    "src/pages/itinerary.tsx": createPageSource({
        id: "itinerary",
        componentName: "ItineraryPage",
        kicker: "三日慢游",
        title: "把老城、江岸、古村与奇峰排进行程",
        lead: "以不过度赶路的节奏连接温州城区、楠溪江和雁荡山，让每一天都有明确主题。",
        cards: [
            [
                "第一日 · 老城与瓯江",
                "从五马街进入街巷，在江心屿看江流与双塔，夜晚回到市区品尝鱼丸和糯米饭。",
            ],
            [
                "第二日 · 楠溪江古村",
                "沿清流前往岩头与苍坡，在宗祠、石巷和田园之间理解温州山水中的聚落生活。",
            ],
            [
                "第三日 · 雁荡奇峰",
                "用一整天游览灵峰、灵岩与大龙湫，根据天气和体力调整步行路线并预留返程时间。",
            ],
        ],
    }),
};

const PLANNER_RESPONSE: ModelResponse = {
    content: JSON.stringify({
        summary: "每个温州网页由一次独立 Coding API 调用生成",
        steps: [
            {
                id: "step-1",
                title: "定义温州多页面信息架构",
                description:
                    "共享品牌契约，并分别生成首页、文化页与行程页。",
                acceptanceCriteria: [
                    "三个页面拥有独立 URL、标题和真实主题内容",
                    "本地路由外壳支持深链与浏览器前进后退",
                ],
            },
        ],
        site: {
            title: "山海温州",
            tagline: "山海相拥，古今共生",
        },
        pages: [
            {
                id: "home",
                path: "/",
                label: "首页",
                purpose: "建立温州山水、人文和城市生活的完整第一印象。",
                acceptanceCriteria: ["首页有独立 hero 和至少三个真实内容板块"],
            },
            {
                id: "culture",
                path: "/culture",
                label: "文化",
                purpose: "介绍南戏、永嘉学派与温州地方工艺。",
                acceptanceCriteria: ["文化页内容不与首页重复"],
            },
            {
                id: "itinerary",
                path: "/itinerary",
                label: "行程",
                purpose: "提供连接城区、楠溪江和雁荡山的三日行程。",
                acceptanceCriteria: ["行程页给出三天可执行安排"],
            },
        ],
    }),
};

class PromptAwareModelProvider implements ModelProvider {
    readonly requests: ModelRequest[] = [];
    readonly pageRequests: ModelRequest[] = [];
    plannerRequests = 0;
    reviewerRequests = 0;
    legacyCodingRequests = 0;

    async complete(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        const systemPrompt = request.messages[0]?.content ?? "";
        const fullPrompt = request.messages
            .map((message) => message.content)
            .join("\n");

        if (systemPrompt.includes("software planning agent")) {
            this.plannerRequests += 1;
            return PLANNER_RESPONSE;
        }

        if (systemPrompt.includes("Coding Agent in a parallel React/Vite build")) {
            this.pageRequests.push(request);
            const match = /Owned file:\s*(src\/pages\/(?:home|culture|itinerary)\.tsx)/u.exec(
                fullPrompt,
            );
            const ownedPath = match?.[1] as PagePath | undefined;

            if (!ownedPath || !PAGE_PATHS.includes(ownedPath)) {
                throw new Error(
                    `Page request did not name a known owned file: ${fullPrompt}`,
                );
            }

            return {
                content: JSON.stringify({
                    path: ownedPath,
                    content: PAGE_ARTIFACTS[ownedPath],
                    summary: `完成 ${ownedPath}`,
                }),
            };
        }

        if (systemPrompt.includes("independent software reviewer")) {
            this.reviewerRequests += 1;
            return {
                content: JSON.stringify({
                    accepted: true,
                    reason: "三个独立页面和本地路由外壳共同构成完整温州体验。",
                    issues: [],
                }),
            };
        }

        if (systemPrompt.includes("You are a coding agent.")) {
            this.legacyCodingRequests += 1;
            throw new Error(
                "Legacy Coding Agent must not run on the page-per-API path",
            );
        }

        throw new Error(`Unexpected model request: ${systemPrompt}`);
    }
}

describe("runReactAppAgent page-per-API coding path", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    async function createFixture(prefix: string): Promise<{
        workspaceRoot: string;
        templateRoot: string;
    }> {
        const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
        temporaryDirectories.push(temporaryRoot);
        const templateRoot = path.join(temporaryRoot, "template");
        const workspaceRoot = path.join(temporaryRoot, "workspace");
        await mkdir(path.join(templateRoot, "src"), { recursive: true });
        await mkdir(workspaceRoot, { recursive: true });
        await Promise.all([
            writeFile(
                path.join(templateRoot, "package.json"),
                JSON.stringify({
                    name: "page-per-api-fixture",
                    version: "1.0.0",
                    private: true,
                    type: "module",
                    scripts: {
                        build: 'node -e "process.exit(0)"',
                    },
                }),
                "utf8",
            ),
            writeFile(
                path.join(templateRoot, "index.html"),
                '<div id="root"></div>',
                "utf8",
            ),
            writeFile(
                path.join(templateRoot, "src", "main.tsx"),
                'import { App } from "./App.js";\nvoid App;\n',
                "utf8",
            ),
            writeFile(
                path.join(templateRoot, "src", "App.tsx"),
                'export function App() { return <main><h1>Starter</h1></main>; }\n',
                "utf8",
            ),
            writeFile(
                path.join(templateRoot, "src", "App.css"),
                "body { margin: 0; }\n",
                "utf8",
            ),
        ]);

        return { workspaceRoot, templateRoot };
    }

    it("plans three pages, makes three page Coding requests, merges locally, and builds", async () => {
        const { workspaceRoot, templateRoot } = await createFixture(
            "appforge-page-per-api-integration-test-",
        );
        const model = new PromptAwareModelProvider();
        const result = await runReactAppAgent({
            goal: "创建完整温州网站，包含首页、文化和行程页面并支持真实 URL 跳转",
            resetWorkspace: true,
            workspaceRoot,
            templateRoot,
            llm: {
                baseUrl: "http://unused.test",
                apiKey: "test-key",
                model: "test-model",
            },
            model,
            parallelCoding: true,
            parallelCodingConcurrency: 2,
            maxRepairAttempts: 0,
        });

        expect(model.plannerRequests).toBe(1);
        expect(model.pageRequests).toHaveLength(3);
        expect(model.reviewerRequests).toBe(1);
        expect(model.legacyCodingRequests).toBe(0);
        expect(
            model.pageRequests.map((request) =>
                /Owned file:\s*(src\/pages\/(?:home|culture|itinerary)\.tsx)/u.exec(
                    request.messages.map((message) => message.content).join("\n"),
                )?.[1],
            ),
        ).toEqual(expect.arrayContaining([...PAGE_PATHS]));

        const workstreams = result.attempts[0]?.parallelWorkstreams;
        expect(workstreams).toHaveLength(3);
        expect(workstreams).toEqual(
            expect.arrayContaining(
                PAGE_PATHS.map((filePath) =>
                    expect.objectContaining({
                        role: "page",
                        path: filePath,
                        status: "succeeded",
                    }),
                ),
            ),
        );
        expect(result.agent.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "write_file",
            "finish",
        ]);
        expect(result.agent.finished).toBe(true);
        expect(result.install.exitCode).toBe(0);
        expect(result.build.exitCode).toBe(0);
        expect(
            result.agent.steps.flatMap((step) =>
                step.action.type === "write_file" ? [step.action.path] : [],
            ),
        ).toEqual(GENERATED_PATHS);

        await Promise.all(
            PAGE_PATHS.map(async (filePath) => {
                expect(
                    await readFile(path.join(workspaceRoot, filePath), "utf8"),
                ).toBe(PAGE_ARTIFACTS[filePath]);
            }),
        );
        const contentSource = await readFile(
            path.join(workspaceRoot, "src", "content.ts"),
            "utf8",
        );
        const stylesSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );
        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        expect(contentSource).toContain('brand: "山海温州"');
        expect(contentSource).toContain('path: "/itinerary"');
        expect(stylesSource).toContain(".page-view");
        expect(stylesSource).toContain("prefers-reduced-motion");
        expect(appSource).toContain(
            'import { HomePage } from "./pages/home.js";',
        );
        expect(appSource).toContain(
            'import { CulturePage } from "./pages/culture.js";',
        );
        expect(appSource).toContain(
            'import { ItineraryPage } from "./pages/itinerary.js";',
        );
        expect(appSource).toContain('window.addEventListener("hashchange"');
    }, 60_000);

    it("keeps each page hard deadline when the run also has an outer signal", async () => {
        const { workspaceRoot, templateRoot } = await createFixture(
            "appforge-page-per-api-deadline-test-",
        );
        const observedPageSignals: AbortSignal[] = [];
        const model: ModelProvider = {
            async complete(request) {
                const systemPrompt = request.messages[0]?.content ?? "";

                if (systemPrompt.includes("software planning agent")) {
                    return PLANNER_RESPONSE;
                }

                if (
                    systemPrompt.includes(
                        "Coding Agent in a parallel React/Vite build",
                    )
                ) {
                    const signal = request.signal;

                    if (!signal) {
                        throw new Error("Expected a composed page signal");
                    }
                    observedPageSignals.push(signal);

                    return await new Promise<ModelResponse>(
                        (_resolve, reject) => {
                            const rejectWithReason = () =>
                                reject(signal.reason);

                            if (signal.aborted) {
                                rejectWithReason();
                                return;
                            }
                            signal.addEventListener(
                                "abort",
                                rejectWithReason,
                                { once: true },
                            );
                        },
                    );
                }

                throw new Error(`Unexpected request: ${systemPrompt}`);
            },
        };
        const outerController = new AbortController();
        const startedAt = Date.now();

        const result = await runReactAppAgent({
            goal: "创建温州首页、文化和行程页面并支持 URL 跳转",
            workspaceRoot,
            templateRoot,
            model,
            signal: outerController.signal,
            parallelCoding: true,
            parallelCodingConcurrency: 2,
            parallelCodingTimeoutMs: 100,
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "http://unused.test",
                apiKey: "test-key",
                model: "test-model",
                hardTimeoutMs: 1_000,
            },
        });

        expect(Date.now() - startedAt).toBeLessThan(3_000);
        expect(result.agent).toMatchObject({
            finished: true,
            stopReason: "finish",
        });
        expect(result.agent.steps.length).toBeGreaterThan(0);
        expect(result.review).toMatchObject({ accepted: false });
        expect(result.review.reason).toContain("used local fallback");
        expect(observedPageSignals).toHaveLength(3);
        expect(
            observedPageSignals.every((signal) => signal.aborted),
        ).toBe(true);
        expect(outerController.signal.aborted).toBe(false);
    });
});
