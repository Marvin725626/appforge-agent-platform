import {
    ActionExecutor,
    ParallelFileAgent,
    type ImageAssetMode,
    type ImageAssetTool,
    type ModelProvider,
    type ParallelFileArtifact,
    type PlannerOutput,
    type RunCodingAgentLoopResult,
} from "@appforge/agent-core";

import { executeWithWorkspaceRollback } from "./workspace-execution-transaction.js";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_PAGE_TIMEOUT_MS = 240_000;
const MIN_PAGE_TIMEOUT_MS = 100;
const MAX_PAGE_TIMEOUT_MS = 600_000;
const MAX_PAGE_COUNT = 6;

export type ResolvedReactPagePlan = {
    id: string;
    path: string;
    label: string;
    purpose: string;
    acceptanceCriteria: string[];
    componentName: string;
    filePath: string;
};

export type TopicLookupResult = {
    title?: string;
    summary: string;
    url?: string;
    tags?: readonly string[];
};

export interface TopicLookupProvider {
    lookup(
        query: string,
        signal?: AbortSignal,
    ): Promise<TopicLookupResult | undefined>;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;");
}

function visualAssetPath(page: ResolvedReactPagePlan): string {
    return `/assets/${page.id}-visual.svg`;
}

function visualAssetOutputPath(page: ResolvedReactPagePlan): string {
    return `public${visualAssetPath(page)}`;
}

function plannedFormalVisualAssetPath(page: ResolvedReactPagePlan): string {
    return `/assets/${page.id}-hero.jpg`;
}

function plannedFormalVisualAssetOutputPath(page: ResolvedReactPagePlan): string {
    return `public${plannedFormalVisualAssetPath(page)}`;
}

function fallbackBrandLogoPath(): string {
    return "/assets/site-logo.svg";
}

function fallbackBrandLogoOutputPath(): string {
    return `public${fallbackBrandLogoPath()}`;
}

function plannedBrandLogoOutputPath(): string {
    return "public/assets/site-logo.png";
}

function webPathFromPublicAssetPath(outputPath: string): string {
    return outputPath.replace(/^public[\\/]/u, "/").replace(/\\/gu, "/");
}

function pageThemeClass(
    page: ResolvedReactPagePlan,
    pages: readonly ResolvedReactPagePlan[],
): string {
    const index = Math.max(
        0,
        pages.findIndex((candidate) => candidate.id === page.id),
    );
    return `page-theme-${(index % 6) + 1}`;
}

type PageVisualGrammar =
    | "editorial"
    | "immersive-game"
    | "dashboard"
    | "commerce"
    | "product"
    | "portfolio";

function inferPageVisualGrammar(input: {
    goal: string;
    siteTitle: string;
    page: ResolvedReactPagePlan;
    topicEvidence?: string;
}): PageVisualGrammar {
    const text = [
        input.goal,
        input.siteTitle,
        input.page.label,
        input.page.purpose,
        ...input.page.acceptanceCriteria,
        input.topicEvidence ?? "",
    ].join(" ");

    if (
        /\b(?:game|gaming|esports|fps|tactical shooter|hero shooter|shooter|rpg|moba|battle royale|apex|legends|valorant|league of legends|genshin|steam|xbox|playstation|nintendo)\b|游戏|电竞|手游|端游|主机|赛季|英雄|角色|武器|战队|赛事|地图|关卡|竞技|吃鸡|射击|第一人称|战术射击|英雄射击|枪械|枪战|爆破|特工|干员|排位|段位|对局|皮肤|Apex|瓦罗兰特|无畏契约|特战英豪|Valorant|原神|王者|和平精英|英雄联盟/iu.test(
            text,
        )
    ) {
        return "immersive-game";
    }

    if (
        /\b(?:dashboard|admin|analytics|console|crm|erp|kanban|metrics|monitoring|operations|back office|control center)\b|后台|管理端|仪表盘|数据看板|看板|数据大屏|监控|运营台|控制台|分析|指标|报表|CRM|ERP/iu.test(
            text,
        )
    ) {
        return "dashboard";
    }

    if (
        /\b(?:shop|store|commerce|ecommerce|e-commerce|marketplace|product detail|checkout|cart|pricing|buy|retail|catalog)\b|电商|商城|商店|商品|购物|下单|购买|价格|详情页|货架|零售|品牌卖场|购物车/iu.test(
            text,
        )
    ) {
        return "commerce";
    }

    if (
        /\b(?:portfolio|case study|gallery|studio|artist|designer|photographer|creative|agency|showcase)\b|作品集|案例|画廊|摄影|设计师|艺术家|创意|工作室|展览|展示页/iu.test(
            text,
        )
    ) {
        return "portfolio";
    }

    if (
        /\b(?:saas|software|platform|tool|product|startup|app landing|workflow|automation|ai assistant|developer tool)\b|SaaS|软件|平台|工具|产品官网|创业|应用|自动化|工作流|开发者工具|AI助手/iu.test(
            text,
        )
    ) {
        return "product";
    }

    return "editorial";
}

function pageVisualGrammarClass(grammar: PageVisualGrammar): string | undefined {
    switch (grammar) {
        case "immersive-game":
            return "page-genre-game";
        case "dashboard":
            return "page-genre-dashboard";
        case "commerce":
            return "page-genre-commerce";
        case "product":
            return "page-genre-product";
        case "portfolio":
            return "page-genre-portfolio";
        case "editorial":
            return undefined;
    }
}

function siteVisualGrammarClass(grammar: PageVisualGrammar): string {
    switch (grammar) {
        case "immersive-game":
            return "site-genre-game";
        case "dashboard":
            return "site-genre-dashboard";
        case "commerce":
            return "site-genre-commerce";
        case "product":
            return "site-genre-product";
        case "portfolio":
            return "site-genre-portfolio";
        case "editorial":
            return "site-genre-editorial";
    }
}

function formatPageLayoutInstructions(grammar: PageVisualGrammar): string[] {
    switch (grammar) {
        case "immersive-game":
            return [
                "Use immersive game-site visual grammar, not a card-grid template. The root article must include page-genre-game in addition to page-view and the theme class.",
                "Derive the game visual identity from the exact title or franchise. Valorant/无畏契约 should feel tactical, angular, map/HUD-driven, and high-contrast; Apex should feel kinetic, squad/loadout/canyon-arena driven; unknown games should use the user's described mechanics and mood instead of a generic game skin.",
                "After the hero, create one connected game-stage composition instead of a mandatory page-grid. Prefer game-map, game-sites, game-site, site-letter, game-lane, game-loadout, game-agent, game-rounds, game-round, game-strip, and compact hud-pill chips. Use game-panel/game-callout only sparingly.",
                "For tactical point/site labels such as A/B/C, use <div className=\"game-sites\"><span className=\"game-site\"><strong className=\"site-letter\">A</strong><span>...</span></span>...</div> so the points stay horizontal and can sit in one row on wide screens.",
                "Never place raw A / B / C text in a narrow table cell or side column; split each point into its own game-site/site-letter chip. Avoid visible decorative punctuation such as trailing //, ::, or -- in headings and labels; use CSS borders, dividers, icons, or spacing instead.",
                "The page should feel like a game UI or campaign site: cinematic stage, layered panels, HUD-like labels, faction/loadout/mode/status information, sharp contrast, and motion-ready spatial hierarchy.",
                "Keep HUD and label text readable: neon, yellow, white, red, amber, or pastel text must sit on dark opaque surfaces. Do not place pale text directly on pale gradients, light photos, or translucent light panels.",
                "Use explicit Valorant-like game contrast pairs by default: dark #071018 or #16090a surfaces with #f8fbff text; red/amber HUD chips #ff4655 or #f6b35b with #16090a text. Do not default to large cyan/blue HUD blocks unless the subject specifically calls for it.",
                "For data-table/table output, explicitly style th and td: th on #f6b35b with #16090a text, body cells on #071018 with #f8fbff text. For page-kicker/eyebrow labels, use a readable badge pair such as #ffd166 background with #061018 text.",
                "Do not make the result look like the same generic rounded content-card template with game colors. Avoid page-grid/page-card as the dominant structure; prefer full-bleed bands, slanted HUD panels, terminal overlays, split arena layouts, rails, and compact tactical typography.",
                "Game pages may use small HUD modules when useful, but they must feel like game UI components rather than a vertical stack of identical content cards.",
                "Do not merely rename generic cards to panels or modules. Type-specific visual character matters: connected HUD rails, tactical maps, loadout strips, round timelines, stage overlays, angular dividers, and full-bleed arena bands should define the page.",
            ];
        case "dashboard":
            return [
                "Use dashboard/admin visual grammar, not a marketing card grid. The root article must include page-genre-dashboard.",
                "Derive the dashboard visual identity from the user's domain: finance, operations, CRM, logistics, monitoring, education, or creator tools should each get different density, data shapes, terminology, and navigation emphasis.",
                "After the hero, create one dashboard-shell with dashboard-kpis, kpi-tile metrics, dashboard-panel content, chart-frame/chart-bars, activity-feed, or activity-item modules.",
                "The page should feel like an operational console: dense but readable, status-first, data hierarchy, filter-ready panels, and clear action/state areas.",
                "Avoid page-grid/page-card as the dominant structure. Dashboard pages must use operational shell, KPI, chart, table, feed, and panel structures instead of the generic marketing-card template.",
                "Dashboard cards/tiles are allowed for KPIs when useful, but the overall interface should be an app shell with table rows, charts, filter bars, split panes, and status rails.",
            ];
        case "commerce":
            return [
                "Use commerce/product-detail visual grammar, not a generic content grid. The root article must include page-genre-commerce.",
                "Derive the commerce visual identity from the product category, buyer intent, and price/trust signals instead of using one universal shop template.",
                "After the hero, create one commerce-stage with product-showcase, buy-panel, price-strip, spec-list, commerce-panel, or product-tile modules.",
                "The page should feel shoppable: product focus, price/spec/benefit hierarchy, purchase decision panel, trust details, and tactile product presentation.",
                "Avoid page-grid/page-card as the dominant structure. Commerce pages must look like product decision surfaces with showcases, buying panels, specs, price strips, and product tiles.",
                "Product cards/tiles are allowed when they support shopping, but the page should be led by a product stage, purchase rail, spec rows, price band, comparison strip, and trust stack.",
            ];
        case "product":
            return [
                "Use SaaS/product visual grammar, not a generic content grid. The root article must include page-genre-product.",
                "Derive the product visual identity from the software workflow, audience, and product metaphor so the shell, screen mockups, and feature rhythm do not repeat across unrelated products.",
                "After the hero, create one product-stage with product-screen, product-panel, feature-strip, feature-chip, proof-row, or proof-pill modules.",
                "The page should feel like a product landing page: product screenshot or workflow surface, benefit hierarchy, proof points, feature flow, and conversion-oriented CTAs.",
                "Avoid page-grid/page-card as the dominant structure. Product/SaaS pages must use workflow surfaces, product screens, feature strips, proof rows, and conversion sections.",
                "Feature cards are allowed sparingly, but the dominant visual should be software screens, workflow lanes, proof rows, feature bands, and conversion surfaces.",
            ];
        case "portfolio":
            return [
                "Use portfolio/creative visual grammar, not a generic content grid. The root article must include page-genre-portfolio.",
                "Derive the portfolio visual identity from the creator's medium and tone: photography, architecture, illustration, product design, music, and agency work should not share the same gallery template.",
                "After the hero, create one portfolio-wall with project-tile, profile-panel, showcase-strip, or visual case-study modules.",
                "The page should feel curated and expressive: uneven rhythm, work samples, creative profile, project outcomes, and a gallery-like reading path.",
                "Avoid page-grid/page-card as the dominant structure. Portfolio pages must use project walls, profile panels, showcase strips, and case-study rhythm instead of a uniform card grid.",
                "Project tiles are allowed when they create gallery rhythm, but the page should feel curated through oversized case-study spreads, overlapping media, caption rails, and varied scale.",
            ];
        case "editorial":
            return [
                "Derive the editorial visual identity from the specific place, institution, or culture. A city guide should use local geography, heritage, route, and texture cues; an official/institution page should use its own authority, campus, or brand cues. Do not make every editorial page the same card-based travel template.",
                "After the hero, create one editorial-flow with at least three substantive sections. Use a mix of story-band, route-timeline, route-stop, map-panel, culture-strip, media-panel, quote, feature-list, timeline-item, or callout. Avoid page-grid/page-card as the primary structure.",
                "Use the large image only in the hero. If a later section needs supporting media, keep it short and secondary inside media-panel; never let an image dominate a text block or create tall empty columns.",
                "Design like a finished editorial website, not a demo: strong topic-specific headline, generous whitespace, asymmetric magazine rhythm, concrete local details, and no generic labels such as 主题网站, Generated Site, Feature 1, Feature 2, or placeholder copy. Do not make every section a same-looking card grid.",
            ];
    }
}

