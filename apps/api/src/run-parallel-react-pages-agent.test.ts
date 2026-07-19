import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
    PlannerOutput,
} from "@appforge/agent-core";
import {
    FakeImageAssetProvider,
    ImageAssetTool,
} from "@appforge/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    inferSiteIdentityFromGoal,
    resolveReactPagePlans,
    runParallelReactPagesAgent,
} from "./run-parallel-react-pages-agent.js";
import { createFallbackDesignPlan } from "./design-plan-utils.js";

type PageId = "home" | "culture" | "itinerary";

const PAGE_IDS: readonly PageId[] = ["home", "culture", "itinerary"];

const PAGE_COMPONENTS: Record<PageId, string> = {
    home: "HomePage",
    culture: "CulturePage",
    itinerary: "ItineraryPage",
};

const PAGE_LABELS: Record<PageId, string> = {
    home: "首页",
    culture: "文化",
    itinerary: "行程",
};

const PLANNER_OUTPUT: PlannerOutput = {
    summary: "用三个独立页面完整呈现温州，并由共享路由连接页面。",
    steps: [
        {
            id: "step-1",
            title: "并行生成页面",
            description: "首页、文化和行程页面分别由独立 Coding API 完成。",
            acceptanceCriteria: ["三个页面内容独立且能够通过 URL 跳转"],
        },
    ],
    site: {
        title: "温州印象",
        tagline: "山海相拥，古今相映",
    },
    pages: [
        {
            id: "home",
            path: "/",
            label: "首页",
            purpose: "建立温州城市印象并引导访问其他主题页面。",
            acceptanceCriteria: ["展示山水、城市与生活三个主题"],
        },
        {
            id: "culture",
            path: "/culture",
            label: "文化",
            purpose: "介绍温州的南戏、瓯越工艺和永嘉文脉。",
            acceptanceCriteria: ["提供三个有事实含量的文化板块"],
        },
        {
            id: "itinerary",
            path: "/itinerary",
            label: "行程",
            purpose: "给出可执行的温州三日行程安排。",
            acceptanceCriteria: ["每天都有明确地点和体验重点"],
        },
    ],
};

const FALLBACK_PLANNER_OUTPUT: PlannerOutput = {
    summary: "根据用户的页面描述生成站点结构。",
    steps: [
        {
            id: "step-1",
            title: "生成页面",
            description: "从用户目标推断必要页面。",
            acceptanceCriteria: ["页面结构满足跳转要求"],
        },
    ],
};

function pageSource(
    pageId: PageId,
    visualPath = `/assets/${pageId}-visual.svg`,
): string {
    const label = PAGE_LABELS[pageId];
    const componentName = PAGE_COMPONENTS[pageId];
    const heroTag = pageId === "culture" ? "header" : "section";
    const themeClass = `page-theme-${PAGE_IDS.indexOf(pageId) + 1}`;

    return `import React from "react";

export const pageId = ${JSON.stringify(pageId)} as const;

export function ${componentName}() {
    return (
        <article className="page-view ${themeClass}" data-page-id=${JSON.stringify(pageId)}>
            <${heroTag} className="page-hero">
                <div className="page-copy">
                    <p className="page-kicker">温州专题 · ${label}</p>
                    <h1>${label}里的温州，既有山海尺度，也有日常温度</h1>
                    <p className="page-lead">
                        从瓯江潮声、江心屿灯影到古村街巷，这个页面用清晰线索组织真实城市信息，
                        让第一次到访的人能理解地方气质，也能据此安排下一段探索。
                    </p>
                </div>
                <div className="page-media">
                    <img className="page-image" src="${visualPath}" alt="${label}主题视觉" />
                </div>
            </${heroTag}>
            <section className="page-grid" aria-label=${JSON.stringify(`${label}内容`)}>
                <section className="page-card page-card--wide">
                    <p className="eyebrow">山水骨架</p>
                    <h2>江、山与海共同塑造城市方向</h2>
                    <p>
                        瓯江穿城而过，雁荡山以奇峰飞瀑建立远景，楠溪江和古村则保留缓慢尺度。
                        这些空间并非孤立景点，而是理解温州交通、聚落和生活方式的连续坐标。
                    </p>
                </section>
                <section className="page-card">
                    <p className="eyebrow">人文脉络</p>
                    <h2>在南戏、书院与手工艺之间读懂创造力</h2>
                    <p>
                        南戏传统、永嘉学派以及瓯绣瓯塑，展示了地方文化如何在开放商业精神之外，
                        持续保存细腻审美与重视实践的知识传统。
                    </p>
                </section>
                <section className="page-card page-card--accent">
                    <p className="eyebrow">城市日常</p>
                    <h2>清晨市场和夜晚江岸都值得停留</h2>
                    <p>
                        糯米饭、鱼丸、灯盏糕以及街巷茶馆把旅行落到具体时间。避开匆忙打卡，
                        留出一段步行和一次本地早餐，更容易感受到城市真实而友善的节奏。
                    </p>
                </section>
                <section className="page-card">
                    <p className="eyebrow">行动建议</p>
                    <h2>以城区为起点，再向山水两端展开</h2>
                    <p>
                        先用半天认识五马街和江心屿，再根据天气选择楠溪江或雁荡山。
                        将长距离移动集中安排，可以减少折返，也为博物馆、古村和在地餐饮保留充足时间。
                    </p>
                </section>
            </section>
        </article>
    );
}
`;
}

