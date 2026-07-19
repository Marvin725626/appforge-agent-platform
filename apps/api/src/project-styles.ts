import type { DesignPlan } from "@appforge/protocol";

type ProjectStylePage = {
    id: string;
    path: string;
    label: string;
};

function cssString(value: string): string {
    return JSON.stringify(value);
}

function radius(plan: DesignPlan, index: number, fallback: number): string {
    return `${plan.designTokens.radiusScale[index] ?? fallback}px`;
}

function spacing(plan: DesignPlan, index: number, fallback: number): string {
    return `${plan.designTokens.spacingScale[index] ?? fallback}px`;
}

export function formatProjectStyles(input: {
    designPlan: DesignPlan;
    pages: readonly ProjectStylePage[];
}): string {
    const plan = input.designPlan;
    const colors = plan.designTokens.colorRoles;
    const openSurface =
        plan.visualDNA.surfaceStrategy === "open" ||
        plan.visualDNA.surfaceStrategy === "mixed";
    const containedSurface =
        plan.visualDNA.surfaceStrategy === "contained";
    const angular =
        /angular|hud|tactical|sharp|rail|cut/iu.test(
            `${plan.visualDNA.shapeLanguage} ${plan.visualDNA.uniqueMotifs.join(" ")}`,
        );
    const editorial =
        plan.applicationType === "editorial" ||
        plan.applicationType === "institution";
    const dashboard = plan.applicationType === "dashboard";
    const game = plan.applicationType === "game";
    const rhythm = plan.visualDNA.sectionRhythm.join(" / ");
    const motifs = plan.visualDNA.uniqueMotifs.join(" / ");
    const pageList = input.pages
        .map((page) => `${page.path}:${page.label}`)
        .join(", ");

    return `:root {
    --project-composition: ${cssString(plan.visualDNA.composition)};
    --surface-strategy: ${plan.visualDNA.surfaceStrategy};
    --section-rhythm: ${cssString(rhythm)};
    --unique-motifs: ${cssString(motifs)};
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
    --section-border: color-mix(in srgb, var(--foreground) 16%, transparent);
    --shadow-soft: ${openSurface ? "none" : "0 22px 70px rgba(0,0,0,.14)"};
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
    background:
        radial-gradient(circle at 12% -10%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 28rem),
        linear-gradient(135deg, var(--background), color-mix(in srgb, var(--background) 86%, var(--surface)));
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
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border-bottom: 1px solid var(--section-border);
    backdrop-filter: blur(18px);
    box-shadow: ${openSurface ? "none" : "0 14px 44px rgba(0,0,0,.12)"};
}
.brand-link {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    gap: .75rem;
    text-decoration: none;
}
.brand-link > span:last-child { display: grid; gap: .1rem; }
.brand-link strong {
    font-size: 1.02rem;
    letter-spacing: ${game ? ".08em" : ".02em"};
    text-transform: ${game ? "uppercase" : "none"};
}
.brand-link small {
    max-width: 34rem;
    color: var(--muted-foreground);
}
.brand-mark {
    width: 2.55rem;
    height: 2.55rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${angular ? radius(plan, 1, 4) : radius(plan, 2, 10)};
    box-shadow: ${game || dashboard ? "none" : "0 12px 32px color-mix(in srgb, var(--accent) 28%, transparent)"};
}
.brand-logo { width: 100%; height: 100%; display: block; object-fit: contain; padding: .2rem; }
.site-nav { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .4rem; }
.nav-link {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    padding: .62rem .9rem;
    color: var(--muted-foreground);
    border-radius: ${angular ? radius(plan, 1, 4) : "999px"};
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
    font-size: clamp(2rem, ${game ? "4.8vw" : editorial ? "5.2vw" : "4.4vw"}, ${game ? "4rem" : "3.8rem"});
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
.page-hero {
    min-height: ${dashboard ? "auto" : "clamp(28rem, 58vh, 42rem)"};
    display: grid;
    grid-template-columns: minmax(0, ${editorial ? "1.05fr" : ".95fr"}) minmax(18rem, ${editorial ? ".95fr" : "1.05fr"});
    gap: clamp(1.5rem, 4vw, 4rem);
    align-items: center;
    padding: clamp(2rem, 5vw, 4.6rem);
    color: var(--foreground);
    background:
        linear-gradient(135deg, color-mix(in srgb, var(--surface) 82%, transparent), color-mix(in srgb, var(--background) 88%, transparent)),
        radial-gradient(circle at 80% 15%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 28rem);
    border: ${openSurface ? "0" : "1px solid var(--section-border)"};
    border-radius: ${openSurface ? "0" : radius(plan, 3, 18)};
    box-shadow: var(--shadow-soft);
    clip-path: ${angular ? "polygon(0 0, calc(100% - 1.2rem) 0, 100% 1.2rem, 100% 100%, 1.2rem 100%, 0 calc(100% - 1.2rem))" : "none"};
}
.page-copy { display: grid; align-content: center; gap: var(--space-4); max-width: 46rem; }
.page-kicker {
    width: fit-content;
    padding: .38rem .62rem;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${angular ? radius(plan, 1, 4) : "999px"};
    font-size: .78rem;
    font-weight: 900;
    letter-spacing: .11em;
    text-transform: uppercase;
}
.page-lead {
    margin: 0;
    max-width: 42rem;
    color: var(--muted-foreground);
    font-size: clamp(1.02rem, 1.5vw, 1.25rem);
}
.page-media {
    min-height: 18rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: ${angular ? radius(plan, 1, 4) : radius(plan, 3, 18)};
    border: 1px solid var(--section-border);
    background: color-mix(in srgb, var(--surface) 70%, var(--background));
}
.page-image {
    width: 100%;
    height: 100%;
    max-height: 34rem;
    object-fit: cover;
    display: block;
}
.editorial-flow, .story-band, .route-timeline, .culture-strip, .timeline, .steps,
.game-stage, .game-map, .game-rounds, .dashboard-shell, .commerce-stage,
.product-stage, .portfolio-wall, .feature-strip, .proof-row {
    display: grid;
    gap: var(--space-5);
    padding: clamp(1.25rem, 4vw, 3rem) 0;
    border-top: 1px solid var(--section-border);
}
.story-band, .game-stage, .dashboard-shell, .commerce-stage, .product-stage {
    grid-template-columns: ${dashboard ? "1fr" : "minmax(0, .9fr) minmax(0, 1.1fr)"};
    align-items: start;
}
.metric-grid, .tag-list, .cta-row, .game-sites, .proof-row, .feature-strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: stretch;
}
.metric, .tag, .hud-pill, .game-site, .proof-pill, .feature-chip {
    display: inline-flex;
    align-items: center;
    gap: .45rem;
    min-height: 2.35rem;
    padding: .55rem .75rem;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${angular ? radius(plan, 1, 4) : "999px"};
    font-weight: 850;
}
.callout, .quote, .media-panel, .dashboard-panel, .buy-panel, .profile-panel,
.game-slab, .game-rail, .chart-frame, .activity-feed {
    padding: clamp(1rem, 3vw, 1.75rem);
    color: var(--foreground);
    background: ${openSurface ? "transparent" : "var(--surface)"};
    border: 1px solid var(--section-border);
    border-radius: ${openSurface ? radius(plan, 1, 4) : radius(plan, 2, 12)};
    box-shadow: var(--shadow-soft);
}
.site-letter {
    display: inline-grid;
    place-items: center;
    min-width: 1.8rem;
    min-height: 1.8rem;
    color: var(--accent-foreground);
    background: var(--accent);
    border-radius: ${angular ? radius(plan, 1, 4) : "50%"};
}
.data-table { width: 100%; border-collapse: collapse; overflow: hidden; }
.data-table th, .data-table td {
    padding: .75rem .9rem;
    text-align: left;
    border-bottom: 1px solid var(--section-border);
}
.data-table th {
    color: var(--accent-foreground);
    background: var(--accent);
}
.data-table td {
    color: var(--foreground);
    background: color-mix(in srgb, var(--surface) 72%, transparent);
}
.site-footer {
    margin-top: auto;
    padding: 2rem var(--page-gutter);
    color: var(--muted-foreground);
    border-top: 1px solid var(--section-border);
}
@media (max-width: 780px) {
    .site-header { position: static; align-items: flex-start; flex-direction: column; }
    .site-nav { justify-content: flex-start; }
    .route-main { width: min(100% - 1rem, 1180px); }
    .page-hero, .story-band, .game-stage, .dashboard-shell, .commerce-stage, .product-stage {
        grid-template-columns: 1fr;
        padding-inline: 1rem;
    }
    .page-media { min-height: 14rem; }
}
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
}
