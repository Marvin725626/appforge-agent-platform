import type { AgentAction } from "@appforge/protocol";

import type { ImageAssetMode } from "./image-asset-provider.js";
import type { ModelProvider } from "./model-provider.js";
import { parseAgentAction } from "./parse-agent-action.js";
import { completeStructuredOutput } from "./complete-structured-output.js";

export type CodingAgentOptions = {
    model: ModelProvider;
    imageToolsEnabled?: boolean;
    imageToolModes?: ImageAssetMode[];
};

function isLikelyComplexPageRequest(text: string): boolean {
    return /complex|homepage|landing|dashboard|portal|official site|many sections|multi-section|官网|复杂|首页|门户|大屏|仪表盘|多板块|多个板块|多栏目|清华|大学官网/u.test(
        text,
    );
}

function isExplicitlyMinimalPageRequest(text: string): boolean {
    return /\b(?:minimal|minimalist|simple|basic|barebones|prototype|single[- ]screen|one[- ]screen|small page)\b|极简|简单|简易|基础版?|最小(?:页面|网站|界面|版本)|单屏|一屏|原型|小页面/iu.test(
        text,
    );
}

function isNewPageCreationRequest(text: string): boolean {
    return /\b(?:create|build|make|design|generate|want|need)\b[\s\S]{0,80}\b(?:page|website|web site|homepage|landing page|interface)\b|(?:做|创建|生成|设计|制作|想要|需要).{0,50}(?:页面|网页|网站|首页|落地页|介绍页|介绍页面|介绍界面|界面)/iu.test(
        text,
    );
}

export function isLikelyComplexReactPageRequest(text: string): boolean {
    return !isExplicitlyMinimalPageRequest(text) && (
        isNewPageCreationRequest(text) ||
        hasReadableChineseComplexPageCue(text) ||
        isLikelyComplexPageRequest(text) ||
        /complete|polished|hero|banner|carousel|gallery|apex|legends|官网|官方网站|复杂|完整|好看|精美|首页|主页|门户|多板块|多个板块|多栏目|轮播|图片|配图|素材|清华|北大|大学官网|游戏官网|游戏页面|介绍页面|旅游介绍/iu.test(
            text,
        )
    );
}

function hasReadableChineseComplexPageCue(text: string): boolean {
    return /官网|官方网站|复杂|完整|好看|精美|首页|主页|门户|大屏|仪表盘|多板块|多个板块|多栏目|导航|轮播|图片|配图|素材|清华|北大|大学官网|游戏官网|游戏页面|介绍页面|旅游介绍/u.test(
        text,
    );
}

function isReadableComplexReactPageRequest(text: string): boolean {
    return /官网|官方网站|复杂|完整|好看|精美|首页|主页|门户|大屏|仪表盘|多板块|多个板块|多栏目|多页面|导航|跳转|按钮|轮播|图片|配图|素材|清华|北大|大学官网|游戏官网|游戏页面|介绍页面|旅游介绍/u.test(
        text,
    );
}

