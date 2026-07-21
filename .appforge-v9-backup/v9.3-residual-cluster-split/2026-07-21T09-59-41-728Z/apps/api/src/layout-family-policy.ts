import type { DesignPlan } from "@appforge/protocol";
import type { StablePageContent } from "./stable-page-content.js";

export type StableLayoutPrimitive =
  | "full-bleed-stage"
  | "editorial-rail"
  | "split-narrative"
  | "workflow-lane"
  | "data-region"
  | "gallery-wall"
  | "map-list-hybrid"
  | "timeline-lane"
  | "asymmetric-media-break";

export type StableLayoutFamily = {
  family: string;
  primaryPrimitive: StableLayoutPrimitive;
  primitives: StableLayoutPrimitive[];
  heroMode: "full-bleed" | "split" | "compact" | "status";
  navigationMode: "top" | "side" | "minimal";
  surfaceMode: "open" | "contained" | "mixed";
  motif: "signal-rail" | "route-line" | "status-band" | "chapter-index" | "media-cut" | "data-spine";
  sectionOrder: StablePageContent["sections"][number]["kind"][];
  evidence: string[];
};

type Candidate = StableLayoutFamily & {
  hints: RegExp[];
};

const FAMILY_CANDIDATES: Record<StablePageContent["applicationType"], Candidate[]> = {
  game: [
    candidate("campaign-stage", "full-bleed-stage", ["full-bleed-stage", "timeline-lane"], "full-bleed", "minimal", "open", "signal-rail", ["story", "metrics", "timeline", "gallery"], /campaign|cinematic|战役|沉浸|stage|hud/iu),
    candidate("tactical-map", "map-list-hybrid", ["map-list-hybrid", "data-region"], "compact", "side", "contained", "route-line", ["map", "metrics", "data-table", "timeline"], /map|tactic|operation|地图|战术|行动/iu),
    candidate("season-archive", "gallery-wall", ["gallery-wall", "editorial-rail"], "split", "top", "mixed", "chapter-index", ["gallery", "story", "timeline", "metrics"], /season|archive|racing|赛季|档案|车队/iu),
  ],
  dashboard: [
    candidate("operations-console", "data-region", ["data-region", "timeline-lane"], "status", "side", "contained", "data-spine", ["metrics", "data-table", "timeline", "matrix"], /operation|infrastructure|monitor|运维|基础设施|监控|console/iu),
    candidate("trend-command", "editorial-rail", ["editorial-rail", "data-region"], "compact", "top", "mixed", "signal-rail", ["metrics", "story", "data-table", "timeline"], /trend|analytics|growth|趋势|分析|增长/iu),
    candidate("incident-command", "workflow-lane", ["workflow-lane", "data-region"], "status", "side", "contained", "status-band", ["timeline", "metrics", "data-table", "faq"], /incident|alert|clinical|告警|事故|临床|处置/iu),
    candidate("table-operations", "split-narrative", ["split-narrative", "data-region"], "compact", "top", "contained", "chapter-index", ["data-table", "metrics", "matrix", "timeline"], /inventory|record|queue|清单|记录|队列|表格/iu),
  ],
  product: [
    candidate("developer-workbench", "workflow-lane", ["workflow-lane", "data-region"], "split", "top", "contained", "data-spine", ["timeline", "feature-list", "metrics", "faq"], /agent|developer|api|platform|开发|工作流|代理/iu),
    candidate("product-narrative", "split-narrative", ["split-narrative", "editorial-rail"], "split", "top", "mixed", "media-cut", ["story", "feature-list", "metrics", "quotes"], /database|system|product|数据库|系统|产品/iu),
    candidate("proof-rail", "editorial-rail", ["editorial-rail", "timeline-lane"], "compact", "minimal", "open", "signal-rail", ["metrics", "quotes", "story", "faq"], /proof|trust|design|证据|可信|设计/iu),
  ],
  commerce: [
    candidate("catalog-rail", "editorial-rail", ["editorial-rail", "gallery-wall"], "compact", "top", "mixed", "chapter-index", ["gallery", "feature-list", "metrics", "faq"], /catalog|headphone|collection|目录|耳机|系列/iu),
    candidate("brand-story", "split-narrative", ["split-narrative", "gallery-wall"], "full-bleed", "minimal", "open", "media-cut", ["story", "gallery", "quotes", "feature-list"], /coffee|outdoor|brand|咖啡|户外|品牌/iu),
    candidate("market-wall", "gallery-wall", ["gallery-wall", "timeline-lane"], "split", "top", "contained", "status-band", ["gallery", "metrics", "timeline", "faq"], /market|drop|launch|市集|发售|上新/iu),
  ],
  editorial: [
    candidate("editorial-feature", "editorial-rail", ["editorial-rail", "asymmetric-media-break" as StableLayoutPrimitive], "full-bleed", "minimal", "open", "media-cut", ["story", "timeline", "gallery", "quotes"], /city|culture|feature|城市|文化|专题/iu),
    candidate("research-dossier", "split-narrative", ["split-narrative", "data-region"], "compact", "top", "contained", "data-spine", ["metrics", "story", "data-table", "faq"], /ai|climate|report|research|人工智能|气候|报告|研究/iu),
    candidate("route-narrative", "timeline-lane", ["timeline-lane", "map-list-hybrid"], "split", "minimal", "mixed", "route-line", ["timeline", "map", "story", "gallery"], /route|renewal|journey|路线|更新|旅程/iu),
  ],
  institution: [
    candidate("public-service-portal", "workflow-lane", ["workflow-lane", "data-region"], "compact", "top", "contained", "status-band", ["feature-list", "metrics", "faq", "data-table"], /public|health|service|公共|健康|服务/iu),
    candidate("research-institute", "split-narrative", ["split-narrative", "editorial-rail"], "split", "minimal", "mixed", "data-spine", ["story", "metrics", "timeline", "quotes"], /laboratory|research|lab|实验室|研究|科研/iu),
    candidate("foundation-program", "timeline-lane", ["timeline-lane", "gallery-wall"], "full-bleed", "top", "open", "chapter-index", ["timeline", "story", "gallery", "faq"], /foundation|program|grant|基金会|计划|资助/iu),
  ],
  portfolio: [
    candidate("case-study-rail", "editorial-rail", ["editorial-rail", "split-narrative"], "split", "minimal", "open", "chapter-index", ["story", "metrics", "gallery", "quotes"], /designer|case|product|设计师|案例|产品/iu),
    candidate("gallery-portfolio", "gallery-wall", ["gallery-wall", "asymmetric-media-break" as StableLayoutPrimitive], "full-bleed", "minimal", "open", "media-cut", ["gallery", "story", "quotes", "faq"], /photo|visual|image|摄影|视觉|影像/iu),
    candidate("resume-story", "timeline-lane", ["timeline-lane", "data-region"], "compact", "top", "contained", "data-spine", ["timeline", "metrics", "feature-list", "faq"], /engineer|resume|experience|工程师|履历|经历/iu),
  ],
  custom: [
    candidate("event-stage", "full-bleed-stage", ["full-bleed-stage", "timeline-lane"], "full-bleed", "minimal", "open", "signal-rail", ["timeline", "gallery", "metrics", "faq"], /festival|music|event|音乐节|节庆|活动/iu),
    candidate("expo-map", "map-list-hybrid", ["map-list-hybrid", "data-region"], "compact", "side", "contained", "route-line", ["map", "data-table", "metrics", "timeline"], /expo|industry|venue|展会|产业|场馆/iu),
    candidate("campaign-editorial", "editorial-rail", ["editorial-rail", "workflow-lane"], "split", "top", "mixed", "chapter-index", ["story", "feature-list", "timeline", "faq"], /recruit|campaign|talent|招聘|招募|人才/iu),
    candidate("adaptive-program", "split-narrative", ["split-narrative", "gallery-wall"], "split", "top", "mixed", "media-cut", ["story", "gallery", "metrics", "faq"], /program|community|initiative|计划|社区|项目/iu),
  ],
};