function formatSubjectDesignBrief(input: {
    goal: string;
    siteTitle: string;
    page: ResolvedReactPagePlan;
    visualGrammar: PageVisualGrammar;
    topicEvidence?: string;
}): string {
    const text = [
        input.goal,
        input.siteTitle,
        input.page.label,
        input.page.purpose,
        input.topicEvidence ?? "",
    ].join(" ");
    const shared =
        "Hard design rule: do not reuse the same block/card template. The page must have a subject-specific silhouette, section rhythm, navigation tone, and visual metaphor.";

    if (input.visualGrammar === "immersive-game") {
        return [
            shared,
            "Game blueprint: build a campaign/HUD surface with angular stage, map or arena field, compact status chips, loadout/round strips, tactical rows, and dark cinematic contrast. Cards may appear only as small HUD modules, never as the main page structure.",
            "When a known game has an official site or the user provides a URL, use that official site as the visual reference. For Valorant/无畏契约, reference https://val.qq.com/main.html and official VALORANT campaign-site language: red/black/charcoal palette, sharp diagonal cuts, large hero media, download/news/version/esports/map/agent modules, tactical typography, and no blue dominant background.",
            "Valorant/无畏契约 specifically should feel like tactical map planning: A/B/C sites as horizontal chips, terminal/HUD labels, sharp dividers, compact copy, no oversized rounded cards.",
        ].join(" ");
    }

    if (/大学|学院|学校|校园|招生|本科|专业|清华|北大|复旦|university|college|campus|admission|faculty|major/iu.test(text)) {
        return [
            shared,
            "University/institution blueprint: make it feel like a modern admissions/campus publication, not a travel-card page. Use a formal masthead, campus timeline, department/discipline bands, research/admissions proof rows, academic navigation, and restrained typography.",
            "Avoid generic scenic cards. Use editorial authority, campus map/route surfaces, program rows, history bands, and clear official-site hierarchy.",
        ].join(" ");
    }

    if (/城市|温州|旅游|景点|文化|非遗|路线|街区|江心屿|雁荡山|楠溪江|city|travel|tour|culture|heritage|route|guide/iu.test(text)) {
        return [
            shared,
            "City/culture blueprint: make it feel like an editorial city guide with local texture, route map, river/mountain/street rhythm, timeline stops, culture ribbons, and magazine-style asymmetry.",
            "Avoid uniform destination cards. Use map panels, itinerary lines, wide story bands, small captions, and local details arranged like a guidebook.",
        ].join(" ");
    }

    if (input.visualGrammar === "dashboard") {
        return [
            shared,
            "Dashboard blueprint: app shell, status bars, filters, KPI row, charts, table/list density, and operational panels. It should look like software, not a marketing landing page.",
        ].join(" ");
    }

    if (input.visualGrammar === "commerce") {
        return [
            shared,
            "Commerce blueprint: product stage, buy panel, spec rows, trust band, price/action hierarchy, and comparison surfaces. Product tiles are allowed only when they support shopping decisions.",
        ].join(" ");
    }

    if (input.visualGrammar === "product") {
        return [
            shared,
            "Product/SaaS blueprint: workflow screen, feature strip, proof row, integration/process lanes, conversion section, and clean product typography. Avoid generic feature-card grids.",
        ].join(" ");
    }

    if (input.visualGrammar === "portfolio") {
        return [
            shared,
            "Portfolio blueprint: project wall, case-study spread, uneven gallery rhythm, creator profile, and caption rails. Avoid equal-size card grids.",
        ].join(" ");
    }

    return [
        shared,
        "Editorial blueprint: magazine layout with a strong masthead, story band, route/timeline surface, quote or data strip, and asymmetric supporting media. Avoid a repeated rounded-card grid.",
    ].join(" ");
}