function editorialFlowPageSource(pageId: PageId): string {
    const label = PAGE_LABELS[pageId];
    const componentName = PAGE_COMPONENTS[pageId];
    const themeClass = `page-theme-${PAGE_IDS.indexOf(pageId) + 1}`;

    return `import React from "react";

export const pageId = ${JSON.stringify(pageId)} as const;

export function ${componentName}() {
    return (
        <article className="page-view ${themeClass}" data-page-id=${JSON.stringify(pageId)}>
            <section className="page-hero">
                <div className="page-copy">
                    <p className="page-kicker">Wenzhou Guide · ${label}</p>
                    <h1>${label} as a layered city guide, not a card template</h1>
                    <p className="page-lead">A polished editorial route through river islands, mountain scenes, craft culture, old streets, and practical local decisions.</p>
                </div>
                <div className="page-media">
                    <img className="page-image" src="/assets/${pageId}-visual.svg" alt="${label} editorial visual" />
                </div>
            </section>
            <section className="editorial-flow" aria-label=${JSON.stringify(`${label} editorial flow`)}>
                <section className="story-band">
                    <div>
                        <p className="eyebrow">City Thread</p>
                        <h2>Read the city through water, craft, and street rhythm</h2>
                        <p>Connect Jiangxin Island, Nanxi River villages, Yandang Mountain, and Wuma Street as a route instead of isolated boxes.</p>
                    </div>
                    <div className="media-panel"><p>Local texture panel</p></div>
                </section>
                <section className="route-timeline">
                    <div className="route-stop"><strong>Jiangxin Island</strong><span>Twin towers and night river lights.</span></div>
                    <div className="route-stop"><strong>Yandang Mountain</strong><span>Peak silhouettes, waterfalls, and slower hikes.</span></div>
                    <div className="route-stop"><strong>Wuma Street</strong><span>Old commerce and new cafés in one walk.</span></div>
                </section>
                <aside className="map-panel">
                    <p className="eyebrow">Spatial Guide</p>
                    <h2>Plan by coastline, mountain, and old-city distance</h2>
                    <p>Cluster the city core first, then choose one landscape route based on weather.</p>
                </aside>
                <div className="culture-strip">
                    <span className="tag">瓯绣</span>
                    <span className="tag">南戏</span>
                    <span className="tag">永嘉学派</span>
                </div>
            </section>
        </article>
    );
}
`;
}

function gamePageSource(
    pageId: PageId,
    visualPath = `/assets/${pageId}-visual.svg`,
): string {
    const label = PAGE_LABELS[pageId];
    const componentName = PAGE_COMPONENTS[pageId];
    const themeClass = `page-theme-${PAGE_IDS.indexOf(pageId) + 1}`;

    return `import React from "react";

export const pageId = ${JSON.stringify(pageId)} as const;

export function ${componentName}() {
    return (
        <article className="page-view ${themeClass} page-genre-game" data-page-id=${JSON.stringify(pageId)}>
            <section className="page-hero">
                <div className="page-copy">
                    <p className="page-kicker">APEX LIVE OPS · ${label}</p>
                    <h1>${label} 战术大厅：把传奇、地图与赛季节奏压进同一个作战界面</h1>
                    <p className="page-lead">
                        这个页面用游戏站的舞台逻辑呈现 Apex Legends：先给玩家强烈的战斗氛围，再把模式、英雄定位、
                        补给节奏和团队行动拆成可快速扫读的 HUD 信息，而不是把内容塞进普通城市导览式卡片。
                    </p>
                </div>
                <div className="page-media">
                    <img className="page-image" src="${visualPath}" alt="${label} Apex Legends 战术视觉" />
                </div>
            </section>
            <section className="game-stage" aria-label=${JSON.stringify(`${label}游戏界面模块`)}>
                <div>
                    <div className="game-hud">
                        <span className="hud-pill">S20 READY</span>
                        <span className="hud-pill">TRIOS · RANKED · MIXTAPE</span>
                        <span className="hud-pill">DROP / LOOT / ROTATE</span>
                    </div>
                    <section className="game-panel">
                        <p className="eyebrow">LEGEND LOADOUT</p>
                        <h2>不是信息卡片，而是玩家进入战场前的指挥面板</h2>
                        <p>
                            页面主区域模拟战术终端，把突击、侦察、支援与控制型传奇放在同一决策语境里。
                            玩家首先看到赛季目标和当前模式，再阅读推荐阵容、转点路线和关键资源节奏。
                        </p>
                    </section>
                    <section className="game-callout">
                        <p className="eyebrow">MATCH FLOW</p>
                        <h2>从跳伞到决赛圈，用横向节奏组织内容</h2>
                        <p>
                            视觉上使用霓虹边线、深色玻璃面板、状态芯片和大面积角色视觉，而不是整齐三列盒子。
                            这样更接近游戏官网和赛季活动页，也能让用户感觉页面属于游戏本身。
                        </p>
                    </section>
                </div>
                <aside className="game-rail">
                    <section className="game-panel">
                        <p className="eyebrow">SQUAD STATUS</p>
                        <h2>三人协同</h2>
                        <p>突进位制造开口，侦察位确认圈边信息，支援位在交火后恢复资源。</p>
                    </section>
                    <div className="game-slab">HOT DROP · WORLD'S EDGE</div>
                    <section className="game-callout">
                        <p className="eyebrow">PLAYER PROMISE</p>
                        <h2>每一次点击都像进入下一块作战屏</h2>
                        <p>导航跳转应保持电影感、速度感和清晰当前状态，而不是普通文旅页面的温和卡片节奏。</p>
                    </section>
                </aside>
            </section>
        </article>
    );
}
`;
}

