import type { DesignPlan } from "@appforge/protocol";

import type { StablePageContent } from "./stable-page-content.js";
import { deriveStableLayoutFamily } from "./layout-family-policy.js";

// APPFORGE_PHASE4_LAYOUT_FAMILIES_V9

export type StablePageMedia = {
    heroPath?: string;
    heroAlt: string;
};

type PaletteTokens = {
    background: string;
    backgroundAlt: string;
    surface: string;
    surfaceStrong: string;
    foreground: string;
    muted: string;
    line: string;
    accent: string;
    accentAlt: string;
    accentForeground: string;
};

const PALETTES: Record<StablePageContent["theme"]["palette"], PaletteTokens> = {
    "tactical-amber": {
        background: "#05070b",
        backgroundAlt: "#09111b",
        surface: "#0b131d",
        surfaceStrong: "#111d2a",
        foreground: "#f4f7fb",
        muted: "#9aa9bc",
        line: "rgba(142, 184, 220, 0.24)",
        accent: "#ffb347",
        accentAlt: "#55d9ff",
        accentForeground: "#171109",
    },
    "ocean-cyan": {
        background: "#041019",
        backgroundAlt: "#071a26",
        surface: "#0a202d",
        surfaceStrong: "#0d2a3a",
        foreground: "#eefaff",
        muted: "#8fb6c7",
        line: "rgba(108, 207, 233, 0.24)",
        accent: "#58e2ff",
        accentAlt: "#7cf7bf",
        accentForeground: "#031218",
    },
    "violet-signal": {
        background: "#0b0812",
        backgroundAlt: "#141022",
        surface: "#19142a",
        surfaceStrong: "#241b38",
        foreground: "#f9f5ff",
        muted: "#b4a8ca",
        line: "rgba(186, 156, 255, 0.25)",
        accent: "#b693ff",
        accentAlt: "#ff8fc7",
        accentForeground: "#130d20",
    },
    "forest-lime": {
        background: "#07100c",
        backgroundAlt: "#0c1a13",
        surface: "#102218",
        surfaceStrong: "#173022",
        foreground: "#f1fff6",
        muted: "#9db8a6",
        line: "rgba(142, 221, 163, 0.22)",
        accent: "#a8ef7a",
        accentAlt: "#65d7b0",
        accentForeground: "#091108",
    },
    "sand-coral": {
        background: "#17110e",
        backgroundAlt: "#241915",
        surface: "#2e201a",
        surfaceStrong: "#3b2820",
        foreground: "#fff8ef",
        muted: "#c8b0a1",
        line: "rgba(255, 201, 169, 0.25)",
        accent: "#ff9e7a",
        accentAlt: "#f5d285",
        accentForeground: "#20100b",
    },
    monochrome: {
        background: "#0b0b0b",
        backgroundAlt: "#141414",
        surface: "#1a1a1a",
        surfaceStrong: "#242424",
        foreground: "#f5f3ed",
        muted: "#aaa79f",
        line: "rgba(255, 255, 255, 0.16)",
        accent: "#f3eee2",
        accentAlt: "#a9a9a9",
        accentForeground: "#111111",
    },
    "crimson-night": {
        background: "#0e080b",
        backgroundAlt: "#190d12",
        surface: "#211117",
        surfaceStrong: "#301720",
        foreground: "#fff4f7",
        muted: "#c2a0aa",
        line: "rgba(255, 129, 163, 0.22)",
        accent: "#ff6f91",
        accentAlt: "#ffbd70",
        accentForeground: "#21090f",
    },
};

const FONT_PAIRS: Record<
    StablePageContent["theme"]["fontPair"],
    { display: string; body: string; data: string }