function formatTopicLookupEvidence(
    result: TopicLookupResult | undefined,
): string | undefined {
    if (!result) {
        return undefined;
    }

    return [
        result.title ? `Title: ${result.title}` : "",
        `Summary: ${result.summary}`,
        result.tags && result.tags.length > 0
            ? `Tags: ${result.tags.join(", ")}`
            : "",
        result.url ? `URL: ${result.url}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function shouldLookupTopicForVisualGrammar(input: {
    goal: string;
    siteTitle: string;
    pages: readonly ResolvedReactPagePlan[];
}): boolean {
    if (!/\b(?:site|website|homepage|landing|interface|page|official)\b|官网|官方网站|网站|网页|首页|主页|界面|页面|专题页/iu.test(input.goal)) {
        return false;
    }

    return input.pages.every(
        (page) =>
            inferPageVisualGrammar({
                goal: input.goal,
                siteTitle: input.siteTitle,
                page,
            }) === "editorial",
    );
}

async function lookupTopicEvidenceForVisualGrammar(input: {
    provider: TopicLookupProvider | undefined;
    goal: string;
    siteTitle: string;
    pages: readonly ResolvedReactPagePlan[];
    signal?: AbortSignal;
}): Promise<string | undefined> {
    if (!input.provider) {
        return undefined;
    }

    if (
        !shouldLookupTopicForVisualGrammar({
            goal: input.goal,
            siteTitle: input.siteTitle,
            pages: input.pages,
        })
    ) {
        return undefined;
    }

    input.signal?.throwIfAborted();

    try {
        const result = await input.provider.lookup(
            `${input.siteTitle} ${input.goal}`.trim(),
            input.signal,
        );
        return formatTopicLookupEvidence(result);
    } catch {
        return undefined;
    }
}

export type PageCodingWorkstreamStatus = {
    id: string;
    role: "page";
    path: string;
    routePath: string;
    label: string;
    status: "pending" | "running" | "succeeded" | "fallback" | "failed";
    generationAttempts: number;
    summary: string;
    errorMessage?: string;
};

export type ParallelCodingWorkstreamResult = PageCodingWorkstreamStatus;

export type RunParallelReactPagesAgentOptions = {
    goal: string;
    plannerOutput: PlannerOutput;
    model: ModelProvider;
    workspaceRoot: string;
    routeRequest: boolean;
    maxConcurrency?: number;
    workstreamTimeoutMs?: number;
    imageAssetTool?: ImageAssetTool;
    imageAssetModes?: ImageAssetMode[];
    topicLookupProvider?: TopicLookupProvider;
    signal?: AbortSignal;
};

export type RunParallelReactPagesAgentResult = {
    agent: RunCodingAgentLoopResult;
    workstreams: PageCodingWorkstreamStatus[];
};

class PageWorkstreamTimeoutError extends Error {
    constructor(pageId: string, timeoutMs: number) {
        super(
            `${pageId} page exhausted its ${timeoutMs}ms total generation deadline`,
        );
        this.name = "PageWorkstreamTimeoutError";
    }
}

function clampInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 1_000
        ? `${message.slice(0, 1_000)}...`
        : message;
}

function selectFormalImageMode(
    modes: readonly ImageAssetMode[] | undefined,
): ImageAssetMode | undefined {
    if (modes?.includes("generate")) {
        return "generate";
    }
    if (modes?.includes("search")) {
        return "search";
    }
    return undefined;
}

function formatFormalImageQuery(input: {
    goal: string;
    siteTitle: string;
    page: ResolvedReactPagePlan;
}): string {
    return [
        input.siteTitle,
        input.page.label,
        input.page.purpose,
        input.goal,
        "premium editorial website hero image, polished professional photography, cinematic composition, no text, no title, no caption, no Chinese characters, no letters, no logo, no watermark",
    ].join(" | ");
}

function formatBrandLogoSearchQuery(input: {
    goal: string;
    siteTitle: string;
}): string {
    const text = `${input.siteTitle} ${input.goal}`;
    const brandSeed = /valorant|瓦罗兰特|无畏契约|特战英豪/iu.test(text)
        ? "Valorant official logo Riot Games svg png"
        : /apex|apex legends|Apex Legends/iu.test(text)
          ? "Apex Legends official logo EA Respawn svg png"
          : /清华|tsinghua/iu.test(text)
            ? "Tsinghua University official logo svg png"
            : /北京大学|北大|peking university/iu.test(text)
              ? "Peking University official logo svg png"
              : /温州|wenzhou/iu.test(text)
                ? "Wenzhou city official emblem logo svg png"
                : input.siteTitle;

    return [
        brandSeed,
        input.goal,
        "official logo transparent brand mark svg png",
        "prefer official source or trusted brand asset, no watermark",
    ].join(" | ");
}

function parseSavedImagePath(message: string): string | undefined {
    return /^Saved image:\s*(.+)$/imu.exec(message)?.[1]?.trim();
}

function isAbortError(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "ABORT_ERR")
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function toComponentName(id: string): string {
    return `${id
        .split("-")
        .filter((part) => part.length > 0)
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join("")}Page`;
}

function isChineseText(value: string): boolean {
    return /\p{Script=Han}/u.test(value);
}

function normalizeLabel(value: string): string {
    value = value.replace(/(?:页面|界面|网页)$/iu, "");

    return value
        .trim()
        .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/gu, "")
        .replace(/(?:页面|界面|网页|page)$/iu, "")
        .trim();
}

function extractRequestedPageLabels(goal: string): string[] {
    const utf8ChineseMatch =
        /(?:包含|包括|设有|分为|需要)\s*([^。；\n]{1,120}?)(?:页面|网页|页(?=[，。；\s]|$))/u.exec(
            goal,
        );
    const chineseMatch =
        /(?:包含|包括|设有|分为|需要)([^。；\n]{1,100}?)(?:页面|网页|页)(?=[，。；\s]|$)/u.exec(
            goal,
        );
    const englishListAfterColonMatch =
        /\b(?:pages?|routes?|views?)\s*:\s*([^.;\n]{1,160})/iu.exec(goal);
    const englishPagesBeforeKeywordMatch =
        /(?:include|includes|including|with|containing)\s+([^.;\n]{1,120}?)\s+(?:pages?|routes?|views?)\b/iu.exec(
            goal,
        );
    const rawList =
        utf8ChineseMatch?.[1] ??
        chineseMatch?.[1] ??
        englishListAfterColonMatch?.[1] ??
        englishPagesBeforeKeywordMatch?.[1] ??
        "";

    if (!rawList) {
        return [];
    }

    const normalizedRawList = rawList.replace(
        /(?:、|，|以及|还有|和|与)/gu,
        ",",
    );
    const labels = normalizedRawList
        .split(/(?:、|，|,|以及|及|和|与|\s+(?:and|&)\s+)/iu)
        .map(normalizeLabel)
        .map((label) => (/^(?:首页|主页)$/iu.test(label) ? "home" : label))
        .filter(
            (label) =>
                label.length > 0 &&
                label.length <= 32 &&
                !/^(?:多个|若干|不同|独立|真实)$/iu.test(label) &&
                !/^(?:多个|若干|不同|独立|真实|several|multiple|different)$/iu.test(
                    label,
                ),
        );

    return [...new Set(labels)];
}

function inferSecondaryLabel(goal: string): string {
    if (!isChineseText(goal)) {
        return /dashboard|portal/iu.test(goal) ? "Details" : "Overview";
    }
    if (/温州|旅游|城市/iu.test(goal)) {
        return "城市概览";
    }
    if (/大学|学校|清华|北大/iu.test(goal)) {
        return "学校概览";
    }
    if (/apex|游戏/iu.test(goal)) {
        return "游戏模式";
    }
    if (/温州|旅游|城市/iu.test(goal)) {
        return "城市概览";
    }
    if (/大学|学校|清华|北大/iu.test(goal)) {
        return "学校概览";
    }
    if (/apex|游戏/iu.test(goal)) {
        return "游戏模式";
    }
    return "详情";
}

function fallbackIdAndPath(
    label: string,
    index: number,
): { id: string; path: string } {
    const normalized = label.toLowerCase().replaceAll(" ", "-");
    const mappings: Array<[RegExp, string]> = [
        [/^(?:首页|主页|home)$/iu, "home"],
        [/文化/iu, "culture"],
        [/行程|路线/iu, "itinerary"],
        [/概览/iu, "overview"],
        [/关于/iu, "about"],
        [/联系/iu, "contact"],
        [/新闻/iu, "news"],
        [/招生/iu, "admissions"],
        [/科研/iu, "research"],
        [/校园/iu, "campus"],
        [/模式/iu, "modes"],
        [/地点|景点/iu, "places"],
        [/美食/iu, "food"],
        [/^(?:首页|主页|home)$/iu, "home"],
        [/文化|culture/iu, "culture"],
        [/行程|路线|journey|itinerary/iu, "itinerary"],
        [/概览|overview/iu, "overview"],
        [/关于|about/iu, "about"],
        [/联系|contact/iu, "contact"],
        [/新闻|news/iu, "news"],
        [/招生|admission/iu, "admissions"],
        [/科研|research/iu, "research"],
        [/校园|campus/iu, "campus"],
        [/模式|mode/iu, "modes"],
        [/地点|景点|place/iu, "places"],
        [/美食|food/iu, "food"],
    ];
    const mapped = mappings.find(([pattern]) => pattern.test(label))?.[1];
    const ascii = normalized
        .replace(/[^a-z0-9-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 32);
    const id =
        index === 0 ? "home" : (mapped ?? (ascii || `page-${index + 1}`));

    return {
        id,
        path: index === 0 ? "/" : `/${id}`,
    };
}

function createFallbackPagePlans(
    goal: string,
    routeRequest: boolean,
): ResolvedReactPagePlan[] {
    const homeLabel = isChineseText(goal) ? "首页" : "Home";
    let labels = routeRequest ? extractRequestedPageLabels(goal) : [];

    if (!routeRequest) {
        labels = [homeLabel];
    } else {
        const hasHome = labels.some((label) =>
            /^(?:首页|主页|home)$/iu.test(label),
        );
        if (!hasHome) {
            labels.unshift(homeLabel);
        } else {
            labels = [
                ...labels.filter((label) =>
                    /^(?:首页|主页|home)$/iu.test(label),
                ),
                ...labels.filter(
                    (label) => !/^(?:首页|主页|home)$/iu.test(label),
                ),
            ];
        }
        if (labels.length < 2) {
            labels.push(inferSecondaryLabel(goal));
        }
    }

    return labels.slice(0, MAX_PAGE_COUNT).map((label, index) => {
        const { id, path } = fallbackIdAndPath(label, index);
        const displayLabel = id === "home" && isChineseText(goal) ? "首页" : label;
        return {
            id,
            path,
            label: displayLabel,
            purpose: `Create the complete, subject-specific ${displayLabel} webpage for the product goal.`,
            acceptanceCriteria: [
                `${displayLabel} has unique substantive content`,
                `${displayLabel} is responsive and accessible`,
            ],
            componentName: toComponentName(id),
            filePath: `src/pages/${id}.tsx`,
        };
    });
}

export function resolveReactPagePlans(input: {
    goal: string;
    plannerOutput: PlannerOutput;
    routeRequest: boolean;
}): ResolvedReactPagePlan[] {
    const plannedPages = input.plannerOutput.pages ?? [];
    const usablePlannedPages = plannedPages
        .filter(
            (page, index, pages) =>
                pages.findIndex(
                    (candidate) =>
                        candidate.id === page.id ||
                        candidate.path === page.path,
                ) === index,
        )
        .slice(0, MAX_PAGE_COUNT);

    if (
        usablePlannedPages.length > 0 &&
        (!input.routeRequest || usablePlannedPages.length >= 2) &&
        usablePlannedPages[0]?.path === "/"
    ) {
        const selectedPages = input.routeRequest
            ? usablePlannedPages
            : usablePlannedPages.slice(0, 1);
        return selectedPages.map((page) => ({
            ...page,
            componentName: toComponentName(page.id),
            filePath: `src/pages/${page.id}.tsx`,
        }));
    }

    return createFallbackPagePlans(input.goal, input.routeRequest);
}

function cleanInferredSubject(subject: string): string {
    return subject
        .trim()
        .replace(/^(?:一个|一款|一套|关于|介绍|展示|做|创建|生成|设计|制作|搭建)+/iu, "")
        .replace(/(?:的|主题|网页|网站|页面|界面|主页|首页|官网|官方网站|导览|介绍)+$/iu, "")
        .trim();
}

export function inferSiteIdentityFromGoal(goal: string): { title: string; tagline: string } | undefined {
    const normalizedGoal = goal.replace(/[，,。.!！？?；;]/gu, " ");
    const chineseSubject = [
        /(?:介绍|展示|关于)\s*(?:一个|一款|一套|个)?\s*([\p{Script=Han}A-Za-z0-9·]{2,12})(?:的)?(?:主题)?(?:网页|网站|页面|界面|主页|首页|官网|官方网站|导览|介绍)/iu,
        /(?:做|创建|生成|设计|制作|搭建|要|想要|需要)\s*(?:一个|一款|一套|个)?\s*([\p{Script=Han}A-Za-z0-9·]{2,12})(?:的)?(?:主题)?(?:网页|网站|页面|界面|主页|首页|官网|官方网站|导览|介绍)/iu,
        /(?:做|创建|生成|设计|制作|搭建|要|想要|需要)\s*(?:一个|一款|一套|个)?\s*([A-Za-z][A-Za-z0-9&' -]{2,40})\s*(?:游戏|品牌|产品|主题)?(?:网页|网站|页面|界面|主页|首页|官网|官方网站|导览|介绍)/iu,
        /([\p{Script=Han}A-Za-z0-9·]{2,12})(?:主题|城市|旅游|文化|品牌|产品|游戏|大学|学校|官网|官方网站)/iu,
    ]
        .map((pattern) => pattern.exec(normalizedGoal)?.[1])
        .filter((subject): subject is string => Boolean(subject))
        .map(cleanInferredSubject)
        .find((subject) => subject.length >= 2);

    if (chineseSubject && isChineseText(goal)) {
        return {
            title: `${chineseSubject}导览`,
            tagline: `探索${chineseSubject}的重点脉络、亮点与行动路线`,
        };
    }

    const englishSubject =
        /\b(?:about|for|introducing|showcase)\s+([A-Z][A-Za-z0-9&' -]{2,40})/u.exec(
            goal,
        )?.[1] ??
        /\b([A-Z][A-Za-z0-9&' -]{2,40})\s+(?:website|site|homepage|landing page|guide|portal)\b/u.exec(
            goal,
        )?.[1];

    if (englishSubject) {
        const subject = englishSubject.trim();
        return {
            title: `${subject} Guide`,
            tagline: `Explore the essential story, highlights, and next steps for ${subject}`,
        };
    }

    return undefined;
}

function resolveSiteIdentity(
    goal: string,
    plannerOutput: PlannerOutput,
): { title: string; tagline: string } {
    if (plannerOutput.site) {
        return plannerOutput.site;
    }

    const inferredSiteIdentity = inferSiteIdentityFromGoal(goal);
    if (inferredSiteIdentity) {
        return inferredSiteIdentity;
    }

    return isChineseText(goal)
        ? {
              title: "城市导览",
              tagline: "以清晰页面组织重点脉络、亮点与行动路线",
          }
        : {
              title: "Experience Guide",
              tagline: "Explore the essential story, highlights, and next steps",
          };

}

function formatContentModule(
    goal: string,
    plannerOutput: PlannerOutput,
    pages: readonly ResolvedReactPagePlan[],
    logoPath = fallbackBrandLogoPath(),
): string {
    const site = resolveSiteIdentity(goal, plannerOutput);
    return [
        "export const siteContent = {",
        `    brand: ${JSON.stringify(site.title)},`,
        `    tagline: ${JSON.stringify(site.tagline)},`,
        `    logo: ${JSON.stringify(logoPath)},`,
        "    routes: [",
        ...pages.map(
            (page) =>
                `        { id: ${JSON.stringify(page.id)}, path: ${JSON.stringify(page.path)}, label: ${JSON.stringify(page.label)} },`,
        ),
        "    ],",
        `    footer: ${JSON.stringify(`${site.title} · ${site.tagline}`)},`,
        "} as const;",
        "",
        "export type SiteRoute = (typeof siteContent.routes)[number];",
        "",
    ].join("\n");
}

function formatVisualAssetSvg(input: {
    goal: string;
    siteTitle: string;
    page: ResolvedReactPagePlan;
    index: number;
}): string {
    const palettes = [
        ["#0b2146", "#155eef", "#78d5ff", "#f8c66b"],
        ["#18392b", "#2f8f5b", "#a8e6c2", "#ffd166"],
        ["#41255f", "#7c3aed", "#f0abfc", "#60a5fa"],
        ["#3b1f1f", "#d97706", "#fed7aa", "#38bdf8"],
        ["#082f49", "#0891b2", "#bae6fd", "#f97316"],
        ["#1f2937", "#4f46e5", "#c7d2fe", "#22c55e"],
    ];
    const [ink, accent, glow, warm] = palettes[input.index % palettes.length]!;
    const title = escapeXml(input.siteTitle);
    const label = escapeXml(input.page.label);
    const purpose = escapeXml(input.page.purpose);
    const number = String(input.index + 1).padStart(2, "0");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-labelledby="title desc">
  <title id="title">${title} · ${label}</title>
  <desc id="desc">${purpose}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ink}"/>
      <stop offset="0.58" stop-color="${accent}"/>
      <stop offset="1" stop-color="${glow}"/>
    </linearGradient>
    <radialGradient id="sun" cx="76%" cy="24%" r="42%">
      <stop offset="0" stop-color="${warm}" stop-opacity="0.95"/>
      <stop offset="1" stop-color="${warm}" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#071120" flood-opacity="0.24"/>
    </filter>
  </defs>
  <rect width="1200" height="760" rx="64" fill="url(#bg)"/>
  <rect width="1200" height="760" rx="64" fill="url(#sun)"/>
  <path d="M0 560 C160 470 280 610 430 520 C590 424 690 438 820 522 C960 612 1080 548 1200 462 L1200 760 L0 760 Z" fill="#ffffff" opacity="0.16"/>
  <path d="M0 620 C170 520 294 668 460 580 C620 494 720 520 870 602 C1030 690 1110 620 1200 548 L1200 760 L0 760 Z" fill="#ffffff" opacity="0.22"/>
  <g filter="url(#softShadow)">
    <rect x="88" y="86" width="520" height="376" rx="42" fill="#fff" opacity="0.94"/>
    <rect x="130" y="132" width="124" height="38" rx="19" fill="${accent}" opacity="0.14"/>
    <text x="146" y="158" font-family="Inter, Noto Sans SC, Arial, sans-serif" font-size="20" font-weight="800" fill="${accent}">${number} / ${label}</text>
    <text x="130" y="242" font-family="Inter, Noto Sans SC, Arial, sans-serif" font-size="62" font-weight="900" fill="${ink}" letter-spacing="-2">${title}</text>
    <text x="130" y="314" font-family="Inter, Noto Sans SC, Arial, sans-serif" font-size="38" font-weight="800" fill="${accent}">${label}</text>
    <path d="M130 370 H462" stroke="${accent}" stroke-width="10" stroke-linecap="round" opacity="0.28"/>
    <path d="M130 404 H520" stroke="${ink}" stroke-width="10" stroke-linecap="round" opacity="0.12"/>
  </g>
  <g fill="none" stroke="#fff" stroke-opacity="0.52" stroke-width="3">
    <circle cx="900" cy="212" r="112"/>
    <circle cx="996" cy="318" r="168"/>
    <path d="M760 140 L1054 610"/>
    <path d="M720 310 L1110 370"/>
  </g>
  <g transform="translate(714 470)">
    <rect width="336" height="120" rx="34" fill="#fff" opacity="0.18"/>
    <circle cx="72" cy="60" r="30" fill="${warm}"/>
    <rect x="128" y="36" width="150" height="18" rx="9" fill="#fff" opacity="0.72"/>
    <rect x="128" y="68" width="92" height="14" rx="7" fill="#fff" opacity="0.42"/>
  </g>
</svg>
`;
}

function formatBrandLogoSvg(input: {
    siteTitle: string;
    tagline: string;
}): string {
    const title = escapeXml(input.siteTitle);
    const tagline = escapeXml(input.tagline);
    const initials = escapeXml(
        [...input.siteTitle.replace(/\s+/gu, "")]
            .slice(0, 2)
            .join("") || "A",
    );

    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${tagline}</desc>
  <defs>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe3a3"/>
      <stop offset="0.58" stop-color="#e5b566"/>
      <stop offset="1" stop-color="#9a6324"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#16130f" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="256" height="256" rx="72" fill="#16130f"/>
  <path d="M128 34 L210 128 L128 222 L46 128 Z" fill="url(#mark)" filter="url(#shadow)"/>
  <circle cx="128" cy="128" r="54" fill="#16130f" opacity="0.92"/>
  <text x="128" y="141" text-anchor="middle" font-family="Inter, Noto Sans SC, Arial, sans-serif" font-size="44" font-weight="900" fill="#ffe3a3">${initials}</text>
</svg>
`;
}

function formatAppModule(
    pages: readonly ResolvedReactPagePlan[],
    visualGrammar: PageVisualGrammar = "editorial",
): string {
    const imports = pages
        .map(
            (page) =>
                `import { ${page.componentName} } from "./pages/${page.id}.js";`,
        )
        .join("\n");
    const routeEntries = pages
        .map(
            (page) =>
                `    { id: ${JSON.stringify(page.id)}, path: ${JSON.stringify(page.path)}, label: ${JSON.stringify(page.label)}, Component: ${page.componentName} },`,
        )
        .join("\n");

    const shellClass = `app-shell ${siteVisualGrammarClass(visualGrammar)}`;

    return `import React, { useEffect, useState } from "react";
import { siteContent } from "./content.js";
${imports}
import "./App.css";

const routes = [
${routeEntries}
] as const;

function readRoutePath(): string {
    const value = window.location.hash.replace(/^#/, "");
    return value.startsWith("/") ? value : "/";
}

export function App() {
    const [routePath, setRoutePath] = useState<string>(readRoutePath);

    useEffect(() => {
        if (!window.location.hash) {
            window.history.replaceState(null, "", "#/");
        }
        const handleHashChange = () => setRoutePath(readRoutePath());
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    const route = routes.find((item) => item.path === routePath) ?? routes[0]!;
    const ActivePage = route.Component;

    return (
        <div className=${JSON.stringify(shellClass)}>
            <header className="site-header">
                <a className="brand-link" href="#/" aria-label={siteContent.tagline}>
                    <span className="brand-mark" aria-hidden="true">
                        <img className="brand-logo" src={siteContent.logo} alt="" />
                    </span>
                    <span><strong>{siteContent.brand}</strong><small>{siteContent.tagline}</small></span>
                </a>
                <nav className="site-nav" aria-label="Primary navigation">
                    {routes.map((item) => (
                        <a
                            key={item.id}
                            className={item.path === route.path ? "nav-link nav-link--active" : "nav-link"}
                            href={"#" + item.path}
                            aria-current={item.path === route.path ? "page" : undefined}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </header>
            <main className="route-main" id="main-content">
                <ActivePage />
            </main>
            <footer className="site-footer">{siteContent.footer}</footer>
        </div>
    );
}
`;
}

function formatSharedStyles(): string {
    return `:root {
    /* Primitive tokens */
    --color-ink-900: #191713;
    --color-ink-600: #6d6256;
    --color-paper-50: #f7f1e8;
    --color-surface-0: rgba(255, 252, 246, .94);
    --color-night-950: #16130f;
    --color-accent-500: #b67a2c;
    --color-accent-700: #7a4b1b;
    --color-accent-100: #f1dfbf;
    --color-warm-400: #e5b566;
    /* Semantic tokens */
    --background: var(--color-paper-50);
    --foreground: var(--color-ink-900);
    --muted-foreground: var(--color-ink-600);
    --surface-raised: var(--color-surface-0);
    --primary: var(--color-accent-500);
    --primary-strong: var(--color-accent-700);
    --primary-soft: var(--color-accent-100);
    --focus-ring: var(--color-warm-400);
    --border-subtle: rgba(74, 54, 34, 0.16);
    /* Component tokens */
    --control-height: 2.75rem;
    --section-gap: clamp(1.25rem, 3vw, 2rem);
    --page-gutter: clamp(1rem, 4vw, 4.5rem);
    --media-max-height: 28rem;
    --radius-component: 1.4rem;
    --shadow-raised: 0 24px 70px rgba(47, 32, 19, 0.14);
    --shadow-glow: 0 38px 95px rgba(122, 75, 27, 0.2);
    /* Backward-compatible aliases for generated page classes */
    --ink: var(--foreground);
    --muted: var(--muted-foreground);
    --paper: var(--background);
    --surface: var(--surface-raised);
    --night: var(--color-night-950);
    --accent: var(--primary);
    --accent-strong: var(--primary-strong);
    --accent-soft: var(--primary-soft);
    --warm: var(--focus-ring);
    --line: var(--border-subtle);
    --shadow: var(--shadow-raised);
    --glow: var(--shadow-glow);
    --radius: var(--radius-component);
    font-family: Inter, "Noto Serif SC", "Noto Sans SC", system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: var(--paper);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; overflow-x: hidden; background: radial-gradient(circle at top left, rgba(182, 122, 44, .2), transparent 32rem), linear-gradient(135deg, rgba(255,255,255,.72), rgba(247,241,232,.92)), var(--paper); }
a { color: inherit; }
.app-shell { min-height: 100vh; display: flex; flex-direction: column; }
.site-header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; padding: 0.9rem clamp(1rem, 4vw, 4.5rem); color: #fff7ea; background: rgba(22, 19, 15, 0.92); border-bottom: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(18px); box-shadow: 0 18px 45px rgba(22, 19, 15, .18); }
.brand-link { min-height: 48px; display: inline-flex; align-items: center; gap: 0.75rem; text-decoration: none; }
.brand-link > span:last-child { display: grid; gap: 0.1rem; }
.brand-link strong { font-size: 1.05rem; letter-spacing: 0.04em; }
.brand-link small { max-width: 34rem; color: #d9c6a8; }
.brand-mark { width: 2.6rem; height: 2.6rem; display: grid; place-items: center; overflow: hidden; color: var(--night); background: linear-gradient(135deg, #ffe3a3, var(--warm)); border-radius: .9rem; box-shadow: 0 12px 32px rgba(229, 181, 102, .28); }
.brand-logo { width: 100%; height: 100%; display: block; object-fit: contain; padding: .22rem; }
.site-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.4rem; }
.nav-link { min-height: 44px; display: inline-flex; align-items: center; padding: 0.65rem 0.95rem; color: #e6d8c2; border-radius: 999px; text-decoration: none; font-weight: 800; }
.nav-link:hover { color: #fff; background: rgba(255,255,255,.12); }
.nav-link--active { color: var(--night); background: var(--warm); }
.site-genre-game .site-header { background: linear-gradient(90deg, rgba(7,9,16,.98), rgba(22,18,24,.96)); border-bottom: 2px solid #ff4655; box-shadow: 0 18px 60px rgba(255,70,85,.16); }
.site-genre-game .brand-mark { border-radius: .22rem; background: #ff4655; box-shadow: none; clip-path: polygon(.35rem 0, 100% 0, calc(100% - .35rem) 100%, 0 100%); }
.site-genre-game .brand-link strong { color: #fff; text-transform: uppercase; letter-spacing: .08em; }
.site-genre-game .brand-link small { color: rgba(238,248,255,.72); }
.site-genre-game .nav-link { border-radius: .2rem; color: rgba(238,248,255,.82); text-transform: uppercase; letter-spacing: .06em; }
.site-genre-game .nav-link--active { color: #fff; background: #ff4655; clip-path: polygon(.35rem 0, 100% 0, calc(100% - .35rem) 100%, 0 100%); }
.site-genre-dashboard .site-header { color: #dbeafe; background: #07111f; border-bottom-color: rgba(56,189,248,.28); box-shadow: none; }
.site-genre-dashboard .brand-mark { border-radius: .35rem; background: #38bdf8; box-shadow: none; }
.site-genre-dashboard .nav-link { border-radius: .35rem; color: #bfdbfe; }
.site-genre-dashboard .nav-link--active { color: #07111f; background: #38bdf8; }
.site-genre-commerce .site-header { color: #431407; background: linear-gradient(90deg, #fff7ed, #fed7aa); border-bottom-color: rgba(124,45,18,.18); box-shadow: 0 12px 36px rgba(124,45,18,.08); }
.site-genre-commerce .brand-link small, .site-genre-commerce .nav-link { color: #7c2d12; }
.site-genre-commerce .brand-mark { border-radius: .35rem; background: #fb923c; box-shadow: none; }
.site-genre-commerce .nav-link--active { color: #fff7ed; background: #7c2d12; }
.site-genre-product .site-header { color: #ede9fe; background: linear-gradient(90deg, #2e1065, #4c1d95); border-bottom-color: rgba(196,181,253,.26); }
.site-genre-product .brand-mark { border-radius: .35rem; background: #c4b5fd; box-shadow: none; }
.site-genre-product .nav-link { border-radius: .45rem; color: #ddd6fe; }
.site-genre-product .nav-link--active { color: #2e1065; background: #c4b5fd; }
.site-genre-portfolio .site-header { color: #fdf2f8; background: linear-gradient(90deg, #3b1028, #831843); border-bottom-color: rgba(251,207,232,.22); }
.site-genre-portfolio .brand-mark { border-radius: 50%; background: #f9a8d4; box-shadow: none; }
.site-genre-portfolio .nav-link { color: #fce7f3; border-radius: 0; border-bottom: 2px solid transparent; }
.site-genre-portfolio .nav-link--active { color: #fff; background: transparent; border-bottom-color: #f9a8d4; }
.route-main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; flex: 1; }
.page-view { --page-accent: var(--accent); --page-accent-strong: var(--accent-strong); --page-soft: var(--accent-soft); --page-warm: var(--warm); --page-hero-bg: linear-gradient(135deg, #17120d, #382313 56%, #7a4b1b); --page-glow: var(--glow); display: grid; gap: clamp(1.25rem, 3vw, 2rem); padding: clamp(1.8rem, 5vw, 4rem) 0 4rem; font-size: 16px; }
.page-view p, .page-view li, .page-view td, .page-view th { font-size: clamp(.92rem, 1vw, 1rem); line-height: 1.68; }
.page-view h2 { font-size: clamp(1.25rem, 2vw, 1.75rem); line-height: 1.18; letter-spacing: -0.02em; }
.page-view h3 { font-size: clamp(1.05rem, 1.4vw, 1.32rem); line-height: 1.22; }
.page-theme-1 { --page-accent: #b67a2c; --page-accent-strong: #7a4b1b; --page-soft: #f1dfbf; --page-warm: #e5b566; --page-hero-bg: linear-gradient(135deg, #17120d, #382313 56%, #7a4b1b); }
.page-theme-2 { --page-accent: #2f7d6d; --page-accent-strong: #174e45; --page-soft: #dcefe9; --page-warm: #9dd7c8; --page-hero-bg: linear-gradient(135deg, #071f1b, #174e45 58%, #2f7d6d); }
.page-theme-3 { --page-accent: #8a5145; --page-accent-strong: #5c2f2a; --page-soft: #f0ddd7; --page-warm: #e0a08e; --page-hero-bg: linear-gradient(135deg, #221110, #5c2f2a 58%, #8a5145); }
.page-theme-4 { --page-accent: #5d67b1; --page-accent-strong: #30396f; --page-soft: #e0e3f8; --page-warm: #bfc5ff; --page-hero-bg: linear-gradient(135deg, #12152a, #30396f 58%, #5d67b1); }
.page-theme-5 { --page-accent: #a86f3d; --page-accent-strong: #6a3f1f; --page-soft: #f2dfcf; --page-warm: #e8b47f; --page-hero-bg: linear-gradient(135deg, #20150d, #6a3f1f 58%, #a86f3d); }
.page-theme-6 { --page-accent: #4d7899; --page-accent-strong: #244a68; --page-soft: #dcebf3; --page-warm: #9fc9df; --page-hero-bg: linear-gradient(135deg, #0b1a24, #244a68 58%, #4d7899); }
.page-hero { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, .95fr) minmax(18rem, .9fr); gap: clamp(1.25rem, 3vw, 2.5rem); align-items: center; padding: clamp(1.6rem, 4vw, 3.2rem); color: #fff7ea; background: var(--page-hero-bg); border: 1px solid rgba(255,255,255,.16); border-radius: calc(var(--radius) * 1.05); box-shadow: var(--page-glow); isolation: isolate; }
.page-hero::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 74% 20%, rgba(255, 227, 163, .24), transparent 16rem), linear-gradient(90deg, rgba(255,255,255,.09), transparent 46%); opacity: .95; }
.page-hero::after { content: ""; position: absolute; width: 18rem; height: 18rem; left: -8rem; bottom: -11rem; border: 1px solid rgba(255,255,255,.22); border-radius: 50%; }
.page-hero > * { position: relative; z-index: 1; }
.page-copy { max-width: 46rem; }
.page-kicker, .eyebrow { width: fit-content; max-width: 100%; display: inline-flex; align-items: center; margin: 0 0 0.75rem; padding: .25rem .55rem; color: #061018; background: #ffd166; border: 1px solid rgba(6, 16, 24, .22); border-radius: .45rem; font-size: 0.8rem; font-weight: 900; line-height: 1.25; letter-spacing: 0.14em; text-transform: uppercase; text-shadow: none; }
.page-hero h1, .page-title { max-width: 18ch; margin: 0; font-size: clamp(2rem, 4.8vw, 3.8rem); line-height: 1.04; letter-spacing: -0.04em; text-wrap: balance; }
.page-lead { max-width: 680px; margin: 1rem 0 0; color: #efe1ca; font-size: clamp(.98rem, 1.4vw, 1.12rem); line-height: 1.72; }
.page-media { position: relative; min-height: clamp(15rem, 31vw, 24rem); }
.page-media::before { content: ""; position: absolute; inset: 1.1rem -1.1rem -1.1rem 1.1rem; border: 1px solid rgba(255,255,255,.24); border-radius: calc(var(--radius) * 1.15); }
.page-image { position: relative; width: 100%; height: 100%; min-height: clamp(15rem, 31vw, 24rem); max-height: 28rem; display: block; object-fit: cover; border-radius: calc(var(--radius) * .95); box-shadow: 0 24px 55px rgba(0, 0, 0, 0.24); background: rgba(255,255,255,.12); filter: saturate(1.04) contrast(1.03); }
.page-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: clamp(1rem, 2.4vw, 1.4rem); align-items: stretch; }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 0.8rem; margin-top: 1.25rem; }
.steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; margin-top: 1.25rem; }
.page-card, .metric, .timeline-item, .callout, .media-panel, .quote { min-width: 0; padding: clamp(1rem, 2.2vw, 1.55rem); background: var(--surface); border: 1px solid var(--line); border-radius: calc(var(--radius) * .85); box-shadow: 0 12px 34px rgba(47, 32, 19, 0.07); }
.page-card { display: flex; flex-direction: column; gap: .9rem; overflow: hidden; }
.page-card { grid-column: span 4; }
.page-card--wide { grid-column: span 8; }
.page-card--wide h2 { font-size: clamp(1.35rem, 2.4vw, 2rem); letter-spacing: -0.03em; }
.page-card--accent, .callout { color: #fff7ea; background: linear-gradient(135deg, #19130d, var(--page-accent-strong)); border-color: rgba(255,255,255,.16); }
.page-card h2, .timeline-item h2, .callout h2 { margin: 0 0 0.65rem; font-size: clamp(1.15rem, 1.8vw, 1.5rem); }
.page-card p, .page-card li, .timeline-item p, .callout p { line-height: 1.75; }
.page-card p, .page-card li, .timeline-item p { color: var(--muted); }
.page-card--accent p, .page-card--accent li, .callout p { color: #f2dec0; }
.page-card .page-media, .media-panel { min-height: 0; padding: 0; overflow: hidden; }
.page-card .page-media::before, .media-panel::before { content: none; }
.page-card .page-image, .page-card img, .media-panel img { width: 100%; height: auto; max-height: clamp(11rem, 22vw, 17rem); min-height: 0; aspect-ratio: 4 / 3; object-fit: cover; border-radius: calc(var(--radius) * .8); box-shadow: none; }
.page-card--wide .page-image, .page-card--wide img { max-height: clamp(13rem, 26vw, 20rem); aspect-ratio: 16 / 9; }
.editorial-flow { display: grid; grid-template-columns: minmax(0, .95fr) minmax(13rem, .48fr); gap: clamp(1rem, 2.4vw, 1.5rem); align-items: start; }
.story-band, .route-timeline, .map-panel, .culture-strip { min-width: 0; padding: clamp(1rem, 2.4vw, 1.65rem); border-radius: 0; box-shadow: none; }
.story-band { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, .72fr) minmax(12rem, .28fr); gap: clamp(1rem, 2.5vw, 1.5rem); align-items: center; background: linear-gradient(90deg, rgba(255,255,255,.9), rgba(255,247,237,.42)); border-top: 3px solid var(--page-accent); border-bottom: 1px solid var(--line); }
.route-timeline { display: grid; gap: .2rem; background: transparent; border-left: .28rem solid var(--page-accent); }
.route-stop { display: grid; gap: .2rem; padding: .7rem 0 .7rem 1rem; border-bottom: 1px solid var(--line); }
.map-panel { min-height: 13rem; color: var(--ink); background: radial-gradient(circle at 18% 28%, var(--page-soft), transparent 8rem), linear-gradient(135deg, rgba(255,255,255,.72), rgba(255,247,237,.34)); border: 1px solid var(--line); border-radius: .35rem 2rem .35rem 2rem; }
.culture-strip { display: flex; flex-wrap: wrap; gap: .55rem; align-items: center; background: transparent; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.quote { color: var(--ink); background: #fff8ec; }
.quote p, .quote li { color: var(--muted); }
.metric { padding: 1rem; background: #fff7ea; box-shadow: none; }
.metric strong { display: block; color: var(--page-accent-strong); font-size: clamp(1.55rem, 3.2vw, 2.55rem); line-height: 1.08; }
.timeline { display: grid; gap: 1rem; margin-top: 1.25rem; }
.tag-list, .feature-list, .cta-row { display: flex; flex-wrap: wrap; gap: 0.65rem; padding: 0; }
.tag { padding: 0.45rem 0.7rem; color: var(--page-accent-strong); background: var(--page-soft); border-radius: 999px; font-weight: 800; }
.page-theme-2 .page-copy, .page-theme-4 .page-copy, .page-theme-6 .page-copy { order: 2; }
.page-theme-2 .page-media, .page-theme-4 .page-media, .page-theme-6 .page-media { order: 1; }
.page-theme-3 .page-image, .page-theme-5 .page-image { border-radius: 2.4rem .75rem 2.4rem .75rem; }
.page-theme-4 .page-card--wide, .page-theme-6 .page-card--wide { grid-column: span 7; }
.page-theme-4 .page-card, .page-theme-6 .page-card { grid-column: span 5; }
.page-genre-game { --page-accent: #ff4655; --page-accent-strong: #1b0b0d; --page-soft: rgba(255, 70, 85, .14); --page-warm: #f6b35b; --page-hero-bg: radial-gradient(circle at 72% 18%, rgba(255,70,85,.24), transparent 18rem), linear-gradient(135deg, #080808, #17100f 52%, #45130d); color-scheme: dark; }
.page-genre-game .page-hero { min-height: clamp(25rem, 58vh, 36rem); align-items: end; grid-template-columns: minmax(0, .9fr) minmax(18rem, 1fr); border-radius: .35rem; border-color: rgba(124,247,255,.24); box-shadow: 0 32px 86px rgba(255, 92, 26, .2); clip-path: polygon(0 0, calc(100% - 1.4rem) 0, 100% 1.4rem, 100% 100%, 1.4rem 100%, 0 calc(100% - 1.4rem)); }
.page-genre-game .page-hero::before { background: linear-gradient(115deg, rgba(7,9,16,.96) 0%, rgba(7,9,16,.55) 45%, transparent 74%), radial-gradient(circle at 78% 25%, rgba(255, 92, 26, .24), transparent 19rem); }
.page-genre-game .page-hero::after { width: 22rem; height: 22rem; left: auto; right: -9rem; bottom: -9rem; border-color: rgba(124,247,255,.3); transform: rotate(12deg); }
.page-genre-game .page-title, .page-genre-game .page-hero h1 { max-width: min(15ch, 100%); text-transform: uppercase; font-size: clamp(2rem, 5vw, 4rem); line-height: .98; letter-spacing: -0.05em; overflow-wrap: anywhere; text-shadow: 0 14px 34px rgba(0,0,0,.4); }
.page-genre-game .page-lead { color: rgba(242, 250, 255, .86); }
.page-genre-game .page-image { min-height: clamp(18rem, 40vw, 31rem); max-height: 34rem; object-fit: cover; border-radius: .8rem; border: 1px solid rgba(124,247,255,.22); filter: saturate(1.18) contrast(1.08); }
.game-stage { position: relative; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(16rem, .75fr); gap: clamp(1rem, 2.8vw, 2rem); padding: clamp(1rem, 3vw, 1.6rem); color: #f7fbff; background: linear-gradient(135deg, rgba(9,12,22,.96), rgba(25,18,36,.94)); border: 1px solid rgba(124,247,255,.2); border-radius: .35rem; box-shadow: inset 0 0 0 1px rgba(124,247,255,.12), 0 22px 70px rgba(7,9,16,.36); overflow: hidden; clip-path: polygon(0 0, calc(100% - 1.4rem) 0, 100% 1.4rem, 100% 100%, 1.4rem 100%, 0 calc(100% - 1.4rem)); }
.game-stage::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(124,247,255,.07) 1px, transparent 1px), linear-gradient(0deg, rgba(124,247,255,.05) 1px, transparent 1px); background-size: 3.5rem 3.5rem; mask-image: linear-gradient(135deg, transparent, #000 18%, #000 76%, transparent); }
.game-stage > * { position: relative; z-index: 1; }
.game-stage > .game-hud, .game-stage > .game-callout, .game-stage > .metric-grid, .game-stage > .timeline { grid-column: 1 / -1; }
.game-hud { display: flex; flex-wrap: wrap; gap: .7rem; align-items: center; }
.hud-pill, .game-slab { min-height: 40px; display: inline-flex; align-items: center; gap: .5rem; padding: .55rem .8rem; color: #16090a; background: linear-gradient(135deg, #ff4655, #f6b35b); border-radius: .4rem; font-size: clamp(.72rem, .95vw, .9rem); font-weight: 900; letter-spacing: .04em; text-transform: uppercase; box-shadow: 0 12px 30px rgba(255,70,85,.16); clip-path: polygon(.45rem 0, 100% 0, calc(100% - .45rem) 100%, 0 100%); }
.game-map { min-height: clamp(18rem, 42vw, 34rem); grid-column: span 1; position: relative; overflow: hidden; background: radial-gradient(circle at 28% 26%, rgba(255,70,85,.28), transparent 10rem), radial-gradient(circle at 72% 66%, rgba(246,179,91,.16), transparent 12rem), linear-gradient(135deg, rgba(9,12,22,.94), rgba(28,18,18,.88)); border: 1px solid rgba(255,70,85,.22); clip-path: polygon(0 0, calc(100% - 1rem) 0, 100% 1rem, 100% 100%, 1rem 100%, 0 calc(100% - 1rem)); }
.game-map::before { content: ""; position: absolute; inset: 12%; border: 1px solid rgba(238,248,255,.22); transform: skew(-9deg) rotate(-4deg); }
.game-map::after { content: ""; position: absolute; left: 18%; right: 18%; top: 48%; height: 2px; background: linear-gradient(90deg, transparent, #f6b35b, #ff4655, transparent); box-shadow: 0 0 24px rgba(255,70,85,.42); }
.page-genre-game, .page-genre-game * { writing-mode: horizontal-tb; }
.game-sites { grid-column: 1 / -1; display: flex; flex-direction: row; flex-wrap: wrap; align-items: stretch; gap: .65rem; min-width: 0; }
.game-site { flex: 1 1 8rem; min-width: min(8rem, 100%); display: inline-flex; align-items: center; gap: .55rem; padding: .6rem .75rem; color: #fff8f2; background: linear-gradient(90deg, rgba(255,70,85,.2), rgba(246,179,91,.08)); border-left: 2px solid #ff4655; clip-path: polygon(0 0, calc(100% - .55rem) 0, 100% .55rem, 100% 100%, 0 100%); }
.site-letter { flex: 0 0 auto; min-width: 2.1rem; min-height: 2.1rem; display: inline-grid; place-items: center; color: #16090a; background: #f6b35b; font-size: clamp(.95rem, 1.4vw, 1.15rem); font-weight: 950; line-height: 1; white-space: nowrap; word-break: keep-all; overflow-wrap: normal; }
.game-lane { display: grid; grid-template-columns: minmax(8rem, .45fr) minmax(0, 1fr); gap: .75rem; align-items: center; padding: .75rem 0; border-bottom: 1px solid rgba(124,247,255,.15); }
.game-lane strong, .game-agent strong, .game-round strong { color: #fff; font-size: clamp(.95rem, 1.4vw, 1.25rem); line-height: 1.15; }
.game-loadout, .game-strip { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; padding: .75rem 0; border-top: 1px solid rgba(124,247,255,.18); border-bottom: 1px solid rgba(124,247,255,.14); }
.game-agent, .game-round { min-width: min(12rem, 100%); flex: 1 1 12rem; padding: .65rem .8rem; color: rgba(238,248,255,.84); background: linear-gradient(90deg, rgba(255,70,85,.16), rgba(124,247,255,.07)); border-left: 2px solid #ff4655; clip-path: polygon(0 0, calc(100% - .55rem) 0, 100% .55rem, 100% 100%, 0 100%); }
.game-rounds { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .55rem; align-items: stretch; }
.game-panel, .game-callout { padding: clamp(.85rem, 1.9vw, 1.35rem); color: #f8fbff; background: linear-gradient(110deg, rgba(7,13,24,.98), rgba(22,30,48,.94)); border: 0; border-left: 2px solid var(--page-warm); border-radius: .35rem; box-shadow: inset 0 0 0 1px rgba(124,247,255,.2), 0 18px 42px rgba(0,0,0,.24); backdrop-filter: blur(10px); clip-path: polygon(0 0, calc(100% - .75rem) 0, 100% .75rem, 100% 100%, .75rem 100%, 0 calc(100% - .75rem)); }
.game-panel h2, .game-callout h2 { margin: 0 0 .6rem; font-size: clamp(1.05rem, 1.55vw, 1.55rem); line-height: 1.12; text-transform: uppercase; letter-spacing: -0.015em; }
.game-panel p, .game-panel li, .game-callout p, .game-callout li { color: #dbeafe; font-size: clamp(.88rem, 1vw, .98rem); line-height: 1.55; }
.page-genre-game [class*="card"], .page-genre-game [class*="panel"] { max-width: 100%; min-width: 0; padding: clamp(.8rem, 1.8vw, 1.25rem); color: #f7fbff; background: linear-gradient(110deg, rgba(7, 13, 24, .92), rgba(22, 30, 48, .82)); border: 0; border-left: 2px solid var(--page-warm); border-radius: .35rem; box-shadow: inset 0 0 0 1px rgba(124,247,255,.2), 0 16px 36px rgba(0,0,0,.22); clip-path: polygon(0 0, calc(100% - .7rem) 0, 100% .7rem, 100% 100%, .7rem 100%, 0 calc(100% - .7rem)); }
.page-genre-game [class*="card"] h2, .page-genre-game [class*="panel"] h2, .page-genre-game [class*="card"] h3, .page-genre-game [class*="panel"] h3 { color: #ffffff; font-size: clamp(1rem, 1.5vw, 1.45rem); line-height: 1.14; letter-spacing: -0.01em; text-shadow: 0 1px 12px rgba(0,0,0,.42); }
.page-genre-game [class*="card"] p, .page-genre-game [class*="panel"] p, .page-genre-game [class*="card"] li, .page-genre-game [class*="panel"] li { color: rgba(238,248,255,.86); font-size: clamp(.88rem, 1vw, .98rem); line-height: 1.55; }
.game-rail { display: grid; gap: .85rem; align-content: start; }
.game-rail .game-panel, .game-rail .game-callout { border-left-color: #ffb347; }
.page-genre-game .metric-grid { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
.page-genre-game .metric { color: #edf8ff; background: rgba(7, 13, 24, .72); border: 0; border-top: 2px solid rgba(124,247,255,.55); border-radius: .25rem; box-shadow: inset 0 0 0 1px rgba(124,247,255,.16); }
.page-genre-game .metric strong { color: #fff; font-size: clamp(1.1rem, 2.1vw, 1.8rem); line-height: 1.08; letter-spacing: -0.025em; overflow-wrap: anywhere; word-break: break-word; }
.page-genre-game .metric span { color: rgba(238,248,255,.76); }
.page-genre-dashboard { --page-accent: #2563eb; --page-accent-strong: #172554; --page-soft: #dbeafe; --page-warm: #38bdf8; --page-hero-bg: linear-gradient(135deg, #07111f, #0f2652 58%, #2563eb); }
.dashboard-shell { display: grid; grid-template-columns: minmax(0, .75fr) minmax(18rem, 1.25fr); gap: clamp(1rem, 2.5vw, 1.5rem); align-items: stretch; }
.dashboard-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .85rem; }
.kpi-tile, .dashboard-panel, .chart-frame, .activity-feed { min-width: 0; padding: clamp(.85rem, 2vw, 1.25rem); background: linear-gradient(180deg, rgba(248,251,255,.98), rgba(231,239,255,.78)); border: 0; border-left: 3px solid var(--page-accent); border-radius: .25rem; box-shadow: inset 0 0 0 1px rgba(37,99,235,.13); }
.kpi-tile strong { display: block; color: var(--page-accent-strong); font-size: clamp(1.55rem, 3.2vw, 2.5rem); line-height: 1.05; letter-spacing: -.04em; }
.chart-frame { min-height: 16rem; background: linear-gradient(180deg, #f8fbff, #eef5ff); }
.chart-bars { display: flex; align-items: end; gap: .55rem; min-height: 10rem; padding-top: 2rem; }
.chart-bars span { flex: 1; min-height: 2rem; border-radius: .7rem .7rem .25rem .25rem; background: linear-gradient(180deg, #38bdf8, #2563eb); }
.activity-feed { display: grid; gap: .7rem; }
.activity-item { padding: .55rem .7rem; background: transparent; border-bottom: 1px solid rgba(15,38,82,.1); border-radius: 0; }
.page-genre-commerce { --page-accent: #c2410c; --page-accent-strong: #7c2d12; --page-soft: #ffedd5; --page-warm: #fed7aa; --page-hero-bg: linear-gradient(135deg, #24120b, #7c2d12 58%, #c2410c); }
.commerce-stage { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(18rem, .95fr); gap: clamp(1rem, 3vw, 2rem); align-items: center; padding: clamp(1rem, 3vw, 1.8rem); background: linear-gradient(90deg, #fffaf4, #ffedd5); border: 1px solid rgba(124,45,18,.14); border-radius: .35rem; box-shadow: inset 0 0 0 1px rgba(124,45,18,.06); }
.product-showcase { display: grid; place-items: center; min-height: clamp(14rem, 30vw, 23rem); background: radial-gradient(circle at 50% 35%, #fff7ed, #fed7aa); border-radius: .35rem; overflow: hidden; }
.product-showcase .page-image { width: min(100%, 34rem); height: auto; min-height: 0; object-fit: contain; box-shadow: none; }
.buy-panel, .commerce-panel { padding: clamp(.9rem, 2.2vw, 1.4rem); background: rgba(255,255,255,.72); border: 0; border-left: 3px solid var(--page-accent); border-radius: .25rem; box-shadow: inset 0 0 0 1px rgba(124,45,18,.12); }
.price-strip { display: flex; flex-wrap: wrap; align-items: baseline; gap: .8rem; color: var(--page-accent-strong); font-weight: 900; }
.price-strip strong { font-size: clamp(1.7rem, 3.8vw, 2.9rem); letter-spacing: -.05em; }
.spec-list { display: grid; gap: .65rem; padding: 0; list-style: none; }
.spec-list li { padding: .55rem .7rem; background: transparent; border-bottom: 1px solid rgba(124,45,18,.12); border-radius: 0; }
.product-tile { padding: .75rem 0; background: transparent; border-top: 1px solid rgba(124,45,18,.14); border-radius: 0; }
.page-genre-product { --page-accent: #7c3aed; --page-accent-strong: #3b0764; --page-soft: #ede9fe; --page-warm: #c4b5fd; --page-hero-bg: linear-gradient(135deg, #12061f, #3b0764 56%, #7c3aed); }
.product-stage { display: grid; grid-template-columns: minmax(0, .95fr) minmax(18rem, 1.05fr); gap: clamp(1rem, 3vw, 2rem); align-items: center; }
.product-screen { min-height: clamp(14rem, 30vw, 23rem); padding: 1rem; background: linear-gradient(135deg, rgba(255,255,255,.96), rgba(237,233,254,.88)); border: 1px solid rgba(124,58,237,.16); border-radius: .35rem; box-shadow: inset 0 0 0 1px rgba(124,58,237,.08), 0 14px 42px rgba(59,7,100,.1); }
.product-panel, .feature-strip, .proof-row { padding: clamp(.9rem, 2.2vw, 1.35rem); background: linear-gradient(90deg, rgba(255,255,255,.9), rgba(237,233,254,.62)); border: 0; border-left: 3px solid var(--page-accent); border-radius: .25rem; box-shadow: inset 0 0 0 1px rgba(124,58,237,.12); }
.feature-strip, .proof-row { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
.feature-chip, .proof-pill { padding: .52rem .75rem; color: var(--page-accent-strong); background: var(--page-soft); border-radius: .35rem; font-weight: 850; }
.page-genre-portfolio { --page-accent: #db2777; --page-accent-strong: #831843; --page-soft: #fce7f3; --page-warm: #f9a8d4; --page-hero-bg: linear-gradient(135deg, #1d0b16, #831843 58%, #db2777); }
.portfolio-wall { columns: 2 16rem; column-gap: clamp(1rem, 3vw, 1.6rem); }
.project-tile, .profile-panel, .showcase-strip { break-inside: avoid; margin: 0 0 clamp(1rem, 3vw, 1.6rem); padding: clamp(.9rem, 2.3vw, 1.5rem); background: linear-gradient(135deg, rgba(255,255,255,.94), rgba(253,242,248,.7)); border: 0; border-top: 3px solid var(--page-accent); border-radius: .25rem; box-shadow: inset 0 0 0 1px rgba(131,24,67,.11); }
.project-tile:nth-child(2n) { transform: translateY(1.5rem); }
.showcase-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .8rem; }
.showcase-strip span { min-height: 6rem; border-radius: .25rem; background: linear-gradient(135deg, var(--page-soft), #fff); }
.data-table { width: 100%; border-collapse: collapse; color: #111827; background: rgba(255,255,255,.96); border-radius: .75rem; overflow: hidden; }
.data-table th, .data-table td { padding: 0.8rem; border-bottom: 1px solid rgba(17,24,39,.14); text-align: left; }
.data-table th { color: #061018; background: #ffd166; }
.data-table td { color: #111827; background: rgba(255,255,255,.94); }
.page-genre-game .data-table { color: #f8fbff; background: #071018; border: 1px solid rgba(124,247,255,.22); }
.page-genre-game .data-table th { color: #16090a; background: #f6b35b; border-bottom-color: rgba(255,70,85,.24); }
.page-genre-game .data-table td { color: #f8fbff; background: #071018; border-bottom-color: rgba(124,247,255,.18); }
.site-footer { padding: 2rem clamp(1rem, 4vw, 4.5rem); color: #d9c6a8; background: var(--night); border-top: 1px solid rgba(255,255,255,.1); }
.brand-link:focus-visible, .nav-link:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid var(--warm); outline-offset: 3px; }
button, .cta-row a { min-height: 44px; }
@media (max-width: 800px) {
    .site-header { position: static; align-items: flex-start; flex-direction: column; }
    .brand-link small { max-width: 22rem; }
    .site-nav { justify-content: flex-start; }
    .page-hero { grid-template-columns: 1fr; }
    .page-genre-game .page-hero { min-height: auto; grid-template-columns: 1fr; }
    .game-stage { grid-template-columns: 1fr; }
    .dashboard-shell, .commerce-stage, .product-stage { grid-template-columns: 1fr; }
    .portfolio-wall { columns: 1; }
    .project-tile:nth-child(2n) { transform: none; }
    .page-grid, .metric-grid, .steps, .editorial-flow, .story-band { grid-template-columns: 1fr; }
    .page-card { grid-column: auto; }
    .page-card--wide { grid-column: auto; }
    .page-hero { border-radius: var(--radius); }
    .page-theme-2 .page-copy, .page-theme-4 .page-copy, .page-theme-6 .page-copy { order: 1; }
    .page-theme-2 .page-media, .page-theme-4 .page-media, .page-theme-6 .page-media { order: 2; }
}
@media (min-width: 801px) and (max-width: 1120px) {
    .page-hero { grid-template-columns: 1fr; }
    .page-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .page-card, .page-card--wide, .page-theme-4 .page-card, .page-theme-6 .page-card, .page-theme-4 .page-card--wide, .page-theme-6 .page-card--wide { grid-column: span 3; }
    .page-card--wide { grid-column: span 6; }
}
@media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;
}

const ALLOWED_PAGE_CLASSES = new Set([
    "page-view",
    "page-theme-1",
    "page-theme-2",
    "page-theme-3",
    "page-theme-4",
    "page-theme-5",
    "page-theme-6",
    "page-genre-game",
    "page-genre-dashboard",
    "page-genre-commerce",
    "page-genre-product",
    "page-genre-portfolio",
    "page-hero",
    "page-copy",
    "page-kicker",
    "eyebrow",
    "page-title",
    "page-lead",
    "page-media",
    "page-image",
    "page-grid",
    "page-card",
    "page-card--wide",
    "page-card--accent",
    "editorial-flow",
    "story-band",
    "route-timeline",
    "route-stop",
    "map-panel",
    "culture-strip",
    "metric-grid",
    "metric",
    "timeline",
    "timeline-item",
    "callout",
    "tag-list",
    "tag",
    "feature-list",
    "media-panel",
    "quote",
    "steps",
    "step",
    "data-table",
    "cta-row",
    "game-stage",
    "game-hud",
    "hud-pill",
    "game-panel",
    "game-rail",
    "game-slab",
    "game-callout",
    "game-map",
    "game-sites",
    "game-site",
    "site-letter",
    "game-lane",
    "game-loadout",
    "game-agent",
    "game-rounds",
    "game-round",
    "game-strip",
    "dashboard-shell",
    "dashboard-kpis",
    "kpi-tile",
    "dashboard-panel",
    "chart-frame",
    "chart-bars",
    "activity-feed",
    "activity-item",
    "commerce-stage",
    "product-showcase",
    "buy-panel",
    "commerce-panel",
    "price-strip",
    "spec-list",
    "product-tile",
    "product-stage",
    "product-screen",
    "product-panel",
    "feature-strip",
    "proof-row",
    "feature-chip",
    "proof-pill",
    "portfolio-wall",
    "project-tile",
    "profile-panel",
    "showcase-strip",
]);

function normalizePageOwnedLinks(
    content: string,
    pages: readonly ResolvedReactPagePlan[],
): string {
    const knownPaths = new Set(pages.map((page) => page.path));
    const pathById = new Map(pages.map((page) => [page.id, page.path]));
    const normalizeTarget = (
        fullMatch: string,
        quote: string,
        rawTarget: string,
    ): string => {
        const routePath = rawTarget.startsWith("#/")
            ? rawTarget.slice(1)
            : rawTarget.startsWith("/")
              ? rawTarget
              : rawTarget.startsWith("#")
                ? pathById.get(rawTarget.slice(1))
                : undefined;

        if (routePath && knownPaths.has(routePath)) {
            return `href=${quote}#${routePath}${quote}`;
        }

        // Page components do not own router state. Unknown root/hash targets
        // are made inert instead of creating a second URL scheme that renders
        // the wrong page; external links remain untouched.
        if (rawTarget.startsWith("/") || rawTarget.startsWith("#")) {
            return "";
        }

        return fullMatch;
    };

    return content
        .replace(/href\s*=\s*(["'])([^"']+)\1/giu, normalizeTarget)
        .replace(
            /href\s*=\s*\{\s*(["'])([^"']+)\1\s*\}/giu,
            normalizeTarget,
        );
}

function assertBalancedJsxTags(page: ResolvedReactPagePlan, content: string): void {
    const voidElements = new Set([
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    ]);
    const stack: string[] = [];
    const tagPattern = /<\s*(\/?)\s*([A-Za-z][\w.-]*)(?:\s[^<>]*)?>/gu;

    for (const match of content.matchAll(tagPattern)) {
        const closing = match[1] === "/";
        const tagName = match[2]?.toLowerCase();
        const fullTag = match[0];

        if (!tagName || fullTag.startsWith("<!") || fullTag.startsWith("<?")) {
            continue;
        }

        if (!closing && (fullTag.endsWith("/>") || voidElements.has(tagName))) {
            continue;
        }

        if (closing) {
            const expected = stack.pop();

            if (expected !== tagName) {
                throw new Error(
                    `${page.filePath} has invalid JSX tag nesting: expected </${expected ?? "none"}> before ${fullTag}`,
                );
            }
            continue;
        }

        stack.push(tagName);
    }

    if (stack.length > 0) {
        throw new Error(`${page.filePath} has unclosed JSX tag <${stack.at(-1)}>`);
    }
}

function assertPageArtifact(
    page: ResolvedReactPagePlan,
    artifact: ParallelFileArtifact,
    expectedVisualAssetPath = visualAssetPath(page),
    expectedThemeClass?: string,
    visualGrammar: PageVisualGrammar = "editorial",
): void {
    const content = artifact.content;
    if (content.length < 800) {
        throw new Error(`${page.filePath} is too small for a complete webpage`);
    }
    if (/```|\b(?:TODO|FIXME|lorem ipsum|coming soon)\b/iu.test(content)) {
        throw new Error(`${page.filePath} contains scaffolding or placeholder content`);
    }
    if (/主题网站|Generated Site|Feature\s*\d|Untitled|your\s+\w+\s+here/iu.test(content)) {
        throw new Error(`${page.filePath} contains generic template wording`);
    }
    const requiredPatterns: Array<[RegExp, string]> = [
        [
            new RegExp(
                `export\\s+const\\s+pageId\\s*=\\s*["']${escapeRegExp(page.id)}["']`,
                "u",
            ),
            `pageId ${page.id}`,
        ],
        [
            new RegExp(
                `export\\s+function\\s+${escapeRegExp(page.componentName)}\\s*\\(`,
                "u",
            ),
            `named ${page.componentName} component`,
        ],
        [/<article\b[^>]*\bclassName=["'][^"']*\bpage-view\b/iu, "page-view article"],
        [
            /<[a-z][^>]*\bclassName=["'][^"']*\bpage-hero\b/iu,
            "page hero",
        ],
        [
            /<[a-z][^>]*\bclassName=["'][^"']*\bpage-copy\b/iu,
            "page hero text column",
        ],
        [/<h1\b/iu, "one page heading"],
    ];
    for (const [pattern, description] of requiredPatterns) {
        if (!pattern.test(content)) {
            throw new Error(`${page.filePath} is missing ${description}`);
        }
    }
    if (
        expectedThemeClass &&
        !new RegExp(
            `<article\\b[^>]*\\bclassName=["'][^"']*\\b${escapeRegExp(expectedThemeClass)}\\b`,
            "iu",
        ).test(content)
    ) {
        throw new Error(`${page.filePath} is missing ${expectedThemeClass}`);
    }

    const h1Count = content.match(/<h1\b/giu)?.length ?? 0;
    if (h1Count !== 1) {
        throw new Error(`${page.filePath} must include exactly one h1`);
    }

    if (visualGrammar === "editorial") {
        if (!/\b(?:page-grid|editorial-flow)\b/u.test(content)) {
            throw new Error(
                `${page.filePath} is missing an editorial content flow`,
            );
        }
        const editorialModules =
            content.match(
                /\b(?:page-card|story-band|route-timeline|route-stop|map-panel|culture-strip|media-panel|quote|timeline-item|callout|feature-list)\b/gu,
            ) ?? [];
        if (editorialModules.length < 3) {
            throw new Error(
                `${page.filePath} needs at least three substantive editorial modules`,
            );
        }
    } else if (visualGrammar === "immersive-game") {
        assertNoGenericCardGrid(page, content, "immersive game");
        assertNoDominantGenericBlockTemplate(page, content, "immersive game", [
            "page-grid",
            "page-card",
            "metric",
            "metric-grid",
            "timeline-item",
            "callout",
            "media-panel",
            "quote",
        ]);
        assertGrammarStructure(page, content, {
            genreClass: "page-genre-game",
            required: [
                [/\bgame-stage\b/u, "immersive game-stage composition"],
                [/\b(?:game-hud|game-rail|game-map|game-sites|game-loadout|game-rounds)\b/u, "game HUD, tactical map, site row, loadout, rounds, or side rail structure"],
            ],
            modules:
                content.match(/\b(?:game-map|game-sites|game-site|site-letter|game-lane|game-loadout|game-agent|game-rounds|game-round|game-strip|game-panel|game-callout|game-slab|hud-pill)\b/gu) ??
                [],
            moduleDescription: "substantive game UI modules",
        });
    } else if (visualGrammar === "dashboard") {
        assertNoGenericCardGrid(page, content, "dashboard");
        assertGrammarStructure(page, content, {
            genreClass: "page-genre-dashboard",
            required: [
                [/\bdashboard-shell\b/u, "dashboard shell"],
                [/\b(?:dashboard-kpis|chart-frame)\b/u, "KPI or chart structure"],
            ],
            modules:
                content.match(/\b(?:kpi-tile|dashboard-panel|chart-frame|activity-feed|activity-item)\b/gu) ??
                [],
            moduleDescription: "dashboard modules",
        });
    } else if (visualGrammar === "commerce") {
        assertNoGenericCardGrid(page, content, "commerce");
        assertGrammarStructure(page, content, {
            genreClass: "page-genre-commerce",
            required: [
                [/\bcommerce-stage\b/u, "commerce stage"],
                [/\b(?:product-showcase|buy-panel)\b/u, "product showcase or buying panel"],
            ],
            modules:
                content.match(/\b(?:product-showcase|buy-panel|commerce-panel|price-strip|spec-list|product-tile)\b/gu) ??
                [],
            moduleDescription: "commerce modules",
        });
    } else if (visualGrammar === "product") {
        assertNoGenericCardGrid(page, content, "product");
        assertGrammarStructure(page, content, {
            genreClass: "page-genre-product",
            required: [
                [/\bproduct-stage\b/u, "product stage"],
                [/\b(?:product-screen|feature-strip|proof-row)\b/u, "product screen, feature strip, or proof row"],
            ],
            modules:
                content.match(/\b(?:product-screen|product-panel|feature-strip|proof-row|feature-chip|proof-pill)\b/gu) ??
                [],
            moduleDescription: "product modules",
        });
    } else {
        assertNoGenericCardGrid(page, content, "portfolio");
        assertGrammarStructure(page, content, {
            genreClass: "page-genre-portfolio",
            required: [
                [/\bportfolio-wall\b/u, "portfolio wall"],
                [/\b(?:project-tile|profile-panel|showcase-strip)\b/u, "portfolio project or profile structure"],
            ],
            modules:
                content.match(/\b(?:project-tile|profile-panel|showcase-strip)\b/gu) ??
                [],
            moduleDescription: "portfolio modules",
        });
    }
    const assetPath = expectedVisualAssetPath;
    if (!content.includes(`src="${assetPath}"`)) {
        throw new Error(`${page.filePath} must include the local visual asset ${assetPath}`);
    }
    if (!/\bclassName=["'][^"']*\bpage-media\b/iu.test(content)) {
        throw new Error(`${page.filePath} must include a page-media visual panel`);
    }
    if (!/\bclassName=["'][^"']*\bpage-image\b/iu.test(content)) {
        throw new Error(`${page.filePath} must style the local visual asset with page-image`);
    }
    const imports = [
        ...content.matchAll(/\bfrom\s*["']([^"']+)["']/gu),
    ].map((match) => match[1]);
    if (imports.some((specifier) => specifier !== "react")) {
        throw new Error(`${page.filePath} may import only the React runtime`);
    }
    if (/\bimport\s*["']/u.test(content)) {
        throw new Error(`${page.filePath} may not use side-effect imports`);
    }
    for (const match of content.matchAll(/className\s*=\s*["']([^"']+)["']/gu)) {
        const classes = (match[1] ?? "").split(/\s+/u).filter(Boolean);
        const unknown = classes.find(
            (className) => !ALLOWED_PAGE_CLASSES.has(className),
        );
        if (unknown) {
            throw new Error(`${page.filePath} uses unsupported class ${unknown}`);
        }
    }
    if (/<img\b(?![^>]*\balt=)[^>]*>/iu.test(content)) {
        throw new Error(`${page.filePath} has an image without alt text`);
    }
    if (/<button\b(?![^>]*\btype=)[^>]*>/iu.test(content)) {
        throw new Error(`${page.filePath} has a button without an explicit type`);
    }
    if (/window\.location|hashchange|<nav\b|<footer\b/iu.test(content)) {
        throw new Error(`${page.filePath} must leave shared navigation and routing to App.tsx`);
    }
    assertBalancedJsxTags(page, content);
}

function assertGrammarStructure(
    page: ResolvedReactPagePlan,
    content: string,
    input: {
        genreClass: string;
        required: Array<[RegExp, string]>;
        modules: string[];
        moduleDescription: string;
    },
): void {
    if (!new RegExp(`\\b${escapeRegExp(input.genreClass)}\\b`, "u").test(content)) {
        throw new Error(`${page.filePath} needs the ${input.genreClass} visual grammar`);
    }

    for (const [pattern, description] of input.required) {
        if (!pattern.test(content)) {
            throw new Error(`${page.filePath} needs ${description}`);
        }
    }

    if (input.modules.length < 3) {
        throw new Error(`${page.filePath} needs at least three ${input.moduleDescription}`);
    }
}

function assertNoGenericCardGrid(
    page: ResolvedReactPagePlan,
    content: string,
    grammarName: string,
): void {
    const forbiddenClasses = [...content.matchAll(/className\s*=\s*["']([^"']+)["']/gu)]
        .flatMap((match) => (match[1] ?? "").split(/\s+/u))
        .filter((className) =>
            /^(?:page-grid|page-card|page-card--wide|page-card--accent)$/u.test(className),
        );
    if (forbiddenClasses.length > 0) {
        throw new Error(
            `${page.filePath} uses generic card/grid classes in a ${grammarName} page: ${[
                ...new Set(forbiddenClasses),
            ].join(", ")}`,
        );
    }
}

function assertNoDominantGenericBlockTemplate(
    page: ResolvedReactPagePlan,
    content: string,
    grammarName: string,
    genericClasses: readonly string[],
): void {
    const classes = [...content.matchAll(/className\s*=\s*["']([^"']+)["']/gu)]
        .flatMap((match) => (match[1] ?? "").split(/\s+/u))
        .filter(Boolean);
    const genericSet = new Set(genericClasses);
    const genericCount = classes.filter((className) =>
        genericSet.has(className),
    ).length;
    const gameSpecificCount = classes.filter((className) =>
        /^(?:game-stage|game-hud|hud-pill|game-map|game-sites|game-site|site-letter|game-lane|game-loadout|game-agent|game-rounds|game-round|game-strip|game-rail|game-slab)$/u.test(
            className,
        ),
    ).length;

    if (genericCount >= 4 && genericCount >= gameSpecificCount) {
        throw new Error(
            `${page.filePath} still uses a dominant generic block/card template for ${grammarName}; use connected subject-specific structures instead`,
        );
    }
}

function formatFallbackPageArtifact(input: {
    page: ResolvedReactPagePlan;
    themeClass: string;
    visualGrammar: PageVisualGrammar;
    visualAssetPath: string;
    failureReason?: string | undefined;
}): ParallelFileArtifact {
    const grammarClass = pageVisualGrammarClass(input.visualGrammar);
    const rootClasses = grammarClass
        ? `page-view ${input.themeClass} ${grammarClass}`
        : `page-view ${input.themeClass}`;
    const title = `${input.page.label}导览`;
    const lead = `${input.page.purpose} 这个页面由本地安全降级流程生成，先保证项目可以继续运行和迭代。`;
    const note = input.failureReason
        ? `原并发页面生成返回了无效 JSON：${input.failureReason}`
        : "原并发页面生成未返回可合并文件。";
    const hero = [
        `      <section className="page-hero">`,
        `        <div className="page-copy">`,
        `          <p className="page-kicker">${escapeXml(input.page.label)} · 可继续迭代</p>`,
        `          <h1>${escapeXml(title)}</h1>`,
        `          <p className="page-lead">${escapeXml(lead)}</p>`,
        `        </div>`,
        `        <div className="page-media"><img className="page-image" src=${JSON.stringify(input.visualAssetPath)} alt=${JSON.stringify(`${input.page.label} visual`)} /></div>`,
        `      </section>`,
    ].join("\n");
    const body =
        input.visualGrammar === "immersive-game"
            ? [
                  `      <section className="game-stage">`,
                  `        <div className="game-hud"><span className="hud-pill">READY</span><span className="hud-pill">TACTICAL</span><span className="hud-pill">LIVE ROUTE</span></div>`,
                  `        <div className="game-map"><div className="game-sites"><span className="game-site"><strong className="site-letter">A</strong><span>主推进点</span></span><span className="game-site"><strong className="site-letter">B</strong><span>转点控制</span></span><span className="game-site"><strong className="site-letter">C</strong><span>信息回收</span></span></div></div>`,
                  `        <div className="game-loadout"><span className="game-agent">节奏规划</span><span className="game-round">攻防切换</span><span className="game-slab">关键资源</span></div>`,
                  `        <section className="game-panel"><h2>先保留可运行草稿</h2><p>${escapeXml(note)}</p></section>`,
                  `      </section>`,
              ].join("\n")
            : input.visualGrammar === "dashboard"
              ? [
                    `      <section className="dashboard-shell">`,
                    `        <div className="dashboard-kpis"><span className="kpi-tile">运行中</span><span className="kpi-tile">可迭代</span><span className="kpi-tile">待增强</span></div>`,
                    `        <div className="chart-frame"><div className="chart-bars"><span></span><span></span><span></span></div></div>`,
                    `        <div className="activity-feed"><p className="activity-item">${escapeXml(note)}</p></div>`,
                    `      </section>`,
                ].join("\n")
              : input.visualGrammar === "commerce"
                ? [
                      `      <section className="commerce-stage">`,
                      `        <div className="product-showcase"><h2>核心展示</h2><p>${escapeXml(input.page.purpose)}</p></div>`,
                      `        <div className="buy-panel"><strong>继续完善</strong><p>${escapeXml(note)}</p></div>`,
                      `        <div className="spec-list"><span>亮点</span><span>场景</span><span>行动</span></div>`,
                      `      </section>`,
                  ].join("\n")
                : input.visualGrammar === "product"
                  ? [
                        `      <section className="product-stage">`,
                        `        <div className="product-screen"><h2>产品主张</h2><p>${escapeXml(input.page.purpose)}</p></div>`,
                        `        <div className="feature-strip"><span className="feature-chip">清晰结构</span><span className="feature-chip">可继续迭代</span><span className="feature-chip">稳定合并</span></div>`,
                        `        <div className="proof-row"><span className="proof-pill">已生成草稿</span><span className="proof-pill">保留路由</span><span className="proof-pill">等待细化</span></div>`,
                        `      </section>`,
                    ].join("\n")
                  : input.visualGrammar === "portfolio"
                    ? [
                          `      <section className="portfolio-wall">`,
                          `        <div className="project-tile"><h2>主题入口</h2><p>${escapeXml(input.page.purpose)}</p></div>`,
                          `        <div className="profile-panel"><p>${escapeXml(note)}</p></div>`,
                          `        <div className="showcase-strip"><span></span><span></span><span></span></div>`,
                          `      </section>`,
                      ].join("\n")
                    : [
                          `      <section className="editorial-flow">`,
                          `        <section className="story-band"><h2>页面方向</h2><p>${escapeXml(input.page.purpose)}</p></section>`,
                          `        <section className="route-timeline"><div className="route-stop">重点一</div><div className="route-stop">重点二</div><div className="route-stop">重点三</div></section>`,
                          `        <section className="map-panel"><p>${escapeXml(note)}</p></section>`,
                          `        <section className="culture-strip"><span>内容</span><span>视觉</span><span>迭代</span></section>`,
                          `      </section>`,
                      ].join("\n");

    return {
        path: input.page.filePath,
        summary: `Used local fallback for ${input.page.label} after page API output was invalid.`,
        content: [
            `import React from "react";`,
            ``,
            `export const pageId = ${JSON.stringify(input.page.id)} as const;`,
            ``,
            `export function ${input.page.componentName}() {`,
            `  return (`,
            `    <article className=${JSON.stringify(rootClasses)} data-page-id=${JSON.stringify(input.page.id)}>`,
            hero,
            body,
            `    </article>`,
            `  );`,
            `}`,
        ].join("\n"),
    };
}

function createAbortRace(signal: AbortSignal): {
    promise: Promise<never>;
    cleanup: () => void;
} {
    let cleanup = (): void => undefined;
    const promise = new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = (): void => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        cleanup = () => signal.removeEventListener("abort", onAbort);
    });
    return { promise, cleanup };
}

async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    operation: (item: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (nextIndex < items.length) {
                const item = items[nextIndex];
                nextIndex += 1;
                if (item !== undefined) {
                    await operation(item);
                }
            }
        },
    );
    await Promise.all(workers);
}

function createFailureResult(
    statuses: PageCodingWorkstreamStatus[],
    errorMessage: string,
): RunParallelReactPagesAgentResult {
    for (const status of statuses) {
        if (status.status === "pending" || status.status === "running") {
            status.status = "failed";
            status.errorMessage = errorMessage;
        }
    }
    return {
        agent: {
            steps: [],
            finished: false,
            stopReason: "model_error",
            errorMessage,
        },
        workstreams: statuses,
    };
}

export async function runParallelReactPagesAgent(
    options: RunParallelReactPagesAgentOptions,
): Promise<RunParallelReactPagesAgentResult> {
    const pages = resolveReactPagePlans({
        goal: options.goal,
        plannerOutput: options.plannerOutput,
        routeRequest: options.routeRequest,
    });
    const maxConcurrency = clampInteger(
        options.maxConcurrency,
        DEFAULT_MAX_CONCURRENCY,
        1,
        MAX_PAGE_COUNT,
    );
    const timeoutMs = clampInteger(
        options.workstreamTimeoutMs,
        DEFAULT_PAGE_TIMEOUT_MS,
        MIN_PAGE_TIMEOUT_MS,
        MAX_PAGE_TIMEOUT_MS,
    );
    const siteIdentity = resolveSiteIdentity(
        options.goal,
        options.plannerOutput,
    );
    const topicLookupEvidence = await lookupTopicEvidenceForVisualGrammar({
        provider: options.topicLookupProvider,
        goal: options.goal,
        siteTitle: siteIdentity.title,
        pages,
        ...(options.signal ? { signal: options.signal } : {}),
    });
    const siteVisualGrammar = inferPageVisualGrammar({
        goal: options.goal,
        siteTitle: siteIdentity.title,
        page: pages[0]!,
        ...(topicLookupEvidence
            ? { topicEvidence: topicLookupEvidence }
            : {}),
    });
    const formalImageMode = options.imageAssetTool
        ? selectFormalImageMode(options.imageAssetModes)
        : undefined;
    const expectedVisualPath = (page: ResolvedReactPagePlan): string =>
        formalImageMode
            ? plannedFormalVisualAssetPath(page)
            : visualAssetPath(page);
    const statuses: PageCodingWorkstreamStatus[] = pages.map((page) => ({
        id: page.id,
        role: "page",
        path: page.filePath,
        routePath: page.path,
        label: page.label,
        status: "pending",
        generationAttempts: 0,
        summary: "No valid page artifact generated yet.",
    }));
    const artifacts = new Map<string, ParallelFileArtifact>();
    const deadlines = new Map<string, number>();

    const generatePage = async (page: ResolvedReactPagePlan): Promise<void> => {
        options.signal?.throwIfAborted();
        const status = statuses.find((candidate) => candidate.id === page.id);
        if (!status) {
            throw new Error(`Missing status for page ${page.id}`);
        }
        const retryReason = status.errorMessage;
        const deadlineAt =
            deadlines.get(page.id) ?? Date.now() + timeoutMs;
        deadlines.set(page.id, deadlineAt);
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
            status.status = "failed";
            status.errorMessage = new PageWorkstreamTimeoutError(
                page.id,
                timeoutMs,
            ).message;
            artifacts.delete(page.id);
            return;
        }

        status.status = "running";
        status.generationAttempts += 1;
        delete status.errorMessage;
        const timeoutSignal = AbortSignal.timeout(remainingMs);
        const combinedSignal = options.signal
            ? AbortSignal.any([options.signal, timeoutSignal])
            : timeoutSignal;
        const scopedModel: ModelProvider = {
            complete: (request) =>
                options.model.complete({
                    ...request,
                    signal: request.signal
                        ? AbortSignal.any([combinedSignal, request.signal])
                        : combinedSignal,
                }),
        };
        const agent = new ParallelFileAgent({
            model: scopedModel,
            maxAttempts: 2,
        });
        const otherPages = pages
            .filter((candidate) => candidate.id !== page.id)
            .map((candidate) => `${candidate.label} (${candidate.path})`)
            .join(", ");
        const themeClass = pageThemeClass(page, pages);
        const visualGrammar = inferPageVisualGrammar({
            goal: options.goal,
            siteTitle: siteIdentity.title,
            page,
            ...(topicLookupEvidence
                ? { topicEvidence: topicLookupEvidence }
                : {}),
        });
        const grammarClass = pageVisualGrammarClass(visualGrammar);
        const rootClasses = grammarClass
            ? `page-view ${themeClass} ${grammarClass}`
            : `page-view ${themeClass}`;
        const fallbackLayoutInstructions =
            visualGrammar === "immersive-game"
                ? [
                      "Use immersive game-site visual grammar, not a card-grid template. The root article must include page-genre-game in addition to page-view and the theme class.",
                      "Derive the game visual identity from the exact title or franchise. Valorant/无畏契约 should feel tactical, angular, map/HUD-driven, and high-contrast; Apex should feel kinetic, squad/loadout/canyon-arena driven; unknown games should use the user's described mechanics and mood instead of a generic game skin.",
                      "After the hero, create one connected game-stage composition instead of a mandatory page-grid. Prefer game-map, game-sites, game-site, site-letter, game-lane, game-loadout, game-agent, game-rounds, game-round, game-strip, and compact hud-pill chips. Use game-panel/game-callout only sparingly.",
                      "For tactical point/site labels such as A/B/C, use <div className=\"game-sites\"><span className=\"game-site\"><strong className=\"site-letter\">A</strong><span>...</span></span>...</div> so the points stay horizontal and can sit in one row on wide screens.",
                      "Never place raw A / B / C text in a narrow table cell or side column; split each point into its own game-site/site-letter chip. Avoid visible decorative punctuation such as trailing //, ::, or -- in headings and labels; use CSS borders, dividers, icons, or spacing instead.",
                      "The page should feel like a game UI or campaign site: cinematic stage, layered panels, HUD-like labels, faction/loadout/mode/status information, sharp contrast, and motion-ready spatial hierarchy.",
                      "Keep HUD and label text readable: neon, yellow, white, red, amber, or pastel text must sit on dark opaque surfaces. Do not place pale text directly on pale gradients, light photos, or translucent light panels.",
                      "Use explicit Valorant-like game contrast pairs by default: dark #071018 or #16090a surfaces with #f8fbff text; red/amber HUD chips #ff4655 or #f6b35b with #16090a text. Do not default to large cyan/blue HUD blocks unless the subject specifically calls for it.",
                      "For data-table/table output, explicitly style th and td: th on #f6b35b with #16090a text, body cells on #071018 with #f8fbff text. For page-kicker/eyebrow labels, use a readable badge pair such as #ffd166 background with #061018 text.",
                      "Do not make the result look like the same generic rounded content-card template with game colors. Avoid page-grid/page-card as the dominant structure; prefer full-bleed bands, slanted HUD panels, terminal overlays, split arena layouts, rails, and compact tactical typography.",
                      "Game pages may use small HUD modules when useful, but they must feel like game UI components rather than a vertical stack of identical content cards.",
                      "Do not merely rename generic cards to panels or modules. Type-specific visual character matters: connected HUD rails, tactical maps, loadout strips, round timelines, stage overlays, angular dividers, and full-bleed arena bands should define the page.",
                  ]
                : [
                      "After the hero, create one editorial-flow with at least three substantive sections. Use a mix of story-band, route-timeline, route-stop, map-panel, culture-strip, media-panel, quote, feature-list, timeline-item, or callout. Avoid page-grid/page-card as the primary structure.",
                      "Use the large image only in the hero. If a later section needs supporting media, keep it short and secondary inside media-panel; never let an image dominate a text block or create tall empty columns.",
                      "Design like a finished editorial website, not a demo: strong topic-specific headline, generous whitespace, asymmetric magazine rhythm, concrete local details, and no generic labels such as 主题网站, Generated Site, Feature 1, Feature 2, or placeholder copy. Do not make every section a same-looking card grid.",
                  ];
        const layoutInstructions =
            visualGrammar === "immersive-game" ||
            visualGrammar === "editorial"
                ? fallbackLayoutInstructions
                : formatPageLayoutInstructions(visualGrammar);
        const subjectDesignBrief = formatSubjectDesignBrief({
            goal: options.goal,
            siteTitle: siteIdentity.title,
            page,
            visualGrammar,
            ...(topicLookupEvidence
                ? { topicEvidence: topicLookupEvidence }
                : {}),
        });
        const generation = agent
            .generate({
                goal: options.goal,
                role: `${page.label} page`,
                path: page.filePath,
                planContext: [
                    `Planner summary: ${options.plannerOutput.summary}`,
                    `Page purpose: ${page.purpose}`,
                    `Page acceptance: ${page.acceptanceCriteria.join("; ")}`,
                    otherPages ? `Sibling pages handled by other API calls: ${otherPages}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                instructions: [
                    `This API call owns exactly the ${page.label} webpage at ${page.path}.`,
                    `Export const pageId = ${JSON.stringify(page.id)} as const and export function ${page.componentName}().`,
                    "Import only React. Do not import CSS, content, App, another page, or a new dependency.",
                    "Apply the frontend-design template pack: use design tokens from shared CSS, semantic section structure, accessible content hierarchy, responsive layout, and the subject-specific blueprint. Do not invent inline styles or same-looking cards.",
                    "Keep this file compact. Do not use inline style objects; use the shared class names only. Avoid huge JSX, long repeated prose, and large arrays so the JSON response does not get truncated.",
                    "Keep typography normal and readable: one h1 only, no 5rem+ headings, no huge metric numbers, no one-character-per-line labels, and no inline fontSize styles. Let shared CSS control scale.",
                    subjectDesignBrief,
                    `The root must be <article className="${rootClasses}" data-page-id=${JSON.stringify(page.id)}>. This page-specific visual grammar and theme are mandatory.`,
                    `Create a magazine-quality page-hero with exactly two direct children: <div className="page-copy"> containing page-kicker, one unique h1, and page-lead; then <div className="page-media"><img className="page-image" src="${expectedVisualPath(page)}" alt="..." /></div>. Do not put loose hero text nodes outside page-copy.`,
                    ...layoutInstructions,
                    "Make this page feel distinct from sibling pages through its content pattern: choose a different emphasis such as overview, culture/story, route/itinerary, product proof, gallery, timeline, metrics, or action plan. Do not reuse the same section titles or card structure from sibling pages.",
                    "Before returning, check every visible text component has an explicit readable color/background pair. Safe pairs: #071018/#f8fbff, #16090a/#fff8f2, #ff4655/#16090a, #f6b35b/#16090a, #ffd166/#061018, #ffffff or #fffaf0/#111827. Do not rely on inherited text color for page-kicker, eyebrow, hud-pill, metric, stat, table th/td, nav, CTA, or footer text.",
                    `Use only these shared classes: ${[...ALLOWED_PAGE_CLASSES].join(", ")}.`,
                    visualGrammar === "immersive-game"
                        ? "Optional game structures may use game-map, game-sites, game-site, site-letter, game-lane, game-loadout, game-agent, game-rounds, game-round, game-strip, game-rail, game-slab, hud-pill, tag-list, tag, feature-list, data-table, and cta-row. Avoid metric-grid, metric, timeline-item, callout, media-panel, and quote unless the request explicitly needs them."
                        : "Optional richer structures may use metric-grid, metric, timeline, timeline-item, callout, tag-list, tag, feature-list, media-panel, quote, steps, step, data-table, and cta-row.",
                    "Write complete subject-specific copy in the user's language with concrete names, places, data points, and useful details. Do not emit navigation links or route hrefs: App.tsx owns every page link and router. No router, footer, placeholders, generic Feature cards, or duplicated sibling-page content.",
                    retryReason
                        ? `Retry only this page because its previous proposal failed: ${retryReason}`
                        : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
            })
            .then((artifact) => {
                const normalizedArtifact = {
                    ...artifact,
                    content: normalizePageOwnedLinks(
                        artifact.content,
                        pages,
                    ),
                };
                assertPageArtifact(
                    page,
                    normalizedArtifact,
                    expectedVisualPath(page),
                    themeClass,
                    visualGrammar,
                );
                return normalizedArtifact;
            });
        const abortRace = createAbortRace(combinedSignal);

        try {
            const artifact = await Promise.race([
                generation,
                abortRace.promise,
            ]);
            artifacts.set(page.id, artifact);
            status.status = "succeeded";
            status.summary = artifact.summary;
        } catch (error) {
            if (options.signal?.aborted) {
                options.signal.throwIfAborted();
            }
            if (timeoutSignal.aborted) {
                status.errorMessage = new PageWorkstreamTimeoutError(
                    page.id,
                    timeoutMs,
                ).message;
            } else {
                status.errorMessage = describeError(error);
            }
            status.status = "failed";
            artifacts.delete(page.id);
        } finally {
            abortRace.cleanup();
        }
    };

    try {
        await runWithConcurrency(pages, maxConcurrency, generatePage);
        const failedPages = pages.filter(
            (page) =>
                statuses.find((status) => status.id === page.id)?.status ===
                "failed",
        );
        if (failedPages.length > 0) {
            await runWithConcurrency(
                failedPages,
                maxConcurrency,
                generatePage,
            );
        }
        options.signal?.throwIfAborted();

        for (const failedPage of pages) {
            const status = statuses.find(
                (candidate) => candidate.id === failedPage.id,
            );
            if (!status || status.status === "succeeded") {
                continue;
            }

            const themeClass = pageThemeClass(failedPage, pages);
            const visualGrammar = inferPageVisualGrammar({
                goal: options.goal,
                siteTitle: siteIdentity.title,
                page: failedPage,
                ...(topicLookupEvidence
                    ? { topicEvidence: topicLookupEvidence }
                    : {}),
            });
            const fallbackArtifact = formatFallbackPageArtifact({
                page: failedPage,
                themeClass,
                visualGrammar,
                visualAssetPath: expectedVisualPath(failedPage),
                failureReason: status.errorMessage,
            });
            artifacts.set(failedPage.id, fallbackArtifact);
            status.status = "fallback";
            status.summary = fallbackArtifact.summary;
            status.errorMessage = [
                status.errorMessage,
                "该页面的模型输出无效，目前展示的是本地兜底草稿。",
                "Recovered with local fallback page so the run can still produce a draft.",
            ]
                .filter(Boolean)
                .join(" ");
        }

        const remainingFailures = statuses.filter(
            (status) =>
                status.status !== "succeeded" &&
                status.status !== "fallback",
        );
        if (
            remainingFailures.length > 0 ||
            artifacts.size !== pages.length
        ) {
            return createFailureResult(
                statuses,
                [
                    "Page-per-API generation failed before atomic merge.",
                    ...remainingFailures.map(
                        (status) =>
                            `${status.label}: ${status.errorMessage ?? "no valid page artifact"}`,
                    ),
                ].join(" "),
            );
        }

        const steps = await executeWithWorkspaceRollback({
            workspaceRoot: options.workspaceRoot,
            execute: async () => {
                const executor = new ActionExecutor({
                    workspaceRoot: options.workspaceRoot,
                    ...(options.imageAssetTool
                        ? { imageAssetTool: options.imageAssetTool }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                const writtenSteps: RunCodingAgentLoopResult["steps"] = [];
                const resolvedVisualPaths = new Map<string, string>();
                const fallbackVisualFiles: Array<{ path: string; content: string }> = [];
                let resolvedLogoPath = fallbackBrandLogoPath();
                const fallbackBrandLogoFile = {
                    path: fallbackBrandLogoOutputPath(),
                    content: formatBrandLogoSvg({
                        siteTitle: siteIdentity.title,
                        tagline: siteIdentity.tagline,
                    }),
                };

                if (
                    options.imageAssetTool &&
                    options.imageAssetModes?.includes("search")
                ) {
                    const action = {
                        type: "get_image" as const,
                        mode: "search" as const,
                        query: formatBrandLogoSearchQuery({
                            goal: options.goal,
                            siteTitle: siteIdentity.title,
                        }),
                        altText: `${siteIdentity.title} logo`,
                        outputPath: plannedBrandLogoOutputPath(),
                    };
                    const execution = await executor.execute(action);
                    writtenSteps.push({ action, execution });
                    if (execution.ok) {
                        const savedPath = parseSavedImagePath(execution.message);
                        if (savedPath) {
                            resolvedLogoPath = webPathFromPublicAssetPath(savedPath);
                        }
                    }
                }

                if (formalImageMode) {
                    for (const [index, page] of pages.entries()) {
                        options.signal?.throwIfAborted();
                        const action = {
                            type: "get_image" as const,
                            mode: formalImageMode,
                            query: formatFormalImageQuery({
                                goal: options.goal,
                                siteTitle: siteIdentity.title,
                                page,
                            }),
                            altText: `${siteIdentity.title} ${page.label} visual`,
                            outputPath: plannedFormalVisualAssetOutputPath(page),
                        };
                        const execution = await executor.execute(action);
                        writtenSteps.push({ action, execution });

                        if (execution.ok) {
                            const savedPath = parseSavedImagePath(
                                execution.message,
                            );
                            if (savedPath) {
                                resolvedVisualPaths.set(
                                    page.id,
                                    webPathFromPublicAssetPath(savedPath),
                                );
                                continue;
                            }
                        }

                        resolvedVisualPaths.set(page.id, visualAssetPath(page));
                        fallbackVisualFiles.push({
                            path: visualAssetOutputPath(page),
                            content: formatVisualAssetSvg({
                                goal: options.goal,
                                siteTitle: siteIdentity.title,
                                page,
                                index,
                            }),
                        });
                    }
                } else {
                    for (const [index, page] of pages.entries()) {
                        resolvedVisualPaths.set(page.id, visualAssetPath(page));
                        fallbackVisualFiles.push({
                            path: visualAssetOutputPath(page),
                            content: formatVisualAssetSvg({
                                goal: options.goal,
                                siteTitle: siteIdentity.title,
                                page,
                                index,
                            }),
                        });
                    }
                }

                const generatedFiles = [
                    {
                        path: "src/content.ts",
                        content: formatContentModule(
                            options.goal,
                            options.plannerOutput,
                            pages,
                            resolvedLogoPath,
                        ),
                    },
                    ...(resolvedLogoPath === fallbackBrandLogoPath()
                        ? [fallbackBrandLogoFile]
                        : []),
                    ...fallbackVisualFiles,
                    ...pages.map((page) => {
                        const originalVisualPath = expectedVisualPath(page);
                        const resolvedVisualPath =
                            resolvedVisualPaths.get(page.id) ?? originalVisualPath;
                        return {
                            path: page.filePath,
                            content: artifacts
                                .get(page.id)!
                                .content.replaceAll(
                                    originalVisualPath,
                                    resolvedVisualPath,
                                ),
                        };
                    }),
                    { path: "src/App.css", content: formatSharedStyles() },
                    { path: "src/App.tsx", content: formatAppModule(pages, siteVisualGrammar) },
                ];

                for (const file of generatedFiles) {
                    options.signal?.throwIfAborted();
                    const action = {
                        type: "write_file" as const,
                        path: file.path,
                        content: file.content,
                    };
                    const execution = await executor.execute(action);
                    if (!execution.ok) {
                        throw new Error(execution.message);
                    }
                    writtenSteps.push({ action, execution });
                }
                const finishAction = {
                    type: "finish" as const,
                    summary: `Generated ${pages.length} independent webpage(s) with one initial Coding API call per page and merged the shared router locally.`,
                };
                const finishExecution = await executor.execute(finishAction);
                writtenSteps.push({
                    action: finishAction,
                    execution: finishExecution,
                });
                return writtenSteps;
            },
        });

        return {
            agent: {
                steps,
                finished: true,
                stopReason: "finish",
            },
            workstreams: statuses,
        };
    } catch (error) {
        if (options.signal?.aborted) {
            options.signal.throwIfAborted();
        }
        if (isAbortError(error)) {
            throw error;
        }
        return createFailureResult(
            statuses,
            `Parallel page generation failed: ${describeError(error)}`,
        );
    }
}