type ExtraGrammar = "dashboard" | "commerce" | "product" | "portfolio";

function typedGrammarPageSource(
    pageId: PageId,
    grammar: ExtraGrammar,
    visualPath = `/assets/${pageId}-visual.svg`,
): string {
    const label = PAGE_LABELS[pageId];
    const componentName = PAGE_COMPONENTS[pageId];
    const themeClass = `page-theme-${PAGE_IDS.indexOf(pageId) + 1}`;
    const genreClass = `page-genre-${grammar}`;
    const bodyByGrammar: Record<ExtraGrammar, string> = {
        dashboard: `<section className="dashboard-shell" aria-label=${JSON.stringify(`${label}数据工作台`)}>
                <div className="dashboard-kpis">
                    <section className="kpi-tile"><p className="eyebrow">Active</p><strong>98%</strong><p>关键服务在线率</p></section>
                    <section className="kpi-tile"><p className="eyebrow">Risk</p><strong>12</strong><p>需要人工处理的告警</p></section>
                    <section className="activity-feed"><div className="activity-item">订单同步完成</div><div className="activity-item">库存预警已推送</div></section>
                </div>
                <section className="dashboard-panel">
                    <h2>运营状态不是普通卡片，而是可决策的信息密度</h2>
                    <div className="chart-frame"><div className="chart-bars"><span style={{ height: "42%" }} /><span style={{ height: "68%" }} /><span style={{ height: "84%" }} /></div></div>
                </section>
            </section>`,
        commerce: `<section className="commerce-stage" aria-label=${JSON.stringify(`${label}商品购买区`)}>
                <div className="product-showcase"><img className="page-image" src="${visualPath}" alt="${label}商品展示" /></div>
                <section className="buy-panel">
                    <p className="eyebrow">Limited Drop</p>
                    <h2>商品页要先服务购买决策，而不是做成内容网格</h2>
                    <div className="price-strip"><strong>¥899</strong><span>今日会员价</span></div>
                    <ul className="spec-list"><li>三档规格可选</li><li>48小时发货</li><li>支持无理由退换</li></ul>
                    <div className="commerce-panel">品质、物流、保障和适用场景集中说明。</div>
                </section>
            </section>`,
        product: `<section className="product-stage" aria-label=${JSON.stringify(`${label}产品工作流`)}>
                <section className="product-panel">
                    <p className="eyebrow">Workflow OS</p>
                    <h2>产品站重点展示工作流和价值路径</h2>
                    <p>用产品界面、功能带和证明点组织信息，而不是平均分配成三张说明卡。</p>
                    <div className="feature-strip"><span className="feature-chip">自动编排</span><span className="feature-chip">实时协作</span><span className="feature-chip">安全审计</span></div>
                </section>
                <div className="product-screen"><img className="page-image" src="${visualPath}" alt="${label}产品界面" /></div>
                <div className="proof-row"><span className="proof-pill">上线快 42%</span><span className="proof-pill">工单少 31%</span></div>
            </section>`,
        portfolio: `<section className="portfolio-wall" aria-label=${JSON.stringify(`${label}作品展示`)}>
                <section className="profile-panel"><p className="eyebrow">Creative Profile</p><h2>作品集需要策展节奏，而不是统一盒子</h2><p>先展示风格、方法和代表成果，再让项目自然形成高低错落的阅读路径。</p></section>
                <section className="project-tile"><h2>品牌视觉重构</h2><p>从标识、色彩到落地页面建立完整表达。</p></section>
                <section className="project-tile"><h2>影像系列</h2><p>用叙事照片和留白组成节奏。</p></section>
                <div className="showcase-strip"><span /><span /><span /></div>
            </section>`,
    };

    return `import React from "react";

export const pageId = ${JSON.stringify(pageId)} as const;

export function ${componentName}() {
    return (
        <article className="page-view ${themeClass} ${genreClass}" data-page-id=${JSON.stringify(pageId)}>
            <section className="page-hero">
                <div className="page-copy">
                    <p className="page-kicker">${grammar.toUpperCase()} · ${label}</p>
                    <h1>${label} 根据页面类型采用专属信息架构</h1>
                    <p className="page-lead">这个页面验证工作流可以按类型选择布局，不再把所有需求都压成统一盒子网格。</p>
                </div>
                <div className="page-media">
                    <img className="page-image" src="${visualPath}" alt="${label}主题视觉" />
                </div>
            </section>
            ${bodyByGrammar[grammar]}
        </article>
    );
}
`;
}

type VisualGrammarUnderTest = ExtraGrammar | "immersive-game";

function typedOrGamePageSource(
    pageId: PageId,
    grammar: VisualGrammarUnderTest,
): string {
    return grammar === "immersive-game"
        ? gamePageSource(pageId)
        : typedGrammarPageSource(pageId, grammar);
}