function candidate(
  family: string,
  primaryPrimitive: StableLayoutPrimitive,
  primitives: StableLayoutPrimitive[],
  heroMode: StableLayoutFamily["heroMode"],
  navigationMode: StableLayoutFamily["navigationMode"],
  surfaceMode: StableLayoutFamily["surfaceMode"],
  motif: StableLayoutFamily["motif"],
  sectionOrder: StableLayoutFamily["sectionOrder"],
  ...hints: RegExp[]
): Candidate {
  return { family, primaryPrimitive, primitives, heroMode, navigationMode, surfaceMode, motif, sectionOrder, hints, evidence: [] };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizedEvidence(content: StablePageContent, designPlan?: DesignPlan): string {
  return [
    content.applicationType,
    content.templateVariant,
    content.brand.name,
    content.brand.title,
    content.brand.summary,
    ...content.sections.flatMap((section) => [section.kind, section.title, section.description]),
    designPlan?.visualDNA.composition,
    designPlan?.visualDNA.heroPattern,
    designPlan?.visualDNA.navigationPattern,
    designPlan?.visualDNA.surfaceStrategy,
    ...(designPlan?.visualDNA.sectionRhythm ?? []),
    ...(designPlan?.visualDNA.uniqueMotifs ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function deriveStableLayoutFamily(
  content: StablePageContent,
  designPlan?: DesignPlan,
): StableLayoutFamily {
  const candidates = FAMILY_CANDIDATES[content.applicationType];
  const evidence = normalizedEvidence(content, designPlan);
  const seed = stableHash(`${content.brand.title}|${content.templateVariant}|${evidence}`);
  const scored = candidates.map((item, index) => {
    const semanticHits = item.hints.reduce((count, hint) => count + (hint.test(evidence) ? 1 : 0), 0);
    const primitiveHits = item.primitives.reduce((count, primitive) => {
      const words = primitive.replace(/-/gu, " ").split(/\s+/u);
      return count + (words.some((word) => evidence.includes(word)) ? 1 : 0);
    }, 0);
    const planBias = designPlan ? 3 : 0;
    const tiebreak = (seed + index * 2654435761) % 997;
    return { item, score: semanticHits * 100 + primitiveHits * 25 + planBias + tiebreak / 1000 };
  });
  scored.sort((left, right) => right.score - left.score);
  const selected = scored[0]?.item ?? candidates[seed % candidates.length]!;
  const surfaceMode = designPlan?.visualDNA.surfaceStrategy === "contained"
    ? "contained"
    : designPlan?.visualDNA.surfaceStrategy === "open"
      ? "open"
      : selected.surfaceMode;
  return {
    family: selected.family,
    primaryPrimitive: selected.primaryPrimitive,
    primitives: [...selected.primitives],
    heroMode: selected.heroMode,
    navigationMode: selected.navigationMode,
    surfaceMode,
    motif: selected.motif,
    sectionOrder: [...selected.sectionOrder],
    evidence: [
      `applicationType=${content.applicationType}`,
      `templateVariant=${content.templateVariant}`,
      `composition=${designPlan?.visualDNA.composition ?? "fallback"}`,
      `heroPattern=${designPlan?.visualDNA.heroPattern ?? "fallback"}`,
    ],
  };
}