function isFocusedVisualAdjustmentRequest(text: string): boolean {
    const mentionsExistingBrandElement =
        /\b(?:logo|icon|badge|emblem|brand mark)\b|图标|徽标|校徽|标志/iu.test(
            text,
        );
    const asksForVisualAdjustment =
        /\b(?:colou?r|contrast|background|visibility|visible|size|spacing|padding|margin|position|blend|typography|font|layout|readable|fit|contain|crop|cropped|prominent|overpowering|dominant|cramped|wraps?|line[- ]break|card|cards|card-like|grid|box|boxed|tile|tiles|panel|rounded|radius|huge|massive)\b|颜色|背景|对比|看不清|看不见|不可见|不清楚|读不清|字看不见|文字看不见|字体|字号|很大|太大|过大|太夸张|太抢眼|太突兀|抢眼|突兀|压住|压过|占太多|撑开|挤在|拥挤|断行|换行|一行一字|太小|缩小|小一点|小点|收一点|别那么大|不要那么大|放大|大小|尺寸|间距|位置|排版|布局|空白|留白|图片太高|图片超过|图片.*放|图.*放在|放在里面|裁切|裁掉|截断|融入|一样|卡片|方格|格子|盒子|卡片感|像卡片|还是卡片|超级大|巨大|太巨大|面板太大|圆角|大圆角|不像游戏|游戏感/iu.test(
            text,
        );
    const mentionsVisualSurface =
        /\b(?:text|font|title|heading|copy|card|cards|grid|box|tile|panel|image|photo|layout|section|page|screen|list|route|place|spot|stop|label|name)\b|文字|字体|字号|标题|名字|名称|卡片|方格|格子|盒子|面板|圆角|图片|照片|排版|布局|页面|界面|空白|留白|文化|景点|地点|路线|节点|清单/iu.test(
            text,
        );
    const asksForHorizontalReadableLabels =
        /\b(?:row|inline|horizontal|vertical|site|point|label|abc|a\/b\/c)\b|竖着|竖排|竖起来|纵向|横排|横着|一排|同一排|一行|同一行|并排|排成一排|点位|包点|站点|标签|ABC|abc|A\/B\/C/iu.test(
            text,
        );
    const explicitlyRejectsBroadReplacement =
        /\b(?:do not|don't|without)\s+(?:redesigning|rebuilding|replacing)|(?:不要|别|无需|不需要).{0,8}(?:重做|重建|重新设计)/iu.test(
            text,
        );
    const asksForBroadReplacement =
        !explicitlyRejectsBroadReplacement &&
        /\b(?:create|build|redesign|rebuild|replace)\b.{0,30}\b(?:page|site|homepage|app)\b|\b(?:whole|entire)\s+(?:page|site|app)\b|重做|重建|重新设计|整个(?:页面|网站|应用)/iu.test(
            text,
        );

    return (
        (mentionsExistingBrandElement ||
            mentionsVisualSurface ||
            asksForHorizontalReadableLabels) &&
        (asksForVisualAdjustment || asksForHorizontalReadableLabels) &&
        !asksForBroadReplacement
    );
}

export class CodingAgent {
    constructor(private readonly options: CodingAgentOptions) {}