function injectForbiddenCardClass(
    source: string,
    grammar: VisualGrammarUnderTest,
): string {
    const structureClassByGrammar: Record<VisualGrammarUnderTest, string> = {
        "immersive-game": "game-stage",
        dashboard: "dashboard-shell",
        commerce: "commerce-stage",
        product: "product-stage",
        portfolio: "portfolio-wall",
    };
    const structureClass = structureClassByGrammar[grammar];

    return source.replace(
        `className="${structureClass}"`,
        `className="page-card ${structureClass}"`,
    );
}

function findOwnedPage(request: ModelRequest): PageId {
    const prompt = request.messages.map((message) => message.content).join("\n");
    const match = /Owned file:\s*src\/pages\/(home|culture|itinerary)\.tsx/u.exec(
        prompt,
    );
    const pageId = match?.[1] as PageId | undefined;

    if (!pageId || !PAGE_IDS.includes(pageId)) {
        throw new Error(`Request did not identify a known page: ${prompt}`);
    }

    return pageId;
}

function artifactResponse(
    pageId: PageId,
    content = pageSource(pageId),
): ModelResponse {
    return {
        content: JSON.stringify({
            path: `src/pages/${pageId}.tsx`,
            content,
            summary: `完成${PAGE_LABELS[pageId]}页面`,
        }),
    };
}

type PageProviderCall = {
    pageId: PageId;
    attempt: number;
    request: ModelRequest;
};

class PageModelProvider implements ModelProvider {
    readonly calls = new Map<PageId, number>();
    activeCalls = 0;
    maxActiveCalls = 0;

    constructor(
        private readonly respond: (
            call: PageProviderCall,
        ) => ModelResponse | Promise<ModelResponse>,
    ) {}

    async complete(request: ModelRequest): Promise<ModelResponse> {
        const pageId = findOwnedPage(request);
        const attempt = (this.calls.get(pageId) ?? 0) + 1;
        this.calls.set(pageId, attempt);
        this.activeCalls += 1;
        this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);

        try {
            return await this.respond({ pageId, attempt, request });
        } finally {
            this.activeCalls -= 1;
        }
    }

    count(pageId: PageId): number {
        return this.calls.get(pageId) ?? 0;
    }
}

function createGate(): { promise: Promise<void>; release: () => void } {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });

    return { promise, release };
}

