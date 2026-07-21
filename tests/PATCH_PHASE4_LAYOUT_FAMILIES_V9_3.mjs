import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const payloadRoot = path.join(root, "V9_3_PAYLOAD");
const policyTarget = path.join(root, "apps", "api", "src", "layout-family-policy.ts");
const rendererTarget = path.join(root, "apps", "api", "src", "stable-page-renderer.ts");
const testTarget = path.join(root, "apps", "api", "src", "layout-family-policy-v9-3.test.ts");
const policyPayload = path.join(payloadRoot, "layout-family-policy.ts");
const testPayload = path.join(payloadRoot, "layout-family-policy-v9-3.test.ts");

function fail(message) {
  throw new Error(message);
}

for (const required of [policyTarget, rendererTarget, policyPayload, testPayload]) {
  if (!fs.existsSync(required)) fail(`Required file not found: ${required}`);
}

const originalRenderer = fs.readFileSync(rendererTarget, "utf8");
if (!originalRenderer.includes("APPFORGE_PHASE4_LAYOUT_FAMILIES_V9")) {
  fail("V9.3 requires the Phase 4 V9 layout-family renderer baseline.");
}

const backupRoot = path.join(
  root,
  ".appforge-v9-backup",
  "v9.3-residual-cluster-split",
  new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
);
fs.mkdirSync(path.join(backupRoot, "apps", "api", "src"), { recursive: true });
for (const source of [policyTarget, rendererTarget, testTarget]) {
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(backupRoot, "apps", "api", "src", path.basename(source)));
}

fs.copyFileSync(policyPayload, policyTarget);
fs.copyFileSync(testPayload, testTarget);

const cssPatch = String.raw`
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
`;

let renderer = originalRenderer;
if (!renderer.includes("APPFORGE_PHASE4_LAYOUT_FAMILIES_V9_3")) {
  const anchor = /\.layout-family--trend-command \.dashboard-main \{ margin-left: 0; \}\r?\n/;
  if (!anchor.test(renderer)) {
    fail("V9.3 could not locate the family-CSS insertion anchor in stable-page-renderer.ts.");
  }
  renderer = renderer.replace(anchor, (match) => `${match}\n${cssPatch}\n`);
  fs.writeFileSync(rendererTarget, renderer, "utf8");
}

const latestFile = path.join(root, ".appforge-v9-backup", "v9.3-residual-cluster-split", "latest.json");
fs.mkdirSync(path.dirname(latestFile), { recursive: true });
fs.writeFileSync(
  latestFile,
  JSON.stringify({ backupRoot, createdAt: new Date().toISOString() }, null, 2),
  "utf8",
);

console.log(`V9.3 installed. Backup: ${backupRoot}`);