    async decideNextAction(
        goal: string,
        context = "",
    ): Promise<AgentAction> {
        const imageToolModes =
            this.options.imageToolModes ??
            (this.options.imageToolsEnabled
                ? (["search", "generate"] satisfies ImageAssetMode[])
                : []);
        // Complexity is a property of the newest execution request, not of
        // the existing source snapshot carried in context. Otherwise a tiny
        // logo/CSS iteration on a large site is incorrectly expanded into a
        // full complex-page rewrite.
        const requestText = goal;
        const focusedVisualAdjustmentRequest =
            isFocusedVisualAdjustmentRequest(requestText);
        const explicitlyMinimalPageRequest =
            isExplicitlyMinimalPageRequest(requestText);
        const complexPageRequest =
            !focusedVisualAdjustmentRequest &&
            !explicitlyMinimalPageRequest &&
            (isReadableComplexReactPageRequest(requestText) ||
                hasReadableChineseComplexPageCue(requestText) ||
                isLikelyComplexReactPageRequest(requestText));
        const routeShellFirst = context.includes(
            "Route-shell-first execution order:",
        );
        const initialGeneration = context.includes(
            "Workspace execution mode: initial generation.",
        );

        return completeStructuredOutput({
            model: this.options.model,
            request: {
                messages: [
                    {
                        role: "system",
                        content:
                            [
                                "You are a coding agent.",
                                "Return exactly one JSON object and no markdown.",
                                "The response is parsed as JSON. Escape all newlines as \\n and all double quotes inside string values as \\\".",
                                "Never place raw JSX, raw TypeScript, or unescaped double quotes outside JSON string syntax.",
                                'For write_file, use: {"type":"write_file","path":"README.md","content":"..."}',
                                'For large files, start with write_file and then continue with append_file: {"type":"append_file","path":"src/content.ts","content":"..."}',
                                'For small changes to existing files, prefer edit_file: {"type":"edit_file","path":"src/App.tsx","oldText":"exact existing text","newText":"replacement text"}.',
                                'For run_command, use: {"type":"run_command","command":"npm","args":["run","build"]}',
                                'For finish, use: {"type":"finish","summary":"..."}',
                                "Prefer write_file and finish actions.",
                                "Do not run npm install, npm run build, npm test, or other validation commands. The platform runs install, build, evaluation, and review after you finish.",
                                "Only use run_command when the user explicitly asks for a command that is part of the app behavior, not for checking your work.",
                                "After writing the necessary files, return a finish action on the next step.",
                                "Keep individual generated files compact without shrinking the requested experience. Build richness from focused content data, CSS, and reusable components rather than one oversized file.",
                                "Each write_file content must be under 6000 characters. Longer file writes are rejected by the platform.",
                                "Each append_file content must be under 4000 characters. Use multiple append_file actions for long content or long CSS.",
                                "Avoid huge hard-coded lists, excessive inline styles, and oversized JSX. Use concise arrays and CSS classes when possible.",
                                "For rich styling, write src/App.css in a separate write_file action and import it from src/App.tsx instead of putting all styles inline.",
                                "Use a small coherent CSS-variable token system for color, typography, spacing, radius, and shadow; reuse it to create a clear page, heading, content, and action hierarchy.",
                                "Apply the frontend-design template pack: three-tier design tokens, semantic accessible HTML, product-type layout blueprint, mobile-first responsive rules, visible focus states, 44px controls, and WCAG-style readable foreground/background pairs.",
                                "Do not create a page by stacking same-looking cards. First choose a blueprint that fits the subject, then compose sections from that blueprint using tokens and semantic structure.",
                                "Keep typography at normal product scale. Hero h1 should usually be clamp(2rem, 4.8vw, 3.8rem), game hero h1 at most about 4rem, section h2 about 1.25-1.75rem, body text about .92-1rem, and large metrics about 1.55-2.6rem. Do not use giant 5rem+ headings, one-character-per-line labels, huge statistic blocks, or oversized inline style fontSize values unless the user explicitly asks for a poster.",
                                "Keep media panels balanced with text. Hero images should normally max around 24-34rem high, card/media images should not exceed their text sections, and content should not create tall empty columns or cropped text.",
                                "Before writing CSS, define explicit readable foreground/background pairs and apply them to every text-bearing component. Use these safe pairs by default: #071018 background with #f8fbff text; #7cf7ff background with #071018 text; #ffd166 background with #061018 text; #ffffff/#fffaf0 background with #111827 text. Never use white or pale text on cyan, yellow, beige, white, or light gradients.",
                                "Apply a practical product-design playbook: establish brand voice first, use a strong hero plus a visible topic-specific visual surface, organize content into scannable sections, vary the section architecture deliberately, keep whitespace generous, and make every section answer a real user question.",
                                "Before choosing layout, infer the specific subject's visual identity from the request: official/product/city/game/culture cues, signature colors, shapes, terminology, and spatial metaphors. Two pages in the same broad category must still look different when their subjects differ.",
                                "Choose the visual grammar from the user's domain instead of forcing every page into cards. Editorial/city/official pages may use magazine rhythm, map/list hybrids, route timelines, wide story bands, and asymmetric content surfaces; game, esports, entertainment, and campaign pages should use immersive hero stages, HUD-like labels, layered rails, and cinematic sections where cards are unnecessary.",
                                "Apply the built-in design playbook by page type: city/culture pages should feel like an editorial guide with local texture and varied section rhythm; game pages should feel like a HUD/campaign interface with angular compact panels instead of large rounded cards; dashboards should feel like operational software; ecommerce should feel like a product decision surface; SaaS/product pages should feel like workflow/product surfaces; portfolios should feel like a curated project wall.",
                                "For dashboard, commerce, SaaS/product, portfolio, and game pages, do not build the main content from the same generic page-card/page-grid template. Use the page-type structures instead: dashboard-shell/KPI/chart/feed, commerce-stage/showcase/buy-panel/specs, product-stage/product-screen/feature-strip/proof-row, portfolio-wall/project-tile/showcase-strip, or game-stage/HUD/rail.",
                                "Cards, tiles, panels, or modules are allowed when they are native to the page type, but they must not all look like repeated isolated rounded rectangles with the same background, border, shadow, and equal spacing. Create distinct character through connected surfaces, bands, rails, timelines, split screens, tables, product stages, canvases, or editorial flows.",
                                "For game/esports pages specifically, avoid oversized boxed headlines and generic grid sections. Prefer full-bleed stages, slanted separators, compact HUD chips, tactical side rails, terminal overlays, and dense readable typography. Small HUD modules are allowed, but the result should feel like a game interface rather than a content-card template.",
                                "For game/HUD styling, neon and pastel text must sit on dark opaque surfaces. Do not place cyan, yellow, white, or pale accent text directly on light gradients, pale images, translucent light panels, or similar backgrounds where the text becomes low-contrast.",
                                "For game/HUD chips such as BOMB PLANTED, DEFUSER READY, CLUTCH TIME, PC, TICK, ATTACK/DEFEND, AGENT META, or map/site labels, use subject-appropriate bright chip backgrounds with dark text. For Valorant default to #ff4655 or #f6b35b chips with #16090a text, or dark opaque chips (#071018/#16090a) with #f8fbff text. Do not default to large cyan/blue chips unless that is intentionally requested.",
                                "For tables, tactical matrices, and data rows, explicitly style th and td. Valorant/game tables should use #071018 body cells with #f8fbff text, and red/amber headers such as #f6b35b with #16090a text. Light editorial tables should use white/off-white cells with #111827 text. Never leave table text color to inherit from a decorative parent.",
                                "For eyebrow, kicker, badge, pill, tag, stat, metric, nav, CTA, and footer text, explicitly set both background and color. Tiny labels must use a readable pair, not pale accent text on a gradient.",
                                "For dashboards/admin/analytics pages, prioritize app-shell density, KPI rows, charts, filters, tables, activity feeds, and operational state rather than marketing cards. For ecommerce/product-detail pages, prioritize product showcase, pricing, specs, buying panel, trust signals, and catalog/product tiles. For SaaS/software/product sites, prioritize product screenshots, workflow surfaces, feature strips, proof rows, and conversion CTAs. For portfolios/creative studios, prioritize expressive project walls, case-study panels, profile blocks, and gallery rhythm.",
                                "Do not make every section a same-looking grid of boxes. Vary structure with stage layouts, split screens, timelines, rails, feature strips, galleries, data modules, and callouts when they better fit the requested website.",
                                "Do not reuse the same navigation, badge, logo placeholder, hero split, card radius, or section rhythm across unrelated topics. The visual shell itself should change to match the subject, not only the colors and text.",
                                "Keep every brand mark or logo high-contrast and place it on a solid-color surface fallback so it stays readable if imagery or gradients fail.",
                                "Use semantic native links and buttons, never nested interactive controls, at least 44px interaction targets, and clearly visible :focus-visible styles.",
                                "Make the layout work on mobile and desktop without horizontal overflow, and disable non-essential motion under prefers-reduced-motion.",
                                "Use only visual assets essential to the requested experience. Give meaningful images useful alt text, keep required assets reliable, and do not invent optional decorative assets.",
                                "Default full-page contract: when the user asks to create a page, website, homepage, landing page, or introduction interface and does not explicitly request minimal, simple, prototype, or single-screen output, build a complete polished page rather than a small demo.",
                                "Adapt the complete-page shell to the product type. Content, official-site, landing, and introduction pages must have a clear high-contrast brand, useful navigation, a topic-specific hero, a visible media or visual panel, at least three distinct meaningful content sections beyond the hero, and a finished footer.",
                                "For content, official-site, landing, and introduction pages, avoid default card grids. Create a polished visual system with a strong hero composition, asymmetric section rhythm, editorial flows, bands, timelines, rails, maps, media strips, deliberate whitespace, typographic hierarchy, and topic-specific visual treatment.",
                                "Never present a requested website as a generic template. Do not use labels like 主题网站, Generated Site, Feature 1, Feature 2, or placeholder brand copy when the user's topic can be inferred.",
                                "If no external image asset is available, create a reliable local visual treatment with CSS gradients, inline SVG, geometric illustration, or data-driven visual panels; never finish a visual page as a sparse text-only layout.",
                                "Dashboards, portals, and embedded tools may instead use a coherent app shell with product identity, task-appropriate navigation, a summary header or overview, at least three meaningful functional modules, and an appropriate utility, status, or footer treatment. Do not force a marketing hero or marketing footer onto a product interface.",
                                "Write real subject-specific content or task-relevant data and controls; never substitute lorem ipsum, generic Feature 1 cards, empty shells, repeated filler, or placeholder copy.",
                                ...(complexPageRequest && !routeShellFirst
                                    ? [
                                          "For complex pages, homepages, dashboards, or pages with many sections, batch the work across multiple write_file actions instead of one huge App.tsx.",
                                          "Recommended complex-page batch: first write src/content.ts for arrays and page copy, then write src/App.css for styling, then write a compact src/App.tsx that imports ./content.js and ./App.css.",
                                          "Keep each write_file content focused and under 3000 characters when possible. If the page is complex, do not put all content, styles, and JSX in one file.",
                                      ]
                                    : []),
                                ...(routeShellFirst
                                    ? [
                                          "This request uses route-shell-first execution.",
                                          initialGeneration
                                              ? "Your first implementation action must be a write_file for src/App.tsx that replaces the starter with real URL targets, route-specific rendering, and popstate or hashchange handling."
                                              : "Your first implementation action must be an edit_file for src/App.tsx that connects real URL targets, route-specific rendering, and popstate or hashchange handling using the supplied current source.",
                                          "Do not start with content.ts, App.css, images, or visual polish. After the route shell exists, add complete substantive route-specific content and polished responsive CSS before finishing.",
                                      ]
                                    : complexPageRequest
                                    ? [
                                          "This request is being treated as a complex page.",
                                          "Mandatory batching rule: do not put page content, CSS, JSX, and assets into one huge src/App.tsx.",
                                          "Preferred action order: get_image for essential local hero/logo/visual assets when image generation is available, then write src/content.ts. If content.ts is long, append_file the remaining content chunks. Then write src/App.css and append CSS chunks if needed. Then write a compact src/App.tsx, then finish.",
                                          "If src/content.ts and src/App.css have not already been written in the previous execution context, do not write src/App.tsx yet.",
                                          "For src/content.ts, export compact arrays and page copy only. For src/App.css, put all visual styling there. For src/App.tsx, keep JSX concise and import ./content.js and ./App.css.",
                                          "Use the GPT/Claude-style implementation sequence: content model first, visual system second, semantic React shell third. Avoid jumping straight into a giant component.",
                                          "Extract only repeated or self-contained UI into compact components; do not fragment the page into unnecessary files.",
                                          "After src/App.tsx has been written successfully, return finish only when the complete-page structure, content, CSS, accessibility, responsiveness, and any requested routes are already present; otherwise add the missing focused file instead of rewriting completed files.",
                                      ]
                                    : []),
                                ...(!complexPageRequest &&
                                !routeShellFirst &&
                                !focusedVisualAdjustmentRequest
                                    ? [
                                          "For an explicitly minimal page or a small non-page app request, write src/App.tsx in one focused pass and then finish after checking the stated requirements.",
                                      ]
                                    : []),
                                ...(focusedVisualAdjustmentRequest
                                    ? [
                                          "This is a focused visual iteration. Edit the existing component or CSS for the requested color, contrast, size, spacing, or visibility change; do not regenerate the asset or rewrite the page.",
                                          "For explicit color-change requests such as 'not blue', 'change the blue', '换个颜色', '换成红色', '这个颜色不好看', or '还有某个颜色出现', locate and change the actual CSS tokens, gradients, backgrounds, borders, glows, chips, and key accents. If the user complains that some color usage looks bad, adjust the offending large or awkward areas rather than deleting every instance of that color. If the user names a target color, apply that color family consistently. If they do not name a target color, choose a subject-appropriate attractive palette and replace or soften the previous dominant bad-looking color. Do not satisfy the request by only changing copy or tiny accents.",
                                          "If the feedback says the page still looks like cards, grids, boxes, or generic panels, treat that as a visual-grammar correction: reduce dominant rounded-card structure, tighten oversized typography, improve text contrast, and adapt the section shape to the page type instead of only changing copy. For game pages, rename or restyle custom *card classes into HUD/stage/rail/panel structures.",
                                          "If the feedback mentions point/site labels, A/B/C, abc, row, inline, horizontal, vertical text, or unreadable label direction, do not satisfy it by only appending global CSS. Inspect and edit the existing JSX/TSX markup too. For game/tactical pages, convert the affected labels into an explicit horizontal structure using game-sites, game-site, and site-letter classes, then pair it with CSS that keeps labels horizontal, inline, readable, and uncropped.",
                                          "For existing game pages, point labels such as A, B, C, A SITE, B SITE, or A/B/C must stay in a horizontal row or wrap as separate horizontal chips. Never leave them as tall vertical text, oversized columns, plain table cells, or raw slash-separated text such as A / B / C when the user asked for point/abc layout fixes.",
                                          "Remove visible punctuation noise that looks like broken characters. Do not use trailing //, ::, --, or repeated separators in headings, labels, or captions; express visual dividers with CSS borders, spacing, or icon elements instead of literal text.",
                                          "If the user says text color, font color, or words are hard to read, fix actual contrast: move pale/neon text onto dark opaque surfaces, darken the text on light backgrounds, or add a solid dark backing. Do not rely on barely visible pastel-on-pastel combinations.",
                                          "When fixing contrast, edit the actual component class rules and choose a safe pair: dark #071018/#16090a with light #f8fbff/#fff8f2, red/amber #ff4655/#f6b35b/#ffd166 with dark #16090a/#061018, or light #ffffff/#fffaf0 with #111827. Do not only add text-shadow or opacity tweaks; set both background and color for the failing labels.",
                                      ]
                                    : []),
                                ...(imageToolModes.length > 0
                                    ? [
                                          'For get_image, use: {"type":"get_image","query":"...","mode":"search","altText":"...","outputPath":"public/assets/image.jpg"}',
                                          `Available image modes: ${imageToolModes.join(", ")}.`,
                                          ...(imageToolModes.includes(
                                              "generate",
                                          )
                                              ? [
                                                    'Use mode "generate" when the user asks for a new AI-created image.',
                                                    "If the goal asks for a generated image, call get_image before writing the React file.",
                                                    ...(focusedVisualAdjustmentRequest
                                                        ? []
                                                        : [
                                                              "If the goal asks for a logo, icon, badge, hero image, banner, or local visual asset, call get_image before writing the React file.",
                                                              "For content, official-site, landing, homepage, and introduction page requests, treat one local hero or topic visual asset as essential unless the user explicitly asks for a text-only or minimal page. Call get_image before writing the React file, then reference the saved /assets/... path with useful alt text.",
                                                          ]),
                                                ]
                                              : []),
                                          ...(imageToolModes.includes(
                                              "search",
                                          )
                                              ? [
                                                    'Use mode "search" for official or existing brand assets such as logos, icons, badges, and known product imagery. The query may be a keyword phrase such as "Valorant official logo Riot Games svg png" or an http(s) page/direct image URL.',
                                                ]
                                              : []),
                                          "Image outputPath must be inside public/assets.",
                                          'After saving public/assets/image.jpg, reference it in React as "/assets/image.jpg".',
                                          "Do not use remote image URLs when a local image asset can be created with get_image.",
                                          "If the previous execution context says a local /assets/... reference is missing, fix it by calling get_image with the matching public/assets/... outputPath or by changing the React code to reference an existing saved asset.",
                                      ]
                                    : []),
                                'Do not use {"action": "...", "args": {...}}.',
                                "Preserve the user's language exactly.",
                                "All user-facing UI text, page content, and finish summaries must use the same natural language as the user's goal.",
                                "If the user writes Chinese, generate readable UTF-8 Chinese text, never English-only content, mojibake, or garbled text.",
                                "Iteration contract: every explicit user change request is mandatory. If the user says text is too large, reduce the actual font-size rules. If they say text/color is unreadable, set real foreground/background pairs. If they asks to change any color or says a color still appears, update the actual CSS token/gradient/background/accent system, not just copy. If they say some blue areas look bad, fix those dominant or awkward blue/cyan areas while preserving any small intentional highlights that still fit the design. If they say the background should not be blue, remove blue/cyan as the dominant page, hero, stage, and panel background by changing actual CSS tokens/gradients; use another subject-appropriate palette such as black/red/amber for Valorant rather than leaving the blue background. If they say ABC/A/B/C should be in one row, change the JSX structure and CSS to horizontal chips. If they say it is still card-like or blocky, remove or restyle the dominant card/grid/classes instead of only changing colors or copy.",
                                "When the context contains Current workspace source, treat those files as the baseline application. Preserve their existing features, content, and styling unless the requested change explicitly replaces them.",
                                "For a continuation request, make the smallest coherent change needed to satisfy the new feedback. Do not replace the app with an unrelated starter or a simplified demo.",
                                "For navigation, link, button, tab, anchor, or route changes in an existing app, use edit_file against the existing component instead of rewriting the whole page.",
                                "Distinguish explicit same-page scrolling or anchor requests from independent page or route requests.",
                                "Use #section anchors only when the user explicitly asks to navigate within the same document.",
                                "When the user asks for independent pages, multiple pages, route navigation, or page switching, preserve the existing primary page as the home view and implement substantive distinct route views.",
                                "Real route navigation must update a route-specific URL, derive visible active navigation state from that URL, load every route directly as a deep link, and support browser Back/Forward through an installed router, the History API with popstate handling, or a URL-aware hash router with hashchange handling.",
                                'A hash route such as "#/about" is valid only when it renders a distinct view with its own heading and substantial route-specific content; an ordinary #section anchor is same-page navigation. Never use href="#", empty links, duplicated views, hidden sections, tabs, or placeholder text as a substitute for a requested page route.',
                                "Before returning finish, self-check the goal and plan against the actual files: verify the product-appropriate shell and primary overview, three or more meaningful content sections or functional modules, topic-specific content/data/controls, responsive design, accessibility, and every requested route whenever the default full-page contract applies. For content, official-site, landing, or introduction pages, still verify the brand/navigation, topic-specific hero, media or visual panel, post-hero sections, and footer. Do not finish merely because src/App.tsx exists.",
                                imageToolModes.length > 0
                                    ? "For continuation, iteration, or human feedback requests, do not return finish before making at least one write_file, append_file, edit_file, or get_image action unless the user explicitly asks for no changes."
                                    : "For continuation, iteration, or human feedback requests, do not return finish before making at least one write_file, append_file, or edit_file action unless the user explicitly asks for no changes.",
                                "If the previous execution context shows the requested work is already complete, return a finish action instead of repeating the same action.",
                            ].join(" "),
                    },
                    {
                        role: "user",
                        content:
                            context.length > 0
                                ? `${goal}\n\nPrevious execution context:\n${context}`
                                : goal,
                    },
                ],
            },
            parse: parseAgentAction,
            outputName: "AgentAction",
            maxAttempts: 3,
            invalidResponseInstruction: [
                "For AgentAction correction, do not repeat a huge src/App.tsx response.",
                "write_file content over 6000 characters is invalid and will be rejected.",
                "If the previous response was too large, invalid, or truncated, switch to one small write_file action instead and do not continue the same large JSON.",
                "If you need to continue a long file, return one append_file action with the next small chunk.",
                "For continuation fixes, prefer one small edit_file action with exact oldText/newText.",
                ...(complexPageRequest && !routeShellFirst
                    ? [
                          "For complex pages, the next corrected action must be src/content.ts or src/App.css unless both have already been written successfully.",
                      ]
                    : []),
                ...(routeShellFirst
                    ? [
                          "For this route-shell-first request, the corrected action must edit src/App.tsx before content or CSS work.",
                      ]
                    : []),
                "Keep the corrected write_file content under 3000 characters; the platform will call you again for the next small step.",
            ].join(" "),
        });
    }
}