describe("runParallelReactPagesAgent", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    async function createWorkspace(): Promise<string> {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-pages-agent-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src", "pages"), {
            recursive: true,
        });
        return workspaceRoot;
    }

    it("runs one initial Coding API call per planned page with bounded concurrency and locally merges the site shell", async () => {
        const workspaceRoot = await createWorkspace();
        const gates = new Map(
            PAGE_IDS.map((pageId) => [pageId, createGate()] as const),
        );
        const provider = new PageModelProvider(async ({ pageId }) => {
            await gates.get(pageId)?.promise;
            return artifactResponse(pageId);
        });
        const execution = runParallelReactPagesAgent({
            goal: "创建温州网站，包括首页、文化和行程页面，并且可以跳转",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        try {
            await vi.waitFor(() => {
                expect(provider.activeCalls).toBe(2);
                expect(provider.maxActiveCalls).toBe(2);
                expect(provider.count("itinerary")).toBe(0);
            });

            gates.get("home")?.release();

            await vi.waitFor(() => {
                expect(provider.count("itinerary")).toBe(1);
                expect(provider.activeCalls).toBe(2);
            });
        } finally {
            for (const gate of gates.values()) {
                gate.release();
            }
        }

        const result = await execution;

        expect(result.agent).toMatchObject({
            finished: true,
            stopReason: "finish",
        });
        expect(provider.maxActiveCalls).toBe(2);
        expect(PAGE_IDS.map((pageId) => provider.count(pageId))).toEqual([
            1, 1, 1,
        ]);
        expect(result.workstreams).toEqual(
            PAGE_IDS.map((pageId) =>
                expect.objectContaining({
                    id: pageId,
                    role: "page",
                    path: `src/pages/${pageId}.tsx`,
                    status: "succeeded",
                    generationAttempts: 1,
                }),
            ),
        );

        await Promise.all(
            PAGE_IDS.map(async (pageId) => {
                expect(
                    await readFile(
                        path.join(workspaceRoot, "src", "pages", `${pageId}.tsx`),
                        "utf8",
                    ),
                ).toBe(pageSource(pageId));
            }),
        );
        const app = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        const content = await readFile(
            path.join(workspaceRoot, "src", "content.ts"),
            "utf8",
        );
        const styles = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );
        const homeVisual = await readFile(
            path.join(workspaceRoot, "public", "assets", "home-visual.svg"),
            "utf8",
        );
        expect(app).toContain('import { HomePage } from "./pages/home.js";');
        expect(app).toContain('import { CulturePage } from "./pages/culture.js";');
        expect(app).toContain(
            'import { ItineraryPage } from "./pages/itinerary.js";',
        );
        expect(app).toContain('path: "/culture"');
        expect(app).toContain('path: "/itinerary"');
        expect(content).toContain('brand: "温州印象"');
        expect(content).toContain('id: "culture", path: "/culture"');
        expect(styles).toContain(".page-view");
        expect(styles).toContain(".page-grid");
        expect(styles).toContain(".page-image");
        expect(homeVisual).toContain("<svg");
        expect(homeVisual).toContain("首页");
        expect(
            result.agent.steps.flatMap((step) =>
                step.action.type === "write_file" ? [step.action.path] : [],
            ),
        ).toEqual([
            "src/content.ts",
            "public/assets/site-logo.svg",
            "public/assets/home-visual.svg",
            "public/assets/culture-visual.svg",
            "public/assets/itinerary-visual.svg",
            "src/pages/home.tsx",
            "src/pages/culture.tsx",
            "src/pages/itinerary.tsx",
            "src/App.css",
            "src/App.tsx",
        ]);
    });

    it("passes a shared DesignPlan to every page agent and writes project-specific styles", async () => {
        const workspaceRoot = await createWorkspace();
        const pagePrompts: string[] = [];
        const designPlan = createFallbackDesignPlan({
            goal: "创建温州城市文化编辑页，不要卡片化，不要蓝色模板，要像杂志路线一样展开",
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
        });
        const provider = new PageModelProvider(({ pageId, request }) => {
            pagePrompts.push(
                request.messages.map((message) => message.content).join("\n"),
            );
            return artifactResponse(pageId, editorialFlowPageSource(pageId));
        });

        const result = await runParallelReactPagesAgent({
            goal: "创建温州城市文化编辑页，不要卡片化，不要蓝色模板，要像杂志路线一样展开",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
            designPlan,
            designPlanSource: "fallback",
        });

        expect(result.agent.finished).toBe(true);
        expect(result.designPlan).toEqual(designPlan);
        expect(result.designPlanSource).toBe("fallback");
        expect(pagePrompts).toHaveLength(PAGE_IDS.length);
        expect(
            pagePrompts.every((prompt) =>
                prompt.includes("Structured DesignPlan v1:"),
            ),
        ).toBe(true);
        expect(
            pagePrompts.every((prompt) =>
                prompt.includes(designPlan.visualDNA.composition),
            ),
        ).toBe(true);
        expect(
            pagePrompts.every((prompt) =>
                prompt.includes("forbiddenPatterns: card grid"),
            ),
        ).toBe(true);

        const styles = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );
        expect(styles).toContain("--project-composition");
        expect(styles).toContain("--surface-strategy: mixed");
        expect(styles).toContain("--section-rhythm");
        expect(styles).toContain("--unique-motifs");
        expect(styles).toContain("route timeline");
        expect(styles).not.toContain("--color-ink-900");
        expect(styles).not.toContain("--radius-component");
    });

    it("marks invalid page model output as fallback instead of normal success", async () => {
        const workspaceRoot = await createWorkspace();
        const provider = new PageModelProvider(() => ({
            content: "{\"path\":\"src/pages/home.tsx\",\"content\":",
        }));

        const result = await runParallelReactPagesAgent({
            goal: "Create a routed city culture site",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 1,
            workstreamTimeoutMs: 10_000,
        });

        expect(result.agent.finished).toBe(true);
        expect(result.workstreams.every((workstream) => workstream.status === "fallback")).toBe(true);
        expect(result.workstreams[0]?.errorMessage).toContain(
            "该页面的模型输出无效，目前展示的是本地兜底草稿。",
        );
    });

    it("uses formal image assets instead of SVG placeholders when the image tool is configured", async () => {
        const workspaceRoot = await createWorkspace();
        const imageProvider = new FakeImageAssetProvider(
            PAGE_IDS.map(() => ({
                data: new Uint8Array([137, 80, 78, 71]),
                mediaType: "image/png" as const,
                source: "fake-generated-image",
            })),
        );
        const imageAssetTool = new ImageAssetTool({
            workspaceRoot,
            provider: imageProvider,
        });
        const provider = new PageModelProvider(({ pageId }) =>
            artifactResponse(
                pageId,
                pageSource(pageId, `/assets/${pageId}-hero.jpg`),
            ),
        );

        const result = await runParallelReactPagesAgent({
            goal: "创建温州网站，包括首页、文化和行程页面，并且可以跳转",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
            imageAssetTool,
            imageAssetModes: ["generate"],
        });

        expect(result.agent.finished).toBe(true);
        expect(imageProvider.requests).toHaveLength(3);
        expect(imageProvider.requests.map((request) => request.mode)).toEqual([
            "generate",
            "generate",
            "generate",
        ]);

        const homePage = await readFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            "utf8",
        );
        expect(homePage).toContain('src="/assets/home-hero.png"');
        expect(homePage).not.toContain("/assets/home-visual.svg");
        expect(
            await readFile(
                path.join(workspaceRoot, "public", "assets", "home-hero.png"),
            ),
        ).toEqual(Buffer.from([137, 80, 78, 71]));
        expect(
            result.agent.steps.flatMap((step) =>
                step.action.type === "get_image" ? [step.action.outputPath] : [],
            ),
        ).toEqual([
            "public/assets/home-hero.jpg",
            "public/assets/culture-hero.jpg",
            "public/assets/itinerary-hero.jpg",
        ]);
    });

    it("accepts non-card editorial flows for city and culture pages", async () => {
        const workspaceRoot = await createWorkspace();
        const prompts: string[] = [];
        const provider = new PageModelProvider(({ pageId, request }) => {
            prompts.push(
                request.messages.map((message) => message.content).join("\n"),
            );
            return artifactResponse(pageId, editorialFlowPageSource(pageId));
        });

        const result = await runParallelReactPagesAgent({
            goal: "Build a polished Wenzhou city and culture guide with multiple pages and navigation",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        const homePage = await readFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            "utf8",
        );
        const styles = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(homePage).toContain("editorial-flow");
        expect(homePage).toContain("route-timeline");
        expect(homePage).not.toContain("page-card");
        expect(styles).toContain(".editorial-flow");
        expect(styles).toContain(".story-band");
        expect(prompts.join("\n")).toContain("create one editorial-flow");
        expect(prompts.join("\n")).toContain("Avoid page-grid/page-card");
        expect(prompts.join("\n")).toContain(
            "Do not make every section a same-looking card grid",
        );
    });

    it.each([
        ["Apex Legends 游戏官网首页", "Apex Legends战术站", undefined],
        ["瓦罗兰特官网首页", "瓦罗兰特战术站", undefined],
        [
            "星环突击官网首页",
            "星环突击战术站",
            {
                summary:
                    "星环突击 is a tactical shooter video game with agents, weapons, maps, ranked seasons, and esports matches.",
                tags: ["video game", "tactical shooter", "fps"],
            },
        ],
    ] as const)(
        "allows %s to use immersive UI grammar instead of card grids",
        async (_label, siteTitle, lookupResult) => {
        const workspaceRoot = await createWorkspace();
        const prompts: string[] = [];
        const lookupQueries: string[] = [];
        const provider = new PageModelProvider(({ pageId, request }) => {
            prompts.push(request.messages.map((message) => message.content).join("\n"));
            return artifactResponse(pageId, gamePageSource(pageId));
        });

        const result = await runParallelReactPagesAgent({
            goal: `做一个${_label}，并且可以在多个页面切换`,
            plannerOutput: {
                ...PLANNER_OUTPUT,
                site: {
                    title: siteTitle,
                    tagline: "赛季、传奇和地图节奏一屏展开",
                },
            },
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
            ...(lookupResult
                ? {
                      topicLookupProvider: {
                          async lookup(query: string) {
                              lookupQueries.push(query);
                              return lookupResult;
                          },
                      },
                  }
                : {}),
        });

        expect(result.agent.finished).toBe(true);
        const homePage = await readFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            "utf8",
        );
        const styles = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );
        const app = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(app).toContain("site-genre-game");
        expect(homePage).toContain("page-genre-game");
        expect(homePage).toContain("game-stage");
        expect(homePage).toContain("game-hud");
        expect(homePage).not.toContain("page-grid");
        expect(homePage).not.toContain("page-card");
        expect(styles).toContain(".page-genre-game");
        expect(styles).toContain(".site-genre-game");
        expect(styles).toContain(".game-stage");
        expect(styles).toContain("clip-path: polygon");
        expect(styles).toContain("font-size: clamp(1.05rem");
        expect(prompts.join("\n")).toContain(
            "Use immersive game-site visual grammar",
        );
        expect(prompts.join("\n")).toContain(
            "instead of a mandatory page-grid",
        );
        expect(prompts.join("\n")).toContain(
            "Game pages may use small HUD modules",
        );
        if (lookupResult) {
            expect(lookupQueries).toHaveLength(1);
            expect(lookupQueries[0]).toContain(siteTitle);
        }
    });

    it.each([
        ["dashboard", "做一个运营数据看板后台，可以多个页面切换", "page-genre-dashboard", "dashboard-shell", "dashboard/admin visual grammar"],
        ["commerce", "做一个高端耳机电商商品页，可以多个页面切换", "page-genre-commerce", "commerce-stage", "commerce/product-detail visual grammar"],
        ["product", "做一个 SaaS 自动化工具产品官网，可以多个页面切换", "page-genre-product", "product-stage", "SaaS/product visual grammar"],
        ["portfolio", "做一个设计师作品集网站，可以多个页面切换", "page-genre-portfolio", "portfolio-wall", "portfolio/creative visual grammar"],
    ] as const)(
        "allows %s pages to use type-specific grammar instead of card grids",
        async (grammar, goal, genreClass, structureClass, promptCue) => {
            const workspaceRoot = await createWorkspace();
            const prompts: string[] = [];
            const provider = new PageModelProvider(({ pageId, request }) => {
                prompts.push(
                    request.messages
                        .map((message) => message.content)
                        .join("\n"),
                );
                return artifactResponse(
                    pageId,
                    typedGrammarPageSource(pageId, grammar),
                );
            });

            const result = await runParallelReactPagesAgent({
                goal,
                plannerOutput: PLANNER_OUTPUT,
                model: provider,
                workspaceRoot,
                routeRequest: true,
                maxConcurrency: 2,
            });

            expect(result.agent.finished).toBe(true);
            const homePage = await readFile(
                path.join(workspaceRoot, "src", "pages", "home.tsx"),
                "utf8",
            );
            const styles = await readFile(
                path.join(workspaceRoot, "src", "App.css"),
                "utf8",
            );
            const app = await readFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                "utf8",
            );
            const shellClass = `site-genre-${grammar}`;

            expect(app).toContain(shellClass);
            expect(homePage).toContain(genreClass);
            expect(homePage).toContain(structureClass);
            expect(homePage).not.toContain("page-grid");
            expect(homePage).not.toContain("page-card");
            expect(styles).toContain(`.${genreClass}`);
            expect(styles).toContain(`.${shellClass}`);
            expect(styles).toContain(`.${structureClass}`);
            expect(prompts.join("\n")).toContain(promptCue);
            expect(prompts.join("\n")).toContain(
                "Avoid page-grid/page-card as the dominant structure",
            );
        },
    );

    it.each([
        ["immersive-game", "Apex Legends 游戏官网首页"],
        ["dashboard", "做一个运营数据看板后台，可以多个页面切换"],
        ["commerce", "做一个高端耳机电商商品页，可以多个页面切换"],
        ["product", "做一个 SaaS 自动化工具产品官网，可以多个页面切换"],
        ["portfolio", "做一个设计师作品集网站，可以多个页面切换"],
    ] as const)(
        "rejects generic card/grid classes for %s pages before merging",
        async (grammar, goal) => {
            const workspaceRoot = await createWorkspace();
            const provider = new PageModelProvider(({ pageId, attempt }) => {
                const validSource = typedOrGamePageSource(pageId, grammar);
                return artifactResponse(
                    pageId,
                    pageId === "home" && attempt === 1
                        ? injectForbiddenCardClass(validSource, grammar)
                        : validSource,
                );
            });

            const result = await runParallelReactPagesAgent({
                goal,
                plannerOutput: PLANNER_OUTPUT,
                model: provider,
                workspaceRoot,
                routeRequest: true,
                maxConcurrency: 2,
            });

            const homePage = await readFile(
                path.join(workspaceRoot, "src", "pages", "home.tsx"),
                "utf8",
            );

            expect(result.agent.finished).toBe(true);
            expect(provider.count("home")).toBe(2);
            expect(homePage).not.toContain("page-card");
            expect(
                result.workstreams.find((workstream) => workstream.id === "home"),
            ).toMatchObject({
                status: "succeeded",
                generationAttempts: 2,
            });
        },
    );

    it("retries only the page whose first artifact fails semantic validation", async () => {
        const workspaceRoot = await createWorkspace();
        const provider = new PageModelProvider(({ pageId, attempt }) => {
            if (pageId === "culture" && attempt === 1) {
                return artifactResponse(
                    pageId,
                    'export const pageId = "culture" as const;',
                );
            }
            return artifactResponse(pageId);
        });

        const result = await runParallelReactPagesAgent({
            goal: "创建温州网站，包括首页、文化和行程页面，并且可以跳转",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("home")).toBe(1);
        expect(provider.count("culture")).toBe(2);
        expect(provider.count("itinerary")).toBe(1);
        expect(
            result.workstreams.find((workstream) => workstream.id === "culture"),
        ).toMatchObject({
            status: "succeeded",
            generationAttempts: 2,
        });
    });

    it("retries a page whose artifact has malformed JSX tags before merging", async () => {
        const workspaceRoot = await createWorkspace();
        const provider = new PageModelProvider(({ pageId, attempt }) => {
            if (pageId === "culture" && attempt === 1) {
                return artifactResponse(
                    pageId,
                    pageSource(pageId).replace("</h2>", "</n>"),
                );
            }
            return artifactResponse(pageId);
        });

        const result = await runParallelReactPagesAgent({
            goal: "Build a complete Wenzhou website with pages: home, culture, and itinerary.",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("home")).toBe(1);
        expect(provider.count("culture")).toBe(2);
        expect(provider.count("itinerary")).toBe(1);
        const writtenCulture = await readFile(
            path.join(workspaceRoot, "src", "pages", "culture.tsx"),
            "utf8",
        );
        expect(writtenCulture).not.toContain("</n");
    });

    it("normalizes page-owned route links to the shared hash router", async () => {
        const workspaceRoot = await createWorkspace();
        const linkedHome = pageSource("home").replace(
            '            <section className="page-grid"',
            `            <div className="tag-list">
                <a className="tag" href="/culture">查看文化</a>
                <a className="tag" href="#missing">未知板块</a>
                <a className="tag" href="https://example.com">外部资料</a>
            </div>
            <section className="page-grid"`,
        );
        const provider = new PageModelProvider(({ pageId }) =>
            artifactResponse(
                pageId,
                pageId === "home" ? linkedHome : pageSource(pageId),
            ),
        );

        const result = await runParallelReactPagesAgent({
            goal: "创建温州网站，包括首页、文化和行程页面，并且可以跳转",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
        });

        expect(result.agent.finished).toBe(true);
        const writtenHome = await readFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            "utf8",
        );
        expect(writtenHome).toContain('href="#/culture"');
        expect(writtenHome).not.toContain('href="#missing"');
        expect(writtenHome).toContain('href="https://example.com"');
    });

    it("uses a clearly marked local fallback when one page remains invalid", async () => {
        const workspaceRoot = await createWorkspace();
        const baseline: Record<string, string> = {
            "src/content.ts": "existing content",
            "src/App.css": "existing styles",
            "src/App.tsx": "existing shell",
            "src/pages/home.tsx": "existing home page",
            "src/pages/culture.tsx": "existing culture page",
            "src/pages/itinerary.tsx": "existing itinerary page",
        };
        await Promise.all(
            Object.entries(baseline).map(([filePath, content]) =>
                writeFile(path.join(workspaceRoot, filePath), content, "utf8"),
            ),
        );
        const provider = new PageModelProvider(({ pageId }) =>
            pageId === "culture"
                ? artifactResponse(pageId, "export function CulturePage() { return null; }")
                : artifactResponse(pageId),
        );

        const result = await runParallelReactPagesAgent({
            goal: "创建温州网站，包括首页、文化和行程页面，并且可以跳转",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent).toMatchObject({
            finished: true,
            stopReason: "finish",
        });
        expect(
            result.workstreams.find((workstream) => workstream.id === "culture")
                ?.status,
        ).toBe("fallback");
        expect(
            result.workstreams.find((workstream) => workstream.id === "culture")
                ?.errorMessage,
        ).toContain("该页面的模型输出无效，目前展示的是本地兜底草稿。");
        expect(provider.count("home")).toBe(1);
        expect(provider.count("culture")).toBe(2);
        expect(provider.count("itinerary")).toBe(1);
        expect(
            await readFile(
                path.join(workspaceRoot, "src", "pages", "culture.tsx"),
                "utf8",
            ),
        ).toContain("data-page-id=\"culture\"");
        expect(
            await readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).not.toBe(baseline["src/App.tsx"]);
    });
});

