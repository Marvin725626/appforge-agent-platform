import type { DesignPlan } from "@appforge/protocol";

type ProjectStylePage = {
    id: string;
    path: string;
    label: string;
};

export type LayoutPrimitive =
    | "full-bleed-stage"
    | "typography-led-opening"
    | "editorial-rail"
    | "asymmetric-split"
    | "story-band"
    | "timeline-flow"
    | "map-list-hybrid"
    | "workflow-lane"
    | "data-region"
    | "gallery-wall"
    | "media-break"
    | "dense-operations-shell";

function cssString(value: string): string {
    return JSON.stringify(value);
}

export function formatDesignPlanMetadataStyles(plan: DesignPlan): string {
    const primitives = deriveLayoutPrimitives(plan);
    const rhythm = plan.visualDNA.sectionRhythm.join(" / ");
    const motifs = plan.visualDNA.uniqueMotifs.join(" / ");

    return `/* appforge-design-plan-metadata:start */
:root {
    --project-composition: ${cssString(plan.visualDNA.composition)};
    --surface-strategy: ${plan.visualDNA.surfaceStrategy};
    --layout-primitives: ${cssString(primitives.join(" / "))};
    --section-rhythm: ${cssString(rhythm)};
    --unique-motifs: ${cssString(motifs)};
}
/* appforge-design-plan-metadata:end */`;
}

function radius(plan: DesignPlan, index: number, fallback: number): string {
    return `${plan.designTokens.radiusScale[index] ?? fallback}px`;
}

function spacing(plan: DesignPlan, index: number, fallback: number): string {
    return `${plan.designTokens.spacingScale[index] ?? fallback}px`;
}