> = {
    "system-modern": {
        display: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        body: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        data: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
    "editorial-serif": {
        display: 'Georgia, "Songti SC", "Noto Serif SC", serif',
        body: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        data: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
    "condensed-mono": {
        display: '"Arial Narrow", "Roboto Condensed", "Noto Sans SC", sans-serif',
        body: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        data: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
    "geometric-sans": {
        display: '"Trebuchet MS", Inter, "Noto Sans SC", sans-serif',
        body: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        data: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
    },
};

function js(value: unknown): string {
    return JSON.stringify(value, null, 4);
}

function cssString(value: string): string {
    return JSON.stringify(value);
}

export function createStableAppSource(
    content: StablePageContent,
    media: StablePageMedia,
    designPlan?: DesignPlan,
): string {
    const layoutPlan = deriveStableLayoutFamily(content, designPlan);
    const pageJson = js({
        ...content,
        layout: layoutPlan,
        media: {
            heroPath: media.heroPath ?? "",
            heroAlt: media.heroAlt,
        },
    });

    return `type PageItem = {
    title: string;
    meta: string;
    description: string;
    value: string;
    status: string;
};

type PageSection = {
    id: string;
    kind: "feature-list" | "timeline" | "matrix" | "gallery" | "data-table" | "story" | "quotes" | "faq" | "metrics" | "map";
    eyebrow: string;
    title: string;
    description: string;
    items: PageItem[];
};

type PageModel = {
    version: 1;
    applicationType: "editorial" | "institution" | "dashboard" | "commerce" | "product" | "portfolio" | "game" | "custom";
    templateVariant: string;
    layout: {
    family: string;
    primaryPrimitive: "full-bleed-stage" | "editorial-rail" | "split-narrative" | "workflow-lane" | "data-region" | "gallery-wall" | "map-list-hybrid" | "timeline-lane" | "asymmetric-media-break";
    primitives: string[];
    heroMode: "full-bleed" | "split" | "compact" | "status";
    navigationMode: "top" | "side" | "minimal";
    surfaceMode: "open" | "contained" | "mixed";
    motif: "signal-rail" | "route-line" | "status-band" | "chapter-index" | "media-cut" | "data-spine";
    sectionOrder: PageSection["kind"][];
    evidence: string[];
  };
  theme: { palette: string; fontPair: string; density: string };
    brand: {
        name: string;
        kicker: string;
        title: string;
        summary: string;
        primaryAction: string;
        secondaryAction: string;
        statusLabel: string;
    };
    hero: { imagePrompt: string; imageAlt: string; stats: Array<{ label: string; value: string }> };
    sections: PageSection[];
    footer: { statement: string; links: string[] };
    media: { heroPath: string; heroAlt: string };
};

const page = ${pageJson} as PageModel;

function HeroMedia() {
    if (!page.media.heroPath) {
        return <div className="hero-art hero-art--fallback" role="img" aria-label={page.media.heroAlt}><span /></div>;
    }

    return (
        <figure className="hero-art">
            <img src={page.media.heroPath} alt={page.media.heroAlt} />
            <figcaption>{page.brand.statusLabel}</figcaption>
        </figure>
    );
}

function StatBand() {
    return (
        <div className="stat-band" aria-label="页面关键信息">
            {page.hero.stats.map((stat) => (
                <div className="stat-readout" key={stat.label}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                </div>
            ))}
        </div>
    );
}

function SectionHeading({ section, index }: { section: PageSection; index: number }) {
    return (
        <header className="section-heading">
            <p className="eyebrow">{section.eyebrow || \`SECTION \${String(index + 1).padStart(2, "0")}\`}</p>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
        </header>
    );
}

function FeatureList({ section }: { section: PageSection }) {
    return (
        <div className="feature-rail">
            {section.items.map((item, index) => (
                <article className="feature-row" key={item.title}>
                    <span className="item-index">{String(index + 1).padStart(2, "0")}</span>
                    <div><h3>{item.title}</h3><p>{item.description}</p></div>
                    <div className="item-meta"><b>{item.value || item.meta}</b><span>{item.status}</span></div>
                </article>
            ))}
        </div>
    );
}

function Timeline({ section }: { section: PageSection }) {
    return (
        <ol className="timeline-rail">
            {section.items.map((item, index) => (
                <li key={item.title}>
                    <span className="timeline-marker">{String(index + 1).padStart(2, "0")}</span>
                    <div><p className="item-label">{item.meta}</p><h3>{item.title}</h3><p>{item.description}</p></div>
                    <strong>{item.status || item.value}</strong>
                </li>
            ))}
        </ol>
    );
}

function Matrix({ section }: { section: PageSection }) {
    return (
        <div className="matrix-board">
            <div className="matrix-head"><span>编号</span><span>主题</span><span>说明</span><span>状态</span></div>
            {section.items.map((item, index) => (
                <div className="matrix-row" key={item.title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <b>{item.status || item.value}</b>
                </div>
            ))}
        </div>
    );
}

function Gallery({ section }: { section: PageSection }) {
    return (
        <div className="gallery-flow">
            {section.items.map((item, index) => (
                <article className="gallery-piece" key={item.title}>
                    <div className="gallery-visual" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span></div>
                    <p className="item-label">{item.meta}</p>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                </article>
            ))}
        </div>
    );
}

function DataTable({ section }: { section: PageSection }) {
    return (
        <div className="table-wrap">
            <table>
                <thead><tr><th>项目</th><th>说明</th><th>数值</th><th>状态</th></tr></thead>
                <tbody>{section.items.map((item) => (
                    <tr key={item.title}><th>{item.title}</th><td>{item.description}</td><td>{item.value}</td><td><span>{item.status}</span></td></tr>
                ))}</tbody>
            </table>
        </div>
    );
}

function Story({ section }: { section: PageSection }) {
    return (
        <div className="story-flow">
            {section.items.map((item, index) => (
                <article key={item.title}>
                    <p className="item-label">{item.meta || \`0\${index + 1}\`}</p>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                </article>
            ))}
        </div>
    );
}

function Quotes({ section }: { section: PageSection }) {
    return (
        <div className="quote-flow">
            {section.items.map((item) => (
                <blockquote key={item.title}><p>“{item.description}”</p><footer><strong>{item.title}</strong><span>{item.meta}</span></footer></blockquote>
            ))}
        </div>
    );
}

function Faq({ section }: { section: PageSection }) {
    return (
        <div className="faq-flow">
            {section.items.map((item, index) => (
                <details key={item.title} open={index === 0}><summary>{item.title}</summary><p>{item.description}</p></details>
            ))}
        </div>
    );
}

function dashboardMetricKey(item: PageItem, index: number): string {
    const text = item.title + " " + item.meta + " " + item.description;
    if (/\bCPU\b|处理器/i.test(text)) return "cpu";
    if (/内存|memory/i.test(text)) return "memory";
    if (/请求.{0,8}延迟|延迟|latency|P95/i.test(text)) return "latency";
    return "metric-" + String(index + 1);
}

function Metrics({ section, dashboard = false }: { section: PageSection; dashboard?: boolean }) {
    return (
        <div className={dashboard ? "metric-rail metric-rail--dashboard" : "metric-rail"}>
            {section.items.map((item, index) => (
                <article
                    key={item.title}
                    {...(dashboard ? { "data-appforge-metric": dashboardMetricKey(item, index) } : {})}
                >
                    <span>{item.title}</span>
                    <strong>{item.value || item.status}</strong>
                    <p>{item.description}</p>
                    {dashboard ? <small>{item.meta || item.status}</small> : null}
                </article>
            ))}
        </div>
    );
}

function MapSection({ section }: { section: PageSection }) {
    return (
        <div className="map-board">
            <div className="map-surface" aria-label="主题点位示意图">
                {section.items.map((item, index) => <span key={item.title} style={{ left: \`\${18 + (index * 23) % 70}%\`, top: \`\${18 + (index * 31) % 62}%\` }}><i />{String(index + 1).padStart(2, "0")}</span>)}
            </div>
            <div className="map-legend">{section.items.map((item, index) => <div key={item.title}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.title}</strong>{item.description}</span></div>)}</div>
        </div>
    );
}

function SectionBody({ section }: { section: PageSection }) {
    switch (section.kind) {
        case "timeline": return <Timeline section={section} />;
        case "matrix": return <Matrix section={section} />;
        case "gallery": return <Gallery section={section} />;
        case "data-table": return <DataTable section={section} />;
        case "story": return <Story section={section} />;
        case "quotes": return <Quotes section={section} />;
        case "faq": return <Faq section={section} />;
        case "metrics": return <Metrics section={section} />;
        case "map": return <MapSection section={section} />;
        default: return <FeatureList section={section} />;
    }
}

function ContentSections({ sections = page.sections, startIndex = 0 }: { sections?: PageSection[]; startIndex?: number }) {
    return <>{sections.map((section, index) => <section className={"content-section content-section--" + section.kind} id={section.id} key={section.id}><SectionHeading section={section} index={startIndex + index} /><SectionBody section={section} /></section>)}</>;
}

function PrimaryNavigation() {
    return (
        <nav className="primary-nav" aria-label="页面导航">
            <a href="#top">概览</a>
            {page.sections.slice(0, 4).map((section) => <a href={\`#\${section.id}\`} key={section.id}>{section.title}</a>)}
        </nav>
    );
}

function StandardHeader() {
    return (
        <header className="site-header">
            <a className="brand-lockup" href="#top"><span>{page.brand.name.slice(0, 2)}</span><strong>{page.brand.name}</strong></a>
            <PrimaryNavigation />
            <span className="status-signal"><i />{page.brand.statusLabel}</span>
        </header>
    );
}

function Hero({ split = false }: { split?: boolean }) {
    return (
        <section className={split ? "hero hero--split" : "hero"} id="top">
            <div className="hero-copy">
                <p className="eyebrow">{page.brand.kicker}</p>
                <h1>{page.brand.title}</h1>
                <p className="hero-summary">{page.brand.summary}</p>
                <div className="hero-actions"><a className="action action--primary" href={\`#\${page.sections[0]?.id ?? "content"}\`}>{page.brand.primaryAction}</a><a className="action action--secondary" href={\`#\${page.sections[1]?.id ?? page.sections[0]?.id ?? "content"}\`}>{page.brand.secondaryAction}</a></div>
            </div>
            <HeroMedia />
        </section>
    );
}

function orderedSections(): PageSection[] {
  const ranks = new Map(page.layout.sectionOrder.map((kind, index) => [kind, index]));
  return [...page.sections].sort((left, right) => (ranks.get(left.kind) ?? 99) - (ranks.get(right.kind) ?? 99));
}
function LayoutMotif() {
  return <div className={"layout-motif layout-motif--" + page.layout.motif} data-appforge-layout-motif={page.layout.motif} aria-hidden="true"><span /><span /><span /><b>{page.layout.family}</b></div>;
}
function LayoutHeader() {
  if (page.layout.navigationMode === "minimal") return <StandardHeader />;
  return <StandardHeader />;
}
function FullBleedStageLayout() {
  return <><LayoutHeader /><main className="layout-stage"><Hero /><LayoutMotif /><StatBand /><ContentSections sections={orderedSections()} /></main></>;
}
function EditorialRailLayout() {
  const sections = orderedSections();
  return <><LayoutHeader /><main className="layout-editorial-rail"><Hero /><LayoutMotif /><aside className="layout-rail-index">{sections.map((section, index) => <a href={"#" + section.id} key={section.id}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</a>)}</aside><div className="layout-rail-content"><ContentSections sections={sections} /></div></main></>;
}
function SplitNarrativeLayout() {
  const sections = orderedSections();
  const lead = sections[0];
  return <><LayoutHeader /><main className="layout-split-narrative"><Hero split /><LayoutMotif />{lead ? <section className="layout-lead-section"><SectionHeading section={lead} index={0} /><SectionBody section={lead} /></section> : null}<ContentSections sections={sections.slice(1)} startIndex={1} /></main></>;
}
function WorkflowLaneLayout() {
  const sections = orderedSections();
  return <><LayoutHeader /><main className="layout-workflow"><Hero split /><LayoutMotif /><div className="workflow-spine" aria-hidden="true">{sections.map((section, index) => <span key={section.id}>{String(index + 1).padStart(2, "0")}</span>)}</div><ContentSections sections={sections} /></main></>;
}
function DataRegionLayout() {
  const sections = orderedSections();
  const metricsSection = sections.find((section) => section.kind === "metrics");
  const remaining = metricsSection ? sections.filter((section) => section.id !== metricsSection.id) : sections;
  return <div className="dashboard-shell layout-data-region"><aside className="dashboard-sidebar"><a className="brand-lockup" href="#top"><span>{page.brand.name.slice(0, 2)}</span><strong>{page.brand.name}</strong></a><PrimaryNavigation /><LayoutMotif /><div className="sidebar-status"><i />{page.brand.statusLabel}</div></aside><main className="dashboard-main"><header className="dashboard-topbar"><div><span>Layout family</span><strong>{page.layout.family}</strong></div><div><span>Data refresh</span><strong>{page.hero.stats.find((stat) => /刷新|refresh/i.test(stat.label))?.value || "10s"}</strong></div></header><section className="dashboard-overview" id="top" data-appforge-role="dashboard-overview"><div className="dashboard-overview-copy"><p className="eyebrow">{page.brand.kicker}</p><h1>{page.brand.title}</h1><p>{page.brand.summary}</p></div><StatBand />{metricsSection ? <div className="dashboard-core-metrics"><Metrics section={metricsSection} dashboard /></div> : null}</section><ContentSections sections={remaining} startIndex={metricsSection ? 1 : 0} /></main></div>;
}
function GalleryWallLayout() {
  return <><LayoutHeader /><main className="layout-gallery-wall"><Hero /><LayoutMotif /><ContentSections sections={orderedSections()} /></main></>;
}
function MapListHybridLayout() {
  const sections = orderedSections();
  return <><LayoutHeader /><main className="layout-map-list"><Hero split /><LayoutMotif /><div className="map-list-frame"><div className="map-list-map"><span /><span /><span /></div><div className="map-list-list"><ContentSections sections={sections} /></div></div></main></>;
}
function TimelineLaneLayout() {
  return <><LayoutHeader /><main className="layout-timeline-lane"><Hero /><LayoutMotif /><ContentSections sections={orderedSections()} /></main></>;
}
function DashboardAdaptiveLayout() {
  const sections = orderedSections();
  const metricsSection = sections.find((section) => section.kind === "metrics");
  const remaining = metricsSection ? sections.filter((section) => section.id !== metricsSection.id) : sections;
  if (page.layout.primaryPrimitive === "data-region") return <DataRegionLayout />;
  if (page.layout.primaryPrimitive === "workflow-lane") return <><StandardHeader /><main className="dashboard-variant dashboard-variant--incident"><section className="dashboard-overview" id="top"><div className="dashboard-overview-copy"><p className="eyebrow">{page.brand.kicker}</p><h1>{page.brand.title}</h1><p>{page.brand.summary}</p></div><StatBand />{metricsSection ? <Metrics section={metricsSection} dashboard /> : null}</section><div className="workflow-spine" aria-hidden="true">{remaining.map((section, index) => <span key={section.id}>{String(index + 1).padStart(2, "0")}</span>)}</div><ContentSections sections={remaining} startIndex={metricsSection ? 1 : 0} /></main></>;
  if (page.layout.primaryPrimitive === "editorial-rail") return <><StandardHeader /><main className="dashboard-variant dashboard-variant--trend"><section className="dashboard-overview" id="top"><div className="dashboard-overview-copy"><p className="eyebrow">{page.brand.kicker}</p><h1>{page.brand.title}</h1><p>{page.brand.summary}</p></div>{metricsSection ? <Metrics section={metricsSection} dashboard /> : null}</section><LayoutMotif /><div className="dashboard-trend-grid"><aside>{page.hero.stats.map((stat) => <span key={stat.label}><b>{stat.value}</b>{stat.label}</span>)}</aside><div><ContentSections sections={remaining} startIndex={metricsSection ? 1 : 0} /></div></div></main></>;
  return <><StandardHeader /><main className="dashboard-variant dashboard-variant--table"><section className="dashboard-overview" id="top"><div className="dashboard-overview-copy"><p className="eyebrow">{page.brand.kicker}</p><h1>{page.brand.title}</h1><p>{page.brand.summary}</p></div>{metricsSection ? <Metrics section={metricsSection} dashboard /> : null}</section><ContentSections sections={remaining} startIndex={metricsSection ? 1 : 0} /></main></>;
}
function DesignDrivenLayout() {
  if (page.applicationType === "dashboard") return <DashboardAdaptiveLayout />;
  switch (page.layout.primaryPrimitive) {
    case "full-bleed-stage": return <FullBleedStageLayout />;
    case "editorial-rail": return <EditorialRailLayout />;
    case "split-narrative": return <SplitNarrativeLayout />;
    case "workflow-lane": return <WorkflowLaneLayout />;
    case "data-region": return <DataRegionLayout />;
    case "gallery-wall": return <GalleryWallLayout />;
    case "map-list-hybrid": return <MapListHybridLayout />;
    case "timeline-lane": return <TimelineLaneLayout />;
    case "asymmetric-media-break": return <GalleryWallLayout />;
    default: return <SplitNarrativeLayout />;
  }
}
/* APPFORGE_PHASE4_RUNTIME_LAYOUT_TRACE_V9_4_1
 * Diagnostic-only instrumentation. This does not change layout selection.
 */
/* APPFORGE_PHASE4_RUNTIME_ROUTING_LABELS_V9_4_2
 * Diagnostic label mirrors the actual dashboard primitive branch selected at runtime.
 */
function resolveAppforgeRendererName() {
  if (page.applicationType === "dashboard") {
    switch (page.layout.primaryPrimitive) {
      case "data-region": return "DashboardAdaptiveLayout:data-region";
      case "workflow-lane": return "DashboardAdaptiveLayout:workflow-lane";
      case "editorial-rail": return "DashboardAdaptiveLayout:editorial-rail";
      case "map-list-hybrid": return "DashboardAdaptiveLayout:map-list-hybrid";
      default: return "DashboardAdaptiveLayout:" + page.layout.primaryPrimitive;
    }
  }
  switch (page.layout.primaryPrimitive) {
    case "full-bleed-stage": return "FullBleedStageLayout";
    case "editorial-rail": return "EditorialRailLayout";
    case "split-narrative": return "SplitNarrativeLayout";
    case "workflow-lane": return "WorkflowLaneLayout";
    case "data-region": return "DataRegionLayout";
    case "gallery-wall": return "GalleryWallLayout";
    case "map-list-hybrid": return "MapListHybridLayout";
    case "timeline-lane": return "TimelineLaneLayout";
    case "asymmetric-media-break": return "GalleryWallLayout";
    default: return "SplitNarrativeLayout";
  }
}
function PageLayout() { return <DesignDrivenLayout />; }

export function App() {
    return (
        <div className={\`stable-app stable-app--\${page.applicationType} stable-app--\${page.templateVariant} layout-family--\${page.layout.family} primitive--\${page.layout.primaryPrimitive} surface--\${page.layout.surfaceMode} hero-mode--\${page.layout.heroMode} density--\${page.theme.density}\`} data-appforge-application-type={page.applicationType} data-appforge-layout-family={page.layout.family} data-appforge-layout-primitive={page.layout.primaryPrimitive} data-appforge-renderer={resolveAppforgeRendererName()}>
            <div className="ambient-layer" aria-hidden="true" />
            <PageLayout />
            <footer className="site-footer"><div><strong>{page.brand.name}</strong><p>{page.footer.statement}</p></div><nav aria-label="页脚导航">{page.footer.links.map((link) => <a href="#top" key={link}>{link}</a>)}</nav><span>{page.brand.statusLabel}</span></footer>
        </div>
    );
}
`;
}

export function createStableMainSource(): string {
    return `import React from "react";
import { createRoot } from "react-dom/client";

import "./App.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
`;
}

export function createStableCssSource(
    content: StablePageContent,
    designPlan?: DesignPlan,
): string {
    const palette = PALETTES[content.theme.palette];
    const fonts = FONT_PAIRS[content.theme.fontPair];
    const layoutPlan = deriveStableLayoutFamily(content, designPlan);
  const composition = designPlan?.visualDNA.composition ?? content.templateVariant;
    const rhythm = designPlan?.visualDNA.sectionRhythm.join(" / ") ?? content.sections.map((section) => section.title).join(" / ");
    const motifs = designPlan?.visualDNA.uniqueMotifs.join(" / ") ?? content.sections.map((section) => section.kind).join(" / ");
    const radius = content.applicationType === "game" || content.applicationType === "dashboard" ? "2px" : "12px";

    return `:root {
    --project-composition: ${cssString(composition)};
    --surface-strategy: ${designPlan?.visualDNA.surfaceStrategy ?? "mixed"};
    --layout-family: ${cssString(layoutPlan.family)};
  --hero-mode: ${cssString(layoutPlan.heroMode)};
  --navigation-mode: ${cssString(layoutPlan.navigationMode)};
  --motif-kind: ${cssString(layoutPlan.motif)};
  --layout-primitives: ${cssString(layoutPlan.primitives.join(" / "))};
    --section-rhythm: ${cssString(rhythm)};
    --unique-motifs: ${cssString(motifs)};
    --bg: ${palette.background};
    --bg-alt: ${palette.backgroundAlt};
    --surface: ${palette.surface};
    --surface-strong: ${palette.surfaceStrong};
    --text: ${palette.foreground};
    --muted: ${palette.muted};
    --line: ${palette.line};
    --accent: ${palette.accent};
    --accent-alt: ${palette.accentAlt};
    --accent-foreground: ${palette.accentForeground};
    --font-display: ${fonts.display};
    --font-body: ${fonts.body};
    --font-data: ${fonts.data};
    --radius: ${radius};
    color: var(--text);
    background: var(--bg);
    font-family: var(--font-body);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; background: var(--bg); }
button, input { font: inherit; }
a { color: inherit; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent-alt); outline-offset: 4px; }

.stable-app { position: relative; min-height: 100vh; overflow-x: hidden; background: radial-gradient(circle at 78% 6%, color-mix(in srgb, var(--accent-alt) 15%, transparent), transparent 28rem), linear-gradient(180deg, var(--bg), var(--bg-alt) 48%, var(--bg)); }
.ambient-layer { position: fixed; inset: 0; pointer-events: none; opacity: .22; background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(circle at center, black, transparent 88%); }
.site-header, main, .site-footer, .dashboard-shell { position: relative; z-index: 1; }
.site-header { position: sticky; top: 0; z-index: 20; min-height: 72px; display: grid; grid-template-columns: minmax(180px, auto) 1fr auto; align-items: center; gap: 24px; padding: 12px clamp(18px, 4vw, 56px); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 86%, transparent); backdrop-filter: blur(16px); }
.brand-lockup { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; }
.brand-lockup > span { display: grid; width: 42px; height: 42px; place-items: center; background: var(--accent); color: var(--accent-foreground); font-family: var(--font-data); font-weight: 900; clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px); }
.brand-lockup strong { font-family: var(--font-display); font-size: .9rem; letter-spacing: .08em; }
.primary-nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px; }
.primary-nav a { padding: 10px 12px; color: var(--muted); text-decoration: none; font-size: .76rem; }
.primary-nav a:hover { color: var(--text); background: color-mix(in srgb, var(--accent-alt) 9%, transparent); }
.status-signal, .sidebar-status { display: inline-flex; align-items: center; gap: 8px; color: var(--accent-alt); font: 700 .68rem var(--font-data); letter-spacing: .12em; }
.status-signal i, .sidebar-status i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-alt); box-shadow: 0 0 16px var(--accent-alt); animation: pulse 1.8s ease-in-out infinite; }
main { width: min(1480px, 100%); margin: 0 auto; padding: 0 clamp(18px, 4vw, 56px) 72px; }
.hero { position: relative; display: grid; align-items: center; gap: clamp(34px, 7vw, 92px); min-height: min(820px, calc(100vh - 72px)); padding: clamp(76px, 10vw, 150px) 0 70px; border-bottom: 1px solid var(--line); }
.hero--split { grid-template-columns: minmax(0, 1fr) minmax(320px, .82fr); }
.hero-copy { position: relative; z-index: 2; }
.eyebrow, .item-label { margin: 0; color: var(--accent-alt); font: 700 .7rem var(--font-data); letter-spacing: .2em; text-transform: uppercase; }
h1, h2, h3 { font-family: var(--font-display); }
h1 { max-width: 14ch; margin: 14px 0 0; font-size: clamp(3rem, 7vw, 7rem); line-height: .92; letter-spacing: -.045em; }
.hero-summary { max-width: 68ch; margin: 25px 0 0; color: var(--muted); font-size: clamp(1rem, 1.4vw, 1.2rem); line-height: 1.85; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
.action { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; padding: 0 22px; border: 1px solid var(--line); text-decoration: none; font-weight: 800; }
.action--primary { background: var(--accent); color: var(--accent-foreground); border-color: var(--accent); }
.action--secondary { background: color-mix(in srgb, var(--surface) 88%, transparent); }
.hero-art { position: relative; min-height: 420px; margin: 0; overflow: hidden; border: 1px solid var(--line); background: linear-gradient(145deg, var(--surface-strong), var(--bg)); clip-path: polygon(20px 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%, 0 20px); }
.hero-art img { width: 100%; height: 100%; min-height: 420px; object-fit: cover; display: block; filter: saturate(.9) contrast(1.05); }
.hero-art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 48%, color-mix(in srgb, var(--bg) 72%, transparent)); pointer-events: none; }
.hero-art figcaption { position: absolute; z-index: 2; right: 18px; bottom: 16px; color: var(--accent-alt); font: 700 .66rem var(--font-data); letter-spacing: .14em; }
.hero-art--fallback { display: grid; place-items: center; background: radial-gradient(circle at 60% 36%, color-mix(in srgb, var(--accent-alt) 30%, transparent), transparent 24%), linear-gradient(145deg, var(--surface-strong), var(--bg)); }
.hero-art--fallback span { width: 44%; aspect-ratio: 1; border: 1px solid var(--accent); transform: rotate(45deg); box-shadow: 0 0 0 28px color-mix(in srgb, var(--accent-alt) 8%, transparent), 0 0 80px color-mix(in srgb, var(--accent) 20%, transparent); }
.stat-band { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; border: 1px solid var(--line); background: var(--line); }
.stat-readout { display: grid; gap: 9px; padding: 20px; background: var(--surface); }
.stat-readout span { color: var(--muted); font: .68rem var(--font-data); letter-spacing: .12em; }
.stat-readout strong { color: var(--accent); font: 800 1rem var(--font-data); overflow-wrap: anywhere; }
.content-section { padding: clamp(76px, 9vw, 126px) 0; border-bottom: 1px solid var(--line); }
.section-heading { display: grid; gap: 13px; max-width: 780px; margin-bottom: 34px; }
.section-heading h2 { margin: 0; font-size: clamp(2rem, 4.2vw, 4.7rem); line-height: 1; }
.section-heading > p:last-child { margin: 0; color: var(--muted); line-height: 1.8; }
.feature-rail, .timeline-rail, .matrix-board { border: 1px solid var(--line); background: var(--line); }
.feature-rail { display: grid; gap: 1px; }
.feature-row { display: grid; grid-template-columns: 64px 1fr minmax(120px, auto); gap: 22px; align-items: center; padding: 22px; background: var(--surface); }
.item-index { color: var(--accent-alt); font: 800 1rem var(--font-data); }
.feature-row h3, .gallery-piece h3, .story-flow h3 { margin: 0 0 8px; font-size: 1.24rem; }
.feature-row p, .gallery-piece p, .story-flow p, .timeline-rail p, .metric-rail p { margin: 0; color: var(--muted); line-height: 1.72; }
.item-meta { display: grid; justify-items: end; gap: 6px; font-family: var(--font-data); }
.item-meta b { color: var(--accent); }
.item-meta span { color: var(--muted); font-size: .68rem; }
.timeline-rail { list-style: none; margin: 0; padding: 0; }
.timeline-rail li { display: grid; grid-template-columns: 58px 1fr auto; gap: 22px; align-items: start; padding: 24px; background: var(--surface); border-bottom: 1px solid var(--line); }
.timeline-rail li:last-child { border-bottom: 0; }
.timeline-marker { display: grid; width: 40px; height: 40px; place-items: center; border: 1px solid var(--accent); color: var(--accent); font: 700 .72rem var(--font-data); }
.timeline-rail h3 { margin: 7px 0 8px; }
.timeline-rail li > strong { color: var(--accent-alt); font: 700 .7rem var(--font-data); }
.matrix-head, .matrix-row { display: grid; grid-template-columns: 70px minmax(150px, .7fr) minmax(260px, 1.5fr) minmax(100px, auto); gap: 18px; padding: 16px 20px; }
.matrix-head { color: var(--muted); background: var(--surface-strong); font: .68rem var(--font-data); letter-spacing: .1em; }
.matrix-row { align-items: center; background: var(--surface); border-top: 1px solid var(--line); }
.matrix-row > span, .matrix-row > b { color: var(--accent-alt); font: 700 .72rem var(--font-data); }
.matrix-row p { margin: 0; color: var(--muted); line-height: 1.62; }
.gallery-flow { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 18px; }
.gallery-piece { grid-column: span 4; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.gallery-piece:nth-child(4n + 1) { grid-column: span 6; }
.gallery-visual { display: grid; min-height: 230px; place-items: center; margin-bottom: 18px; background: linear-gradient(135deg, var(--surface-strong), color-mix(in srgb, var(--accent) 13%, var(--surface))); overflow: hidden; }
.gallery-visual::before { content: ""; width: 58%; aspect-ratio: 1.3; border: 1px solid var(--line); transform: rotate(-8deg); }
.gallery-visual span { position: absolute; color: var(--accent); font: 800 2rem var(--font-data); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); }
table { width: 100%; min-width: 0; table-layout: fixed; border-collapse: collapse; background: var(--surface); }
th, td { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
th, td { padding: 17px 18px; border-bottom: 1px solid var(--line); text-align: left; }
thead th { color: var(--muted); background: var(--surface-strong); font: .68rem var(--font-data); letter-spacing: .1em; }
tbody th { color: var(--text); }
td { color: var(--muted); line-height: 1.6; }
td span { color: var(--accent-alt); font: 700 .7rem var(--font-data); }
.story-flow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line); }
.story-flow article { min-height: 220px; padding: 28px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.story-flow article:nth-child(2n) { border-right: 0; }
.quote-flow { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.quote-flow blockquote { margin: 0; padding: 28px; border-left: 3px solid var(--accent); background: var(--surface); }
.quote-flow blockquote > p { margin: 0; font-family: var(--font-display); font-size: clamp(1.15rem, 2vw, 1.7rem); line-height: 1.5; }
.quote-flow footer { display: flex; gap: 10px; margin-top: 22px; color: var(--muted); }
.faq-flow { border-top: 1px solid var(--line); }
.faq-flow details { padding: 21px 0; border-bottom: 1px solid var(--line); }
.faq-flow summary { cursor: pointer; font-family: var(--font-display); font-size: 1.12rem; }
.faq-flow p { max-width: 74ch; color: var(--muted); line-height: 1.75; }
.metric-rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); }
.metric-rail article { min-height: 190px; padding: 24px; background: var(--surface); }
.metric-rail span { color: var(--muted); font-size: .76rem; }
.metric-rail strong { display: block; margin: 20px 0; color: var(--accent); font: 800 clamp(1.8rem, 4vw, 4rem) var(--font-data); }
.map-board { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, .6fr); gap: 1px; border: 1px solid var(--line); background: var(--line); }
.map-surface { position: relative; min-height: 480px; overflow: hidden; background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent-alt) 12%, transparent), transparent 18%), linear-gradient(135deg, var(--surface-strong), var(--bg)); }
.map-surface::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 36px 36px; }
.map-surface > span { position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 7px; color: var(--accent); font: 800 .7rem var(--font-data); }
.map-surface i { width: 12px; height: 12px; border: 2px solid var(--accent); border-radius: 50%; box-shadow: 0 0 18px var(--accent); }
.map-legend { background: var(--surface); }
.map-legend > div { display: grid; grid-template-columns: 42px 1fr; gap: 12px; padding: 18px; border-bottom: 1px solid var(--line); }
.map-legend b { color: var(--accent-alt); font: 700 .7rem var(--font-data); }
.map-legend span { display: grid; gap: 6px; color: var(--muted); line-height: 1.5; }
.map-legend strong { color: var(--text); }
.proof-line, .editorial-meta { display: flex; justify-content: space-between; gap: 22px; padding: 20px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
.proof-line span { color: var(--accent-alt); font: 700 .7rem var(--font-data); }
.editorial-main { max-width: 1180px; }
.editorial-meta { justify-content: flex-start; flex-wrap: wrap; }
.editorial-meta span { display: grid; gap: 5px; min-width: 160px; }
.editorial-meta b { color: var(--text); }
.dashboard-shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
.dashboard-sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 34px; padding: 24px; border-right: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 94%, transparent); }
.dashboard-sidebar .primary-nav { display: grid; justify-content: stretch; }
.dashboard-sidebar .primary-nav a { border-bottom: 1px solid var(--line); }
.dashboard-sidebar .sidebar-status { margin-top: auto; }
.dashboard-main { width: min(1320px, 100%); padding-inline: clamp(18px, 4vw, 52px); }
.dashboard-main { padding-bottom: 64px; }
.dashboard-topbar { position: sticky; top: 0; z-index: 15; min-height: 58px; display: flex; justify-content: flex-end; gap: 28px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(14px); }
.dashboard-topbar > div { display: grid; gap: 3px; text-align: right; }
.dashboard-topbar span, .dashboard-section-label span { color: var(--muted); font: .64rem var(--font-data); letter-spacing: .1em; text-transform: uppercase; }
.dashboard-topbar strong { color: var(--accent-alt); font: 700 .72rem var(--font-data); }
.dashboard-overview { min-height: min(680px, calc(100vh - 58px)); display: grid; align-content: start; gap: 20px; padding: clamp(28px, 4vw, 52px) 0 34px; border-bottom: 1px solid var(--line); }
.dashboard-overview-copy { display: grid; grid-template-columns: minmax(240px, .6fr) minmax(0, 1fr); align-items: end; gap: 34px; }
.dashboard-overview h1 { max-width: 18ch; margin: 8px 0 0; font-size: clamp(2.15rem, 4.2vw, 4.8rem); line-height: .96; }
.dashboard-overview-copy > p:last-child { max-width: 68ch; margin: 0; color: var(--muted); line-height: 1.7; }
.dashboard-overview .stat-band { margin: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dashboard-core-metrics { display: grid; gap: 10px; }
.dashboard-section-label { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.dashboard-section-label strong { color: var(--muted); font: 600 .68rem var(--font-data); }
.metric-rail--dashboard { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.metric-rail--dashboard article { min-height: 170px; position: relative; overflow: hidden; }
.metric-rail--dashboard article::before { content: ""; position: absolute; inset: 0 0 auto; height: 3px; background: var(--accent); }
.metric-rail--dashboard strong { margin: 14px 0 10px; font-size: clamp(1.8rem, 3vw, 3.2rem); }
.metric-rail--dashboard p { margin: 0; color: var(--muted); line-height: 1.55; }
.metric-rail--dashboard small { display: block; margin-top: 12px; color: var(--accent-alt); font: .66rem var(--font-data); }
.dashboard-main > .content-section { padding-block: clamp(52px, 6vw, 84px); }
.stable-app--editorial h1, .stable-app--commerce h1 { max-width: 16ch; line-height: .98; }
.stable-app--editorial .hero { max-width: 1040px; }
.stable-app--portfolio .gallery-piece { grid-column: span 6; }
.stable-app--cinematic-stage .hero { min-height: min(900px, calc(100vh - 72px)); }
.stable-app--cinematic-stage .hero-art { min-height: 520px; }
.stable-app--command-console .hero { grid-template-columns: minmax(0, .8fr) minmax(420px, 1.2fr); }
.stable-app--command-console .hero-art, .stable-app--sidebar-console .hero-art { min-height: 340px; }
.stable-app--season-archive .hero { grid-template-columns: 1fr; max-width: 1120px; }
.stable-app--season-archive .hero-art { min-height: 520px; order: -1; }
.stable-app--wide-monitor .dashboard-shell { grid-template-columns: 96px minmax(0, 1fr); }
.stable-app--wide-monitor .dashboard-sidebar strong, .stable-app--wide-monitor .dashboard-sidebar .primary-nav a { font-size: 0; }
.stable-app--wide-monitor .dashboard-sidebar .primary-nav a::first-letter { font-size: .76rem; }
.stable-app--report-board .dashboard-sidebar { background: var(--surface); }
.stable-app--report-board .dashboard-main { max-width: 1120px; }
.stable-app--product-narrative .hero { min-height: 760px; }
.stable-app--developer-launch .hero-art { background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 28px 28px; }
.stable-app--enterprise-solution .content-section { display: grid; grid-template-columns: minmax(240px, .45fr) minmax(0, 1fr); gap: 54px; }
.stable-app--brand-story .hero-copy { align-self: end; padding-bottom: 32px; }
.stable-app--catalog-rail .gallery-flow { display: flex; overflow-x: auto; padding-bottom: 14px; scroll-snap-type: x mandatory; }
.stable-app--catalog-rail .gallery-piece { min-width: min(420px, 82vw); scroll-snap-align: start; }
.stable-app--product-launch .hero-art { min-height: 580px; }
.stable-app--editorial-feature .hero { max-width: 980px; margin-inline: auto; text-align: center; }
.stable-app--editorial-feature h1, .stable-app--editorial-feature .hero-summary { margin-inline: auto; }
.stable-app--editorial-feature .hero-actions { justify-content: center; }
.stable-app--research-report .content-section { max-width: 1060px; margin-inline: auto; }
.stable-app--institution-portal .site-header { border-top: 4px solid var(--accent); }
.stable-app--project-gallery .gallery-visual { min-height: 320px; }
.stable-app--case-study .content-section { display: grid; grid-template-columns: minmax(230px, .42fr) minmax(0, 1fr); gap: 54px; }
.stable-app--resume-story .timeline-rail { max-width: 980px; margin-left: auto; }
.stable-app--adaptive-story .hero { min-height: 660px; }
.density--compact .content-section { padding-block: clamp(58px, 7vw, 92px); }
.density--spacious .content-section { padding-block: clamp(92px, 12vw, 160px); }
.site-footer { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 28px; padding: 34px clamp(18px, 4vw, 56px); border-top: 1px solid var(--line); background: var(--bg); color: var(--muted); }
.site-footer strong { color: var(--text); }
.site-footer p { margin: 7px 0 0; }
.site-footer nav { display: flex; flex-wrap: wrap; gap: 16px; }
.site-footer a { text-decoration: none; }
.site-footer > span { color: var(--accent-alt); font: 700 .68rem var(--font-data); }
@keyframes pulse { 50% { opacity: .35; transform: scale(.82); } }

@media (max-width: 980px) {
    .site-header { grid-template-columns: 1fr auto; }
    .site-header .primary-nav { grid-column: 1 / -1; justify-content: flex-start; overflow-x: auto; flex-wrap: nowrap; }
    .hero--split, .map-board { grid-template-columns: 1fr; }
    .hero-art { min-height: 360px; }
    .stat-band, .metric-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gallery-piece, .gallery-piece:nth-child(4n + 1), .stable-app--portfolio .gallery-piece { grid-column: span 6; }
    .dashboard-shell { width: 100%; max-width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr); }
    .dashboard-sidebar { width: 100%; max-width: 100%; min-width: 0; position: relative; height: auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; }
    .dashboard-main { width: 100%; max-width: 100%; min-width: 0; margin: 0; }
    .dashboard-overview { min-height: auto; }
    .dashboard-overview-copy { grid-template-columns: 1fr; align-items: start; }
    .dashboard-overview .stat-band, .metric-rail--dashboard { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .dashboard-sidebar .primary-nav { width: 100%; min-width: 0; grid-column: 1 / -1; display: flex; overflow-x: visible; flex-wrap: wrap; }
    table { min-width: 0; table-layout: fixed; }
    th, td { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
    .dashboard-sidebar .sidebar-status { margin: 0; }
    .stable-app--enterprise-solution .content-section, .stable-app--case-study .content-section { grid-template-columns: 1fr; gap: 28px; }
    .site-footer { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
    main, .dashboard-main { padding-inline: 16px; }
    .site-header { padding-inline: 16px; }
    .status-signal { display: none; }
    .hero { min-height: auto; padding-block: 72px 52px; }
    h1 { font-size: clamp(2.8rem, 14vw, 4.7rem); }
    .stat-band, .metric-rail { grid-template-columns: 1fr; }
    .feature-row { grid-template-columns: 42px 1fr; }
    .item-meta { grid-column: 2; justify-items: start; }
    .timeline-rail li { grid-template-columns: 44px 1fr; }
    .timeline-rail li > strong { grid-column: 2; }
    .matrix-head { display: none; }
    .matrix-row { grid-template-columns: 42px 1fr; }
    .matrix-row p, .matrix-row > b { grid-column: 2; }
    .gallery-piece, .gallery-piece:nth-child(4n + 1), .stable-app--portfolio .gallery-piece { grid-column: 1 / -1; }
    .story-flow, .quote-flow { grid-template-columns: 1fr; }
    .story-flow article { border-right: 0; }
    .dashboard-sidebar { padding: 16px; }
    .dashboard-sidebar .sidebar-status { display: none; }
    .dashboard-topbar { justify-content: space-between; }
    .dashboard-overview { padding-top: 28px; }
    .dashboard-overview .stat-band, .metric-rail--dashboard { grid-template-columns: 1fr; }
    .dashboard-overview h1 { font-size: clamp(2.4rem, 12vw, 3.8rem); }
    .site-footer { padding-inline: 16px; }
}

@media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}

/* APPFORGE_PHASE4_LAYOUT_FAMILIES_V9: DesignPlan-driven structural primitives */
.layout-motif { display: grid; grid-template-columns: 1fr 1fr 1fr auto; align-items: center; gap: 8px; min-height: 34px; margin: 0 clamp(18px, 4vw, 56px); font-family: var(--font-data); text-transform: uppercase; letter-spacing: .12em; font-size: .68rem; color: var(--muted); }
.layout-motif > span { height: 2px; background: var(--line); }
.layout-motif > span:first-child { background: var(--accent); }
.layout-motif b { color: var(--accent-alt); }
.layout-stage .hero { min-height: min(78vh, 760px); align-items: end; }
.layout-stage .hero-copy { align-self: end; padding-bottom: clamp(34px, 7vw, 88px); }
.layout-editorial-rail { display: grid; grid-template-columns: minmax(180px, 24vw) minmax(0, 1fr); column-gap: clamp(24px, 5vw, 72px); }
.layout-editorial-rail > .hero, .layout-editorial-rail > .layout-motif { grid-column: 1 / -1; }
.layout-rail-index { position: sticky; top: 94px; align-self: start; display: grid; gap: 0; margin: 48px 0 0 clamp(18px, 4vw, 56px); border-top: 1px solid var(--line); }
.layout-rail-index a { display: grid; grid-template-columns: 3ch 1fr; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line); text-decoration: none; color: var(--muted); }
.layout-rail-index span { font-family: var(--font-data); color: var(--accent); }
.layout-rail-content { min-width: 0; }
.layout-split-narrative .layout-lead-section { margin: clamp(28px, 6vw, 76px) clamp(18px, 8vw, 112px); padding: clamp(24px, 5vw, 64px); border-left: 4px solid var(--accent); background: linear-gradient(90deg, color-mix(in srgb, var(--surface) 86%, transparent), transparent); }
.layout-workflow { position: relative; }
.workflow-spine { position: sticky; top: 76px; z-index: 8; display: flex; justify-content: center; gap: 2px; margin: 0 auto; width: min(92vw, 760px); }
.workflow-spine span { flex: 1; padding: 8px; border-top: 2px solid var(--accent); background: color-mix(in srgb, var(--surface) 86%, transparent); text-align: center; font: 700 .68rem var(--font-data); }
.layout-gallery-wall .section--gallery .section-body, .primitive--gallery-wall .section-body { grid-template-columns: repeat(12, minmax(0, 1fr)); }
.layout-gallery-wall .gallery-item:nth-child(3n + 1) { grid-column: span 7; }
.layout-gallery-wall .gallery-item:nth-child(3n + 2) { grid-column: span 5; transform: translateY(28px); }
.layout-gallery-wall .gallery-item:nth-child(3n) { grid-column: 3 / span 8; }
.map-list-frame { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(0, 1.2fr); min-height: 62vh; margin: clamp(28px, 5vw, 68px) clamp(18px, 4vw, 56px); border: 1px solid var(--line); }
.map-list-map { position: sticky; top: 92px; align-self: start; min-height: 62vh; overflow: hidden; background: radial-gradient(circle at 28% 32%, var(--accent) 0 5px, transparent 6px), radial-gradient(circle at 70% 68%, var(--accent-alt) 0 5px, transparent 6px), linear-gradient(135deg, transparent 48%, var(--line) 49% 51%, transparent 52%), var(--surface); }
.map-list-map span { position: absolute; width: 38%; height: 1px; background: var(--accent); transform-origin: left; }
.map-list-map span:nth-child(1) { left: 28%; top: 32%; rotate: 26deg; }
.map-list-map span:nth-child(2) { left: 52%; top: 54%; rotate: -18deg; }
.map-list-map span:nth-child(3) { left: 18%; top: 72%; rotate: -42deg; }
.map-list-list { min-width: 0; border-left: 1px solid var(--line); }
.layout-timeline-lane .section { position: relative; margin-left: clamp(36px, 8vw, 120px); }
.layout-timeline-lane .section::before { content: ""; position: absolute; left: -36px; top: 0; bottom: 0; width: 1px; background: linear-gradient(var(--accent), var(--line)); }
.surface--open .section { background: transparent; }
.surface--contained .section { background: color-mix(in srgb, var(--surface) 92%, transparent); border: 1px solid var(--line); }
.hero-mode--compact .hero { min-height: auto; padding-block: clamp(38px, 7vw, 84px); }
.hero-mode--full-bleed .hero { width: 100%; max-width: none; }
.layout-family--incident-command .dashboard-overview { border-top: 4px solid var(--accent); }
.dashboard-variant { min-height: 100vh; }
.dashboard-variant--incident .dashboard-overview { border-left: 5px solid var(--accent); }
.dashboard-variant--trend .dashboard-overview { grid-template-columns: minmax(0, 1fr) minmax(420px, 1.2fr); }
.dashboard-trend-grid { display: grid; grid-template-columns: minmax(180px, .28fr) minmax(0, 1fr); gap: 28px; padding: 0 clamp(18px, 4vw, 56px); }
.dashboard-trend-grid > aside { position: sticky; top: 92px; align-self: start; display: grid; border-top: 1px solid var(--line); }
.dashboard-trend-grid > aside span { display: grid; padding: 18px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
.dashboard-trend-grid > aside b { font: 800 1.35rem var(--font-data); color: var(--accent); }
.dashboard-variant--table > .section { max-width: none; }
.layout-family--trend-command .dashboard-shell { display: block; }
.layout-family--trend-command .dashboard-sidebar { position: relative; width: 100%; min-height: auto; grid-template-columns: auto 1fr auto; }
.layout-family--trend-command .dashboard-main { margin-left: 0; }


/* APPFORGE_PHASE4_LAYOUT_FAMILIES_V9_3
   Residual-cluster silhouette separation. These rules change composition,
   reading order and surface geometry; they do not randomize brand colors. */
.layout-family--orbital-expedition .layout-gallery-wall {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr);
  column-gap: clamp(28px, 5vw, 84px);
  align-items: start;
}
.layout-family--orbital-expedition .hero {
  grid-column: 1;
  min-height: min(78vh, 760px);
  clip-path: polygon(0 0, 100% 0, 88% 100%, 0 92%);
  border-right: 1px solid var(--line);
}
.layout-family--orbital-expedition .layout-motif {
  grid-column: 2;
  position: sticky;
  top: 88px;
  margin: 0 clamp(18px, 3vw, 48px) 0 0;
  min-height: 220px;
  grid-template-columns: 1fr;
  align-content: end;
}
.layout-family--orbital-expedition .layout-gallery-wall > .section {
  grid-column: 1 / -1;
}
.layout-family--tactical-map .map-list-frame {
  grid-template-columns: minmax(340px, .82fr) minmax(0, 1.18fr);
  border-top: 4px solid var(--accent);
}
.layout-family--tactical-map .map-list-map {
  min-height: 560px;
  background:
    linear-gradient(90deg, transparent 49%, color-mix(in srgb, var(--accent) 35%, transparent) 50%, transparent 51%),
    linear-gradient(transparent 49%, color-mix(in srgb, var(--accent) 35%, transparent) 50%, transparent 51%),
    var(--surface-strong);
  background-size: 72px 72px;
}
.layout-family--design-system-catalog .layout-gallery-wall {
  display: grid;
  grid-template-columns: minmax(210px, .28fr) minmax(0, 1fr);
  column-gap: clamp(24px, 4vw, 64px);
  align-items: start;
}
.layout-family--design-system-catalog .hero {
  grid-column: 1 / -1;
  min-height: 360px;
  border-bottom: 1px solid var(--line);
}
.layout-family--design-system-catalog .layout-motif {
  position: sticky;
  top: 88px;
  grid-column: 1;
  margin-inline: clamp(18px, 3vw, 42px) 0;
  grid-template-columns: 1fr;
}
.layout-family--design-system-catalog .layout-gallery-wall > .section {
  grid-column: 2;
  max-width: none;
  margin-inline: 0 clamp(18px, 4vw, 64px);
}
.layout-family--data-product-map .map-list-frame {
  grid-template-columns: minmax(420px, .95fr) minmax(0, 1.05fr);
}
.layout-family--data-product-map .map-list-map {
  min-height: 620px;
  border: 1px solid var(--line);
  background:
    radial-gradient(circle at 20% 24%, var(--accent) 0 5px, transparent 6px),
    radial-gradient(circle at 72% 38%, var(--accent-alt) 0 5px, transparent 6px),
    radial-gradient(circle at 48% 76%, var(--accent) 0 5px, transparent 6px),
    linear-gradient(135deg, var(--surface-strong), var(--bg-alt));
}
.layout-family--origin-journal .layout-timeline-lane {
  max-width: 1060px;
  margin-inline: auto;
  padding-inline: clamp(20px, 6vw, 90px);
}
.layout-family--origin-journal .hero {
  min-height: 420px;
  grid-template-columns: minmax(0, .72fr) minmax(260px, .28fr);
  border-bottom: 1px solid var(--line);
}
.layout-family--origin-journal .layout-timeline-lane > .section {
  margin-left: clamp(44px, 9vw, 132px);
  max-width: 760px;
}
.layout-family--field-catalog .layout-stage .hero {
  min-height: min(84vh, 820px);
  align-items: end;
  clip-path: polygon(0 0, 100% 0, 100% 88%, 64% 100%, 0 92%);
}
.layout-family--field-catalog .layout-stage > .section:nth-of-type(even) {
  margin-left: max(20px, 12vw);
  max-width: 980px;
}
.layout-family--field-catalog .layout-stage > .section:nth-of-type(odd) {
  margin-right: max(20px, 8vw);
}
.layout-family--gallery-portfolio .layout-gallery-wall {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: clamp(16px, 2.4vw, 34px);
  padding-inline: clamp(18px, 4vw, 64px);
}
.layout-family--gallery-portfolio .hero {
  grid-column: 1 / 9;
  min-height: 72vh;
}
.layout-family--gallery-portfolio .layout-motif {
  grid-column: 9 / -1;
  align-self: end;
  margin: 0;
}
.layout-family--gallery-portfolio .layout-gallery-wall > .section:nth-of-type(3n + 1) { grid-column: 1 / 8; }
.layout-family--gallery-portfolio .layout-gallery-wall > .section:nth-of-type(3n + 2) { grid-column: 8 / -1; }
.layout-family--gallery-portfolio .layout-gallery-wall > .section:nth-of-type(3n) { grid-column: 3 / 11; }
.layout-family--resume-story .layout-timeline-lane {
  display: grid;
  grid-template-columns: minmax(220px, .32fr) minmax(0, .68fr);
  column-gap: clamp(30px, 6vw, 96px);
  max-width: 1180px;
  margin-inline: auto;
  padding-inline: clamp(18px, 4vw, 56px);
}
.layout-family--resume-story .hero,
.layout-family--resume-story .layout-motif { grid-column: 1; }
.layout-family--resume-story .layout-timeline-lane > .section { grid-column: 2; margin: 0; max-width: none; }
.layout-family--case-study-rail .layout-editorial-rail {
  grid-template-columns: minmax(180px, .24fr) minmax(0, .76fr);
}
.layout-family--research-institute .layout-split-narrative {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, .62fr);
  column-gap: clamp(30px, 5vw, 80px);
  align-items: start;
}
.layout-family--research-institute .hero { grid-column: 1; min-height: 68vh; }
.layout-family--research-institute .layout-motif { grid-column: 2; position: sticky; top: 90px; }
.layout-family--research-institute .layout-lead-section { grid-column: 2; margin: 0 clamp(18px, 4vw, 60px) 0 0; }
.layout-family--research-institute .layout-split-narrative > .section { grid-column: 1 / -1; }
.layout-family--public-service-portal .layout-workflow {
  background: linear-gradient(90deg, var(--surface-strong) 0 min(31vw, 420px), transparent min(31vw, 420px));
}
.layout-family--public-service-portal .layout-workflow .hero {
  min-height: 460px;
  grid-template-columns: minmax(250px, .42fr) minmax(0, .58fr);
}
.layout-family--public-service-portal .workflow-spine {
  justify-content: flex-start;
  padding-left: clamp(18px, 5vw, 72px);
  border-block: 1px solid var(--line);
}
.layout-family--foundation-program .layout-timeline-lane {
  max-width: 1120px;
  margin-left: clamp(18px, 8vw, 132px);
  padding-right: clamp(18px, 5vw, 72px);
}
.layout-family--foundation-program .hero {
  min-height: 400px;
  border-left: 10px solid var(--accent);
}
.layout-family--foundation-program .layout-motif {
  margin-left: clamp(70px, 12vw, 180px);
}
.layout-family--incident-command .dashboard-overview {
  min-height: 470px;
  grid-template-columns: minmax(250px, .62fr) minmax(0, 1.38fr);
  align-items: start;
  border-top: 8px solid var(--accent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface));
}
.layout-family--incident-command .metric-rail--dashboard {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.layout-family--incident-command .workflow-spine {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--bg);
  border-block: 1px solid var(--line);
  justify-content: flex-start;
  padding-inline: clamp(18px, 5vw, 72px);
}
.layout-family--operations-console .dashboard-core-metrics .metric-rail--dashboard {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.layout-family--operations-console .dashboard-overview {
  grid-template-columns: minmax(0, .78fr) minmax(360px, 1.22fr);
}
.layout-family--campaign-editorial .layout-editorial-rail {
  grid-template-columns: minmax(240px, .34fr) minmax(0, .66fr);
}
.layout-family--event-stage .layout-stage .hero {
  min-height: min(86vh, 860px);
}
@media (max-width: 880px) {
  .layout-family--orbital-expedition .layout-gallery-wall,
  .layout-family--design-system-catalog .layout-gallery-wall,
  .layout-family--gallery-portfolio .layout-gallery-wall,
  .layout-family--resume-story .layout-timeline-lane,
  .layout-family--research-institute .layout-split-narrative {
    display: block;
  }
  .layout-family--orbital-expedition .layout-motif,
  .layout-family--design-system-catalog .layout-motif,
  .layout-family--research-institute .layout-motif {
    position: static;
    margin: 18px;
  }
  .layout-family--design-system-catalog .layout-gallery-wall > .section,
  .layout-family--gallery-portfolio .layout-gallery-wall > .section,
  .layout-family--resume-story .layout-timeline-lane > .section,
  .layout-family--research-institute .layout-split-narrative > .section {
    margin-inline: 18px;
    max-width: none;
  }
  .layout-family--incident-command .dashboard-overview,
  .layout-family--operations-console .dashboard-overview,
  .layout-family--public-service-portal .layout-workflow .hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 880px) {
  .layout-editorial-rail, .map-list-frame { grid-template-columns: 1fr; }
  .layout-rail-index { position: static; margin-right: 18px; }
  .map-list-map { position: relative; top: auto; min-height: 300px; }
  .map-list-list { border-left: 0; border-top: 1px solid var(--line); }
  .layout-gallery-wall .gallery-item { grid-column: 1 / -1 !important; transform: none !important; }
}
@media (max-width: 620px) {
  .layout-motif { grid-template-columns: 1fr auto; }
  .layout-motif > span:nth-child(2), .layout-motif > span:nth-child(3) { display: none; }
  .workflow-spine { overflow-x: auto; justify-content: start; }
  .workflow-spine span { min-width: 64px; }
}

`;
}
