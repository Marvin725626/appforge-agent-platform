import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const marker = "APPFORGE_PHASE4_LAYOUT_FAMILIES_V9";
const rendererPath = path.join(root, "apps/api/src/stable-page-renderer.ts");
const generatorPath = path.join(root, "apps/api/src/stable-react-page-generator.ts");
const policySource = path.join(root, ".phase4-v9-payload/apps/api/src/layout-family-policy.ts");
const policyTestSource = path.join(root, ".phase4-v9-payload/apps/api/src/layout-family-policy.test.ts");
const policyTarget = path.join(root, "apps/api/src/layout-family-policy.ts");
const policyTestTarget = path.join(root, "apps/api/src/layout-family-policy.test.ts");

function fail(message) { throw new Error(message); }
function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) fail(`V9 patch could not find ${label}. The repository is not the expected Phase 5 main baseline.`);
  if (source.indexOf(search, index + search.length) >= 0) fail(`V9 patch found ${label} more than once.`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const backupRoot = path.join(root, `.appforge-v9-backup-${stamp}`);
await mkdir(backupRoot, { recursive: true });
await cp(rendererPath, path.join(backupRoot, "stable-page-renderer.ts"));
await cp(generatorPath, path.join(backupRoot, "stable-react-page-generator.ts"));

let renderer = (await readFile(rendererPath, "utf8")).replace(/\r\n/gu, "\n");
let generator = (await readFile(generatorPath, "utf8")).replace(/\r\n/gu, "\n");
if (renderer.includes(marker)) {
  console.log("V9 layout-family patch is already installed.");
  process.exit(0);
}

renderer = replaceOnce(
  renderer,
  'import type { StablePageContent } from "./stable-page-content.js";',
  'import type { StablePageContent } from "./stable-page-content.js";\nimport { deriveStableLayoutFamily } from "./layout-family-policy.js";\n\n// APPFORGE_PHASE4_LAYOUT_FAMILIES_V9',
  "stable renderer import",
);
renderer = replaceOnce(
  renderer,
  '    media: StablePageMedia,\n): string {\n    const pageJson = js({\n        ...content,',
  '    media: StablePageMedia,\n    designPlan?: DesignPlan,\n): string {\n    const layoutPlan = deriveStableLayoutFamily(content, designPlan);\n    const pageJson = js({\n        ...content,\n        layout: layoutPlan,',
  "createStableAppSource signature",
);
renderer = replaceOnce(
  renderer,
  '    templateVariant: string;\n    theme: { palette: string; fontPair: string; density: string };',
  '    templateVariant: string;\n    layout: {\n    family: string;\n    primaryPrimitive: "full-bleed-stage" | "editorial-rail" | "split-narrative" | "workflow-lane" | "data-region" | "gallery-wall" | "map-list-hybrid" | "timeline-lane" | "asymmetric-media-break";\n    primitives: string[];\n    heroMode: "full-bleed" | "split" | "compact" | "status";\n    navigationMode: "top" | "side" | "minimal";\n    surfaceMode: "open" | "contained" | "mixed";\n    motif: "signal-rail" | "route-line" | "status-band" | "chapter-index" | "media-cut" | "data-spine";\n    sectionOrder: PageSection["kind"][];\n    evidence: string[];\n  };\n  theme: { palette: string; fontPair: string; density: string };',
  "PageModel layout contract",
);

const layoutStart = renderer.indexOf("function GameLayout() {");
const appStart = renderer.indexOf("export function App() {", layoutStart);
if (layoutStart < 0 || appStart < 0) fail("V9 patch could not locate the legacy application-type layout block.");
const layoutBlock = `function orderedSections(): PageSection[] {
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
function PageLayout() { return <DesignDrivenLayout />; }

`;
renderer = renderer.slice(0, layoutStart) + layoutBlock + renderer.slice(appStart);
{
  const appClassPattern = /<div className=\{\\`stable-app stable-app--\\\$\{page\.applicationType\} stable-app--\\\$\{page\.templateVariant\} density--\\\$\{page\.theme\.density\}\\`\}>/u;
  if (!appClassPattern.test(renderer)) fail("V9 patch could not find stable app class contract. The repository is not the expected Phase 5 main baseline.");
  renderer = renderer.replace(
    appClassPattern,
    String.raw`<div className={\`stable-app stable-app--\${page.applicationType} stable-app--\${page.templateVariant} layout-family--\${page.layout.family} primitive--\${page.layout.primaryPrimitive} surface--\${page.layout.surfaceMode} hero-mode--\${page.layout.heroMode} density--\${page.theme.density}\`} data-appforge-layout-family={page.layout.family}>`,
  );
}
renderer = replaceOnce(
  renderer,
  '    const fonts = FONT_PAIRS[content.theme.fontPair];\n    const composition = designPlan?.visualDNA.composition ?? content.templateVariant;',
  '    const fonts = FONT_PAIRS[content.theme.fontPair];\n    const layoutPlan = deriveStableLayoutFamily(content, designPlan);\n  const composition = designPlan?.visualDNA.composition ?? content.templateVariant;',
  "CSS layout plan derivation",
);
renderer = replaceOnce(
  renderer,
  '    --layout-primitives: ${cssString(`${content.applicationType} / ${content.templateVariant} / semantic-section-renderers`)};',
  '    --layout-family: ${cssString(layoutPlan.family)};\n  --hero-mode: ${cssString(layoutPlan.heroMode)};\n  --navigation-mode: ${cssString(layoutPlan.navigationMode)};\n  --motif-kind: ${cssString(layoutPlan.motif)};\n  --layout-primitives: ${cssString(layoutPlan.primitives.join(" / "))};',
  "layout CSS variables",
);

const cssFunction = renderer.indexOf("export function createStableCssSource(");
const cssClose = renderer.lastIndexOf("\n`;\n}");
if (cssFunction < 0 || cssClose < cssFunction) fail("V9 patch could not locate the generated CSS template terminator.");
const cssV9 = `

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
renderer = renderer.slice(0, cssClose) + cssV9 + renderer.slice(cssClose);

generator = generator.replace(
  /(const appSource = createStableAppSource\(contentResult\.content, \{[\s\S]*?heroAlt: contentResult\.content\.hero\.imageAlt,\s*)\}\);/u,
  "$1}, input.designPlan);",
);
if (!generator.includes("}, input.designPlan);")) fail("V9 patch could not wire DesignPlan into createStableAppSource.");

await writeFile(rendererPath, renderer, "utf8");
await writeFile(generatorPath, generator, "utf8");
await cp(policySource, policyTarget);
await cp(policyTestSource, policyTestTarget);
console.log(`V9 installed. Backup: ${path.relative(root, backupRoot)}`);