function designText(plan: DesignPlan): string {
    return [
        plan.applicationType,
        plan.visualDNA.composition,
        plan.visualDNA.surfaceStrategy,
        plan.visualDNA.navigationPattern,
        plan.visualDNA.heroPattern,
        plan.visualDNA.sectionRhythm.join(" "),
        plan.visualDNA.typographyCharacter,
        plan.visualDNA.shapeLanguage,
        plan.visualDNA.mediaStrategy,
        plan.visualDNA.uniqueMotifs.join(" "),
    ]
        .join(" ")
        .toLowerCase();
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

function forbiddenText(plan: DesignPlan): string {
    return plan.visualDNA.forbiddenPatterns.join(" ").toLowerCase();
}

function conflictsWithForbidden(
    primitive: LayoutPrimitive,
    forbidden: string,
): boolean {
    if (!forbidden) {
        return false;
    }
    const conflictPatterns: Record<LayoutPrimitive, readonly RegExp[]> = {
        "full-bleed-stage": [/full.?bleed|cinematic|沉浸|全屏/u],
        "typography-led-opening": [/固定.*hero/u],
        "editorial-rail": [/editorial rail|杂志.*轨/u],
        "asymmetric-split": [/split|分栏|左右固定/u],
        "story-band": [/story band|故事带/u],
        "timeline-flow": [/timeline|时间线/u],
        "map-list-hybrid": [/map|地图|列表/u],
        "workflow-lane": [/workflow|流程/u],
        "data-region": [/data region|数据区/u],
        "gallery-wall": [/gallery|画廊/u],
        "media-break": [/media break|媒体断点/u],
        "dense-operations-shell": [/dense|operations shell|后台壳/u],
    };
    return conflictPatterns[primitive].some((pattern) => pattern.test(forbidden));
}

function pushPrimitive(
    primitives: LayoutPrimitive[],
    primitive: LayoutPrimitive,
    plan: DesignPlan,
): void {
    if (
        primitives.includes(primitive) ||
        conflictsWithForbidden(primitive, forbiddenText(plan))
    ) {
        return;
    }
    if (
        primitive === "dense-operations-shell" &&
        primitives.includes("typography-led-opening")
    ) {
        primitives.splice(primitives.indexOf("typography-led-opening"), 1);
    }
    if (
        primitive === "typography-led-opening" &&
        primitives.includes("dense-operations-shell")
    ) {
        return;
    }
    primitives.push(primitive);
}

export function deriveLayoutPrimitives(
    designPlan: DesignPlan,
): LayoutPrimitive[] {
    const text = designText(designPlan);
    const primitives: LayoutPrimitive[] = [];

    if (
        designPlan.visualDNA.density === "high" ||
        designPlan.applicationType === "dashboard" ||
        hasAny(text, [/后台|dashboard|operations|dense|监控|metrics|告警/u])
    ) {
        pushPrimitive(primitives, "dense-operations-shell", designPlan);
        pushPrimitive(primitives, "data-region", designPlan);
    }

    if (
        designPlan.applicationType === "game" ||
        hasAny(text, [/game|游戏|hud|cinematic|arena|tactical|战术|match/u])
    ) {
        pushPrimitive(primitives, "full-bleed-stage", designPlan);
        pushPrimitive(primitives, "asymmetric-split", designPlan);
        pushPrimitive(primitives, "media-break", designPlan);
    }

    if (
        hasAny(text, [/workflow|runtime|trace|debug|agent|saas|product|流程|调试/u])
    ) {
        pushPrimitive(primitives, "asymmetric-split", designPlan);
        pushPrimitive(primitives, "workflow-lane", designPlan);
        pushPrimitive(primitives, "data-region", designPlan);
    }

    if (
        hasAny(text, [/typography|editorial|cover|magazine|城市|文化|杂志|封面/u])
    ) {
        pushPrimitive(primitives, "typography-led-opening", designPlan);
        pushPrimitive(primitives, "editorial-rail", designPlan);
    }

    if (hasAny(text, [/story|故事|叙事|band/u])) {
        pushPrimitive(primitives, "story-band", designPlan);
    }
    if (hasAny(text, [/timeline|时间线|rhythm|节奏/u])) {
        pushPrimitive(primitives, "timeline-flow", designPlan);
    }
    if (hasAny(text, [/media|image|photo|visual|影像|图片|媒体/u])) {
        pushPrimitive(primitives, "media-break", designPlan);
    }
    if (hasAny(text, [/map|地图|route|itinerary|路线|地点|list/u])) {
        pushPrimitive(primitives, "map-list-hybrid", designPlan);
    }
    if (hasAny(text, [/gallery|wall|作品|图片墙/u])) {
        pushPrimitive(primitives, "gallery-wall", designPlan);
    }

    if (primitives.length === 0) {
        pushPrimitive(primitives, "typography-led-opening", designPlan);
        pushPrimitive(primitives, "story-band", designPlan);
    }

    if (designPlan.applicationType === "dashboard") {
        return primitives
            .filter((primitive) => primitive !== "story-band")
            .slice(0, 4);
    }

    return primitives.slice(0, 5);
}

export function formatLayoutPrimitivesForPrompt(
    designPlan: DesignPlan,
): string {
    return [
        "Available project layout primitives:",
        ...deriveLayoutPrimitives(designPlan).map(
            (primitive) => `- ${primitive}`,
        ),
        "Use these as optional shared layout capabilities, not as a checklist. You may create concise project-specific semantic classes when the DesignPlan needs them.",
    ].join("\n");
}

function primitiveStyles(
    primitive: LayoutPrimitive,
    plan: DesignPlan,
): string {
    const panelBackground =
        plan.visualDNA.surfaceStrategy === "open"
            ? "transparent"
            : "var(--surface-fill)";
    const panelBorder =
        plan.visualDNA.surfaceStrategy === "open"
            ? "0"
            : "1px solid var(--section-border)";
    const panelRadius =
        plan.visualDNA.surfaceStrategy === "open"
            ? radius(plan, 1, 4)
            : radius(plan, 3, 18);

    switch (primitive) {
        case "full-bleed-stage":
            return `.full-bleed-stage, .match-hud {
    min-height: clamp(30rem, 72vh, 48rem);
    display: grid;
    align-content: end;
    gap: var(--space-5);
    padding: clamp(2rem, 7vw, 6rem) var(--page-gutter);
    margin-inline: calc(var(--page-gutter) * -1);
    color: var(--foreground);
    background: radial-gradient(circle at 74% 18%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 24rem), var(--surface-fill);
}`;
        case "typography-led-opening":
            return `.typography-led-opening, .opening-broadsheet, .archive-ledger, .route-compass {
    display: grid;
    gap: var(--space-5);
    max-width: min(980px, 100%);
    padding-block: clamp(3rem, 9vw, 8rem);
}
.typography-led-opening h1, .opening-broadsheet h1, .archive-ledger h1, .route-compass h1 {
    max-width: 14ch;
    font-size: clamp(2.5rem, 8vw, 6.8rem);
}`;
        case "editorial-rail":
            return `.editorial-rail, .city-story-rail, .culture-route-line {
    display: grid;
    grid-template-columns: minmax(10rem, .34fr) minmax(0, 1fr);
    gap: clamp(1rem, 4vw, 4rem);
    align-items: start;
}`;
        case "asymmetric-split":
            return `.asymmetric-split, .agent-runtime-stage, .trace-flow {
    display: grid;
    grid-template-columns: minmax(0, .72fr) minmax(18rem, 1.28fr);
    gap: clamp(1.25rem, 5vw, 5rem);
    align-items: center;
}`;
        case "story-band":
            return `.story-band, .motif-band {
    display: grid;
    gap: var(--space-4);
    padding: clamp(1.5rem, 4vw, 3.5rem);
    background: ${panelBackground};
    border: ${panelBorder};
    border-radius: ${panelRadius};
    box-shadow: var(--surface-shadow);
}`;
        case "timeline-flow":
            return `.timeline-flow, .culture-timeline, .route-timeline {
    display: grid;
    gap: var(--space-4);
    border-left: 2px solid var(--section-border);
    padding-left: clamp(1rem, 3vw, 2rem);
}
.timeline-flow > *, .culture-timeline > *, .route-timeline > * { padding-block: var(--space-3); border-bottom: 1px solid var(--section-border); }`;
        case "map-list-hybrid":
            return `.map-list-hybrid, .map-panel {
    display: grid;
    grid-template-columns: minmax(12rem, .48fr) minmax(0, 1fr);
    gap: var(--space-5);
    align-items: start;
}`;
        case "workflow-lane":
            return `.workflow-lane, .trace-flow, .evidence-river {
    display: grid;
    gap: var(--space-3);
}
.workflow-lane > *, .trace-flow > *, .evidence-river {
    padding: var(--space-4);
    background: ${panelBackground};
    border: ${panelBorder};
    border-radius: ${panelRadius};
}`;
        case "data-region":
            return `.data-region, .operations-region, .data-table {
    width: 100%;
    display: grid;
    gap: var(--space-3);
}
.data-table { border-collapse: collapse; display: table; }
.data-table th, .data-table td { padding: .75rem .9rem; text-align: left; border-bottom: 1px solid var(--section-border); }
.data-table th { color: var(--accent-foreground); background: var(--accent); }`;
        case "gallery-wall":
            return `.gallery-wall {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    gap: var(--space-3);
}
.gallery-wall > * { min-height: 14rem; }`;
        case "media-break":
            return `.media-break, .media-panel, .page-media {
    display: grid;
    place-items: center;
    min-height: clamp(14rem, 32vw, 28rem);
    overflow: hidden;
    background: ${panelBackground};
    border: ${panelBorder};
    border-radius: ${panelRadius};
}
.page-image, .media-break img, .media-panel img { width: 100%; height: 100%; object-fit: cover; display: block; }`;
        case "dense-operations-shell":
            return `.dense-operations-shell, .dashboard-shell {
    display: grid;
    grid-template-columns: minmax(14rem, .28fr) minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--surface-fill);
    border: 1px solid var(--section-border);
    border-radius: ${radius(plan, 2, 10)};
}
.dense-operations-shell .kpi-tile, .dashboard-shell .kpi-tile, .dashboard-panel, .chart-frame, .activity-feed {
    padding: var(--space-4);
    background: var(--surface-fill);
    border: 1px solid var(--section-border);
    border-radius: ${radius(plan, 2, 10)};
}`;
    }
}

export function formatProjectStyles(input: {
    designPlan: DesignPlan;
    pages: readonly ProjectStylePage[];
}): string {
    const plan = input.designPlan;
    const colors = plan.designTokens.colorRoles;
    const primitives = deriveLayoutPrimitives(plan);
    const pageList = input.pages
        .map((page) => `${page.path}:${page.label}`)
        .join(", ");
    const openSurface = plan.visualDNA.surfaceStrategy === "open";
    const containedSurface = plan.visualDNA.surfaceStrategy === "contained";

    return `${formatDesignPlanMetadataStyles(plan)}
:root {
    --background: ${colors.background};
    --surface: ${colors.surface};
    --foreground: ${colors.foreground};
    --muted-foreground: ${colors.mutedForeground};
    --accent: ${colors.accent};
    --accent-foreground: ${colors.accentForeground};
    --radius-sm: ${radius(plan, 1, 4)};
    --radius-md: ${radius(plan, 2, 8)};
    --radius-lg: ${radius(plan, 3, 14)};
    --space-2: ${spacing(plan, 1, 8)};
    --space-3: ${spacing(plan, 2, 12)};
    --space-4: ${spacing(plan, 3, 16)};
    --space-5: ${spacing(plan, 4, 24)};
    --space-6: ${spacing(plan, 5, 32)};
    --space-7: ${spacing(plan, 6, 48)};
    --page-gutter: clamp(1rem, 4vw, 4.5rem);
    --content-width: ${containedSurface ? "min(1280px, calc(100% - 2rem))" : "min(1180px, calc(100% - 2rem))"};
    --section-border: color-mix(in srgb, var(--foreground) ${openSurface ? "10%" : "16%"}, transparent);
    --surface-fill: ${openSurface ? "transparent" : "color-mix(in srgb, var(--surface) 94%, var(--background))"};
    --surface-shadow: ${openSurface ? "none" : containedSurface ? "0 18px 48px rgba(0,0,0,.14)" : "0 12px 34px rgba(0,0,0,.1)"};
    font-family: Inter, "Noto Sans SC", "Noto Serif SC", system-ui, -apple-system, sans-serif;
    color: var(--foreground);
    background: var(--background);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
    margin: 0;
    min-width: 320px;
    overflow-x: hidden;
    color: var(--foreground);
    background: radial-gradient(circle at 12% -10%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 28rem), var(--background);
}
a { color: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}
.app-shell::before {
    content: "DesignPlan: ${plan.applicationType} | ${plan.visualDNA.surfaceStrategy} | ${pageList}";
    position: fixed;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}
.site-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    min-height: 64px;
    padding: .8rem var(--page-gutter);
    color: var(--foreground);
    background: ${openSurface ? "color-mix(in srgb, var(--background) 86%, transparent)" : "color-mix(in srgb, var(--surface) 94%, transparent)"};
    border-bottom: 1px solid var(--section-border);
    backdrop-filter: blur(18px);
    box-shadow: ${openSurface ? "none" : "0 14px 44px rgba(0,0,0,.12)"};
}
.brand-link { min-height: 44px; display: inline-flex; align-items: center; gap: .75rem; text-decoration: none; }
.brand-link > span:last-child { display: grid; gap: .1rem; }
.brand-link strong { font-size: 1.02rem; letter-spacing: .02em; }
.brand-link small { max-width: 34rem; color: var(--muted-foreground); }
.brand-mark {
    width: 2.55rem;
    height: 2.55rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${radius(plan, 2, 10)};
    box-shadow: ${openSurface ? "none" : "0 12px 32px color-mix(in srgb, var(--accent) 28%, transparent)"};
}
.brand-logo { width: 100%; height: 100%; display: block; object-fit: contain; padding: .2rem; }
.site-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .4rem; }
.nav-link {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: .62rem .9rem;
    color: var(--muted-foreground);
    border-radius: ${radius(plan, 2, 10)};
    text-decoration: none;
    font-weight: 800;
}
.nav-link:hover { color: var(--foreground); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.nav-link--active { color: var(--accent-foreground); background: var(--accent); }
.route-main {
    width: var(--content-width);
    margin: 0 auto;
    flex: 1;
}
.page-view {
    display: grid;
    gap: clamp(1.25rem, 3vw, 2.25rem);
    padding: clamp(1.8rem, 5vw, 4rem) 0 4rem;
    font-size: 16px;
}
.page-view p, .page-view li, .page-view td, .page-view th {
    font-size: clamp(.92rem, 1vw, 1rem);
    line-height: 1.68;
}
.page-view h1 {
    margin: 0;
    font-size: clamp(2rem, 5vw, 4.4rem);
    line-height: .98;
    letter-spacing: -.04em;
}
.page-view h2 {
    margin: 0;
    font-size: clamp(1.25rem, 2vw, 1.75rem);
    line-height: 1.18;
    letter-spacing: -.02em;
}
.page-view h3 { margin: 0; font-size: clamp(1.05rem, 1.4vw, 1.32rem); line-height: 1.22; }
.page-lead { margin: 0; max-width: 42rem; color: var(--muted-foreground); font-size: clamp(1.02rem, 1.5vw, 1.25rem); }
.eyebrow, .page-kicker, .tag, .hud-pill {
    width: fit-content;
    min-height: 2.25rem;
    display: inline-flex;
    align-items: center;
    gap: .45rem;
    padding: .42rem .7rem;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${radius(plan, 2, 10)};
    font-size: .78rem;
    font-weight: 900;
    letter-spacing: .08em;
    text-transform: uppercase;
}
.cta-row, .tag-list { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.site-footer {
    margin-top: auto;
    padding: 2rem var(--page-gutter);
    color: var(--muted-foreground);
    border-top: 1px solid var(--section-border);
}
${primitives.map((primitive) => primitiveStyles(primitive, plan)).join("\n")}
@media (max-width: 780px) {
    .site-header { position: static; align-items: flex-start; flex-direction: column; }
    .site-nav { justify-content: flex-start; }
    .route-main { width: min(100% - 1rem, 1180px); }
    .editorial-rail, .city-story-rail, .culture-route-line,
    .asymmetric-split, .agent-runtime-stage, .trace-flow,
    .map-list-hybrid, .map-panel,
    .dense-operations-shell, .dashboard-shell {
        grid-template-columns: 1fr;
    }
}
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
}