describe("resolveReactPagePlans fallback", () => {
    it("extracts explicit UTF-8 Chinese page names into independent page plans", () => {
        const pages = resolveReactPagePlans({
            goal: "创建温州介绍网站，包含首页、文化和行程页面，并且页面可以跳转",
            plannerOutput: FALLBACK_PLANNER_OUTPUT,
            routeRequest: true,
        });

        expect(pages).toMatchObject([
            {
                id: "home",
                path: "/",
                filePath: "src/pages/home.tsx",
            },
            {
                id: "culture",
                path: "/culture",
                label: "文化",
                filePath: "src/pages/culture.tsx",
            },
            {
                id: "itinerary",
                path: "/itinerary",
                label: "行程",
                filePath: "src/pages/itinerary.tsx",
            },
        ]);
    });

    it("prefers explicit English page lists after a pages colon", () => {
        const pages = resolveReactPagePlans({
            goal: "Build a complete polished Wenzhou introduction website with three URL pages: home, culture, and itinerary. Users must be able to switch pages through real URL navigation.",
            plannerOutput: FALLBACK_PLANNER_OUTPUT,
            routeRequest: true,
        });

        expect(pages).toMatchObject([
            {
                id: "home",
                path: "/",
                label: "home",
                filePath: "src/pages/home.tsx",
            },
            {
                id: "culture",
                path: "/culture",
                label: "culture",
                filePath: "src/pages/culture.tsx",
            },
            {
                id: "itinerary",
                path: "/itinerary",
                label: "itinerary",
                filePath: "src/pages/itinerary.tsx",
            },
        ]);
    });

    it("extracts explicit Chinese page names into independent page plans", () => {
        const pages = resolveReactPagePlans({
            goal: "创建温州网站，包括首页、文化以及行程页面，并且页面可以跳转",
            plannerOutput: FALLBACK_PLANNER_OUTPUT,
            routeRequest: true,
        });

        expect(pages).toMatchObject([
            {
                id: "home",
                path: "/",
                label: "首页",
                componentName: "HomePage",
                filePath: "src/pages/home.tsx",
            },
            {
                id: "culture",
                path: "/culture",
                label: "文化",
                componentName: "CulturePage",
                filePath: "src/pages/culture.tsx",
            },
            {
                id: "itinerary",
                path: "/itinerary",
                label: "行程",
                componentName: "ItineraryPage",
                filePath: "src/pages/itinerary.tsx",
            },
        ]);
    });

    it("uses a minimal two-page fallback for a vague navigation request", () => {
        const pages = resolveReactPagePlans({
            goal: "创建温州介绍网站，让不同页面之间可以跳转",
            plannerOutput: FALLBACK_PLANNER_OUTPUT,
            routeRequest: true,
        });

        expect(pages).toHaveLength(2);
        expect(pages).toMatchObject([
            {
                id: "home",
                path: "/",
                label: "首页",
                filePath: "src/pages/home.tsx",
            },
            {
                id: "overview",
                path: "/overview",
                label: "城市概览",
                filePath: "src/pages/overview.tsx",
            },
        ]);
    });
});

describe("inferSiteIdentityFromGoal", () => {
    it("extracts the real UTF-8 Chinese subject instead of prompt scaffolding", () => {
        expect(
            inferSiteIdentityFromGoal(
                "我想要一个介绍温州的主题网页，并且可以跳转，要求美观",
            ),
        ).toEqual({
            title: "温州导览",
            tagline: "探索温州的重点脉络、亮点与行动路线",
        });
    });

    it("does not fall back to generic generated-site wording for mixed-language subjects", () => {
        expect(inferSiteIdentityFromGoal("做一个 Apex Legends 游戏页面")).toEqual({
            title: "Apex Legends导览",
            tagline: "探索Apex Legends的重点脉络、亮点与行动路线",
        });
    });
});
