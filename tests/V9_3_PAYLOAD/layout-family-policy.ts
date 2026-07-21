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

type SectionKind = StablePageContent["sections"][number]["kind"];
type ApplicationType = StablePageContent["applicationType"];

export type StableLayoutFamily = {
  family: string;
  primaryPrimitive: StableLayoutPrimitive;
  primitives: StableLayoutPrimitive[];
  heroMode: "full-bleed" | "split" | "compact" | "status";
  navigationMode: "top" | "side" | "minimal";
  surfaceMode: "open" | "contained" | "mixed";
  motif: "signal-rail" | "route-line" | "status-band" | "chapter-index" | "media-cut" | "data-spine";
  sectionOrder: SectionKind[];
  evidence: string[];
};

type Candidate = StableLayoutFamily & {
  hints: RegExp[];
};

type IntentRule = {
  family: string;
  pattern: RegExp;
};

const FAMILY_CANDIDATES: Record<ApplicationType, Candidate[]> = {
  game: [
    candidate(
      "campaign-stage",
      "full-bleed-stage",
      ["full-bleed-stage", "timeline-lane"],
      "full-bleed",
      "minimal",
      "open",
      "signal-rail",
      ["story", "metrics", "timeline", "gallery"],
      /campaign|cinematic|warfront|战役|沉浸|剧情|stage|hud/iu,
    ),
    candidate(
      "tactical-map",
      "map-list-hybrid",
      ["map-list-hybrid", "data-region"],
      "compact",
      "side",
      "contained",
      "route-line",
      ["map", "metrics", "data-table", "timeline"],
      /map|tactic|operation|mission|combat|地图|战术|行动|作战|任务/iu,
    ),
    candidate(
      "orbital-expedition",
      "asymmetric-media-break",
      ["asymmetric-media-break", "gallery-wall", "data-region"],
      "split",
      "minimal",
      "open",
      "media-cut",
      ["gallery", "metrics", "story", "timeline"],
      /space|expedition|orbital|stellar|galaxy|planet|太空|星际|远征|轨道|行星|探索/iu,
    ),
    candidate(
      "season-archive",
      "gallery-wall",
      ["gallery-wall", "editorial-rail"],
      "split",
      "top",
      "mixed",
      "chapter-index",
      ["gallery", "story", "timeline", "metrics"],
      /season|archive|racing|championship|赛季|档案|赛车|车队|锦标赛/iu,
    ),
  ],
  dashboard: [
    candidate(
      "operations-console",
      "data-region",
      ["data-region", "timeline-lane"],
      "status",
      "side",
      "contained",
      "data-spine",
      ["metrics", "data-table", "timeline", "matrix"],
      /operation|infrastructure|monitor|server|cpu|memory|latency|运维|基础设施|监控|服务器|内存|延迟|console/iu,
    ),
    candidate(
      "trend-command",
      "editorial-rail",
      ["editorial-rail", "data-region"],
      "compact",
      "top",
      "mixed",
      "signal-rail",
      ["metrics", "story", "data-table", "timeline"],
      /trend|analytics|growth|forecast|趋势|分析|增长|预测/iu,
    ),
    candidate(
      "incident-command",
      "workflow-lane",
      ["workflow-lane", "data-region"],
      "status",
      "side",
      "contained",
      "status-band",
      ["timeline", "metrics", "data-table", "faq"],
      /incident|alert|clinical|patient|triage|告警|事故|临床|患者|分诊|处置/iu,
    ),
    candidate(
      "table-operations",
      "split-narrative",
      ["split-narrative", "data-region"],
      "compact",
      "top",
      "contained",
      "chapter-index",
      ["data-table", "metrics", "matrix", "timeline"],
      /inventory|record|queue|registry|清单|记录|队列|台账|表格/iu,
    ),
  ],
  product: [
    candidate(
      "developer-workbench",
      "workflow-lane",
      ["workflow-lane", "data-region"],
      "split",
      "top",
      "contained",
      "data-spine",
      ["timeline", "feature-list", "metrics", "faq"],
      /agent|developer|api|platform|sdk|开发|工作流|代理|接口|平台/iu,
    ),
    candidate(
      "data-product-map",
      "map-list-hybrid",
      ["map-list-hybrid", "data-region"],
      "compact",
      "side",
      "contained",
      "route-line",
      ["data-table", "metrics", "feature-list", "timeline"],
      /database|data platform|warehouse|query|数据库|数据平台|数仓|查询/iu,
    ),
    candidate(
      "design-system-catalog",
      "gallery-wall",
      ["gallery-wall", "asymmetric-media-break", "editorial-rail"],
      "compact",
      "top",
      "mixed",
      "chapter-index",
      ["gallery", "feature-list", "metrics", "faq"],
      /design system|component library|design token|pattern library|设计系统|组件库|设计令牌|模式库/iu,
    ),
    candidate(
      "product-narrative",
      "split-narrative",
      ["split-narrative", "editorial-rail"],
      "split",
      "top",
      "mixed",
      "media-cut",
      ["story", "feature-list", "metrics", "quotes"],
      /product|software|solution|产品|软件|解决方案/iu,
    ),
    candidate(
      "proof-rail",
      "editorial-rail",
      ["editorial-rail", "timeline-lane"],
      "compact",
      "minimal",
      "open",
      "signal-rail",
      ["metrics", "quotes", "story", "faq"],
      /proof|trust|evidence|benchmark|证据|可信|验证|基准/iu,
    ),
  ],
  commerce: [
    candidate(
      "catalog-rail",
      "editorial-rail",
      ["editorial-rail", "gallery-wall"],
      "compact",
      "top",
      "mixed",
      "chapter-index",
      ["gallery", "feature-list", "metrics", "faq"],
      /catalog|headphone|collection|目录|耳机|系列|选购/iu,
    ),
    candidate(
      "origin-journal",
      "timeline-lane",
      ["timeline-lane", "editorial-rail"],
      "compact",
      "minimal",
      "open",
      "chapter-index",
      ["timeline", "story", "quotes", "gallery"],
      /coffee|roast|origin|cafe|bean|咖啡|烘焙|产地|咖啡馆|豆/iu,
    ),
    candidate(
      "field-catalog",
      "full-bleed-stage",
      ["full-bleed-stage", "gallery-wall", "map-list-hybrid"],
      "full-bleed",
      "minimal",
      "open",
      "route-line",
      ["gallery", "feature-list", "map", "metrics"],
      /outdoor|camp|trail|hiking|field|户外|露营|徒步|山野|野外/iu,
    ),
    candidate(
      "market-wall",
      "gallery-wall",
      ["gallery-wall", "timeline-lane"],
      "split",
      "top",
      "contained",
      "status-band",
      ["gallery", "metrics", "timeline", "faq"],
      /market|drop|launch|store|市集|发售|上新|商店/iu,
    ),
    candidate(
      "brand-story",
      "split-narrative",
      ["split-narrative", "gallery-wall"],
      "full-bleed",
      "minimal",
      "open",
      "media-cut",
      ["story", "gallery", "quotes", "feature-list"],
      /brand|craft|heritage|品牌|工艺|传承/iu,
    ),
  ],
  editorial: [
    candidate(
      "editorial-feature",
      "editorial-rail",
      ["editorial-rail", "asymmetric-media-break"],
      "full-bleed",
      "minimal",
      "open",
      "media-cut",
      ["story", "timeline", "gallery", "quotes"],
      /city|culture|feature|城市|文化|专题|人物/iu,
    ),
    candidate(
      "research-dossier",
      "split-narrative",
      ["split-narrative", "data-region"],
      "compact",
      "top",
      "contained",
      "data-spine",
      ["metrics", "story", "data-table", "faq"],
      /ai|climate|report|research|人工智能|气候|报告|研究/iu,
    ),
    candidate(
      "route-narrative",
      "timeline-lane",
      ["timeline-lane", "map-list-hybrid"],
      "split",
      "minimal",
      "mixed",
      "route-line",
      ["timeline", "map", "story", "gallery"],
      /route|renewal|journey|路线|更新|旅程|迁移/iu,
    ),
  ],
  institution: [
    candidate(
      "public-service-portal",
      "workflow-lane",
      ["workflow-lane", "data-region"],
      "compact",
      "top",
      "contained",
      "status-band",
      ["feature-list", "metrics", "faq", "data-table"],
      /public|health|service|clinic|citizen|公共|健康|服务|门诊|市民/iu,
    ),
    candidate(
      "research-institute",
      "split-narrative",
      ["split-narrative", "editorial-rail"],
      "split",
      "minimal",
      "mixed",
      "data-spine",
      ["story", "metrics", "timeline", "quotes"],
      /laboratory|research|lab|science|实验室|研究|科研|科学/iu,
    ),
    candidate(
      "foundation-program",
      "timeline-lane",
      ["timeline-lane", "gallery-wall"],
      "compact",
      "top",
      "contained",
      "chapter-index",
      ["timeline", "story", "gallery", "faq"],
      /foundation|program|grant|charity|基金会|计划|资助|公益/iu,
    ),
  ],
  portfolio: [
    candidate(
      "case-study-rail",
      "editorial-rail",
      ["editorial-rail", "split-narrative"],
      "split",
      "minimal",
      "open",
      "chapter-index",
      ["story", "metrics", "gallery", "quotes"],
      /designer|case study|product design|设计师|案例|产品设计/iu,
    ),
    candidate(
      "gallery-portfolio",
      "gallery-wall",
      ["gallery-wall", "asymmetric-media-break"],
      "full-bleed",
      "minimal",
      "open",
      "media-cut",
      ["gallery", "story", "quotes", "faq"],
      /photographer|photo|visual|image|摄影师|摄影|视觉|影像/iu,
    ),
    candidate(
      "resume-story",
      "timeline-lane",
      ["timeline-lane", "data-region"],
      "compact",
      "top",
      "contained",
      "data-spine",
      ["timeline", "metrics", "feature-list", "faq"],
      /engineer|resume|experience|career|工程师|履历|经历|职业/iu,
    ),
  ],
  custom: [
    candidate(
      "event-stage",
      "full-bleed-stage",
      ["full-bleed-stage", "timeline-lane"],
      "full-bleed",
      "minimal",
      "open",
      "signal-rail",
      ["timeline", "gallery", "metrics", "faq"],
      /festival|music|event|concert|音乐节|节庆|活动|演出/iu,
    ),
    candidate(
      "expo-map",
      "map-list-hybrid",
      ["map-list-hybrid", "data-region"],
      "compact",
      "side",
      "contained",
      "route-line",
      ["map", "data-table", "metrics", "timeline"],
      /expo|industry|venue|booth|展会|产业|场馆|展位/iu,
    ),
    candidate(
      "campaign-editorial",
      "editorial-rail",
      ["editorial-rail", "workflow-lane"],
      "split",
      "top",
      "mixed",
      "chapter-index",
      ["story", "feature-list", "timeline", "faq"],
      /recruit|campaign|talent|hiring|招聘|招募|人才|雇主/iu,
    ),
    candidate(
      "adaptive-program",
      "split-narrative",
      ["split-narrative", "gallery-wall"],
      "split",
      "top",
      "mixed",
      "media-cut",
      ["story", "gallery", "metrics", "faq"],
      /program|community|initiative|计划|社区|项目/iu,
    ),
  ],
};

const INTENT_PRIORITY: Partial<Record<ApplicationType, IntentRule[]>> = {
  game: [
    { family: "orbital-expedition", pattern: /space|expedition|orbital|stellar|galaxy|planet|太空|星际|远征|轨道|行星|探索/iu },
    { family: "tactical-map", pattern: /tactic|operation|mission|combat|地图|战术|行动|作战|任务/iu },
    { family: "season-archive", pattern: /season|racing|championship|赛季|赛车|车队|锦标赛/iu },
    { family: "campaign-stage", pattern: /campaign|cinematic|warfront|战役|沉浸|剧情/iu },
  ],
  dashboard: [
    { family: "incident-command", pattern: /clinical|incident|alert|patient|triage|临床|告警|事故|患者|分诊|处置/iu },
    { family: "operations-console", pattern: /infrastructure|server|cpu|memory|latency|monitor|基础设施|服务器|内存|延迟|监控|运维/iu },
    { family: "trend-command", pattern: /trend|analytics|growth|forecast|趋势|分析|增长|预测/iu },
    { family: "table-operations", pattern: /inventory|record|queue|registry|清单|记录|队列|台账|表格/iu },
  ],
  product: [
    { family: "design-system-catalog", pattern: /design system|component library|design token|pattern library|设计系统|组件库|设计令牌|模式库/iu },
    { family: "data-product-map", pattern: /database|data platform|warehouse|query|数据库|数据平台|数仓|查询/iu },
    { family: "developer-workbench", pattern: /agent|developer|api|sdk|开发|工作流|代理|接口/iu },
    { family: "proof-rail", pattern: /proof|trust|evidence|benchmark|证据|可信|验证|基准/iu },
  ],
  commerce: [
    { family: "origin-journal", pattern: /coffee|roast|origin|cafe|bean|咖啡|烘焙|产地|咖啡馆|豆/iu },
    { family: "field-catalog", pattern: /outdoor|camp|trail|hiking|field|户外|露营|徒步|山野|野外/iu },
    { family: "catalog-rail", pattern: /headphone|catalog|collection|耳机|目录|系列/iu },
    { family: "market-wall", pattern: /market|drop|launch|store|市集|发售|上新|商店/iu },
  ],
  institution: [
    { family: "public-service-portal", pattern: /public|health|service|clinic|citizen|公共|健康|服务|门诊|市民/iu },
    { family: "research-institute", pattern: /laboratory|research|lab|science|实验室|研究|科研|科学/iu },
    { family: "foundation-program", pattern: /foundation|grant|charity|基金会|资助|公益/iu },
  ],
  portfolio: [
    { family: "gallery-portfolio", pattern: /photographer|photo|visual|image|摄影师|摄影|视觉|影像/iu },
    { family: "resume-story", pattern: /engineer|resume|experience|career|工程师|履历|经历|职业/iu },
    { family: "case-study-rail", pattern: /designer|case study|product design|设计师|案例|产品设计/iu },
  ],
  custom: [
    { family: "event-stage", pattern: /festival|music|concert|音乐节|节庆|演出/iu },
    { family: "expo-map", pattern: /expo|industry|venue|booth|展会|产业|场馆|展位/iu },
    { family: "campaign-editorial", pattern: /recruit|campaign|talent|hiring|招聘|招募|人才|雇主/iu },
  ],
  editorial: [
    { family: "route-narrative", pattern: /route|renewal|journey|路线|更新|旅程|迁移/iu },
    { family: "editorial-feature", pattern: /city|culture|feature|城市|文化|专题|人物/iu },
    { family: "research-dossier", pattern: /ai|climate|report|research|人工智能|气候|报告|研究/iu },
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
  return {
    family,
    primaryPrimitive,
    primitives,
    heroMode,
    navigationMode,
    surfaceMode,
    motif,
    sectionOrder,
    hints,
    evidence: [],
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function semanticEvidence(content: StablePageContent): string {
  return normalize([
    content.applicationType,
    content.brand.name,
    content.brand.kicker,
    content.brand.title,
    content.brand.summary,
    content.hero.imagePrompt,
    content.hero.imageAlt,
    ...content.hero.stats.flatMap((stat) => [stat.label, stat.value]),
    ...content.sections.flatMap((section) => [
      section.title,
      section.description,
      section.eyebrow,
      ...section.items.flatMap((item) => [item.title, item.description, item.meta, item.value, item.status]),
    ]),
  ]);
}

function designEvidence(designPlan?: DesignPlan): string {
  if (!designPlan) return "";
  return normalize([
    designPlan.visualDNA.composition,
    designPlan.visualDNA.heroPattern,
    designPlan.visualDNA.navigationPattern,
    designPlan.visualDNA.surfaceStrategy,
    ...designPlan.visualDNA.sectionRhythm,
    ...designPlan.visualDNA.uniqueMotifs,
  ]);
}

function findCandidate(applicationType: ApplicationType, family: string): Candidate | undefined {
  return FAMILY_CANDIDATES[applicationType].find((item) => item.family === family);
}

function resolveIntentCandidate(applicationType: ApplicationType, evidence: string): Candidate | undefined {
  for (const rule of INTENT_PRIORITY[applicationType] ?? []) {
    if (!rule.pattern.test(evidence)) continue;
    const selected = findCandidate(applicationType, rule.family);
    if (selected) return selected;
  }
  return undefined;
}

function primitiveFromPlan(evidence: string): StableLayoutPrimitive | undefined {
  const rules: Array<[StableLayoutPrimitive, RegExp]> = [
    ["asymmetric-media-break", /asymmetric|media break|非对称|媒体断点/iu],
    ["map-list-hybrid", /map.?list|map hybrid|地图.?列表|地图混合/iu],
    ["full-bleed-stage", /full.?bleed|cinematic stage|immersive stage|全宽|全屏|沉浸舞台/iu],
    ["editorial-rail", /editorial rail|story rail|编辑导轨|叙事导轨/iu],
    ["workflow-lane", /workflow lane|process lane|工作流|流程泳道/iu],
    ["data-region", /data region|operations console|数据区域|操作台/iu],
    ["gallery-wall", /gallery wall|masonry|画廊墙|作品墙/iu],
    ["timeline-lane", /timeline lane|chronology|时间线|时间轴/iu],
    ["split-narrative", /split narrative|split layout|分栏叙事|双栏/iu],
  ];
  return rules.find(([, pattern]) => pattern.test(evidence))?.[0];
}

function heroModeFromPlan(
  fallback: StableLayoutFamily["heroMode"],
  evidence: string,
): StableLayoutFamily["heroMode"] {
  if (/status|command|operations|状态|指挥|操作台/iu.test(evidence)) return "status";
  if (/full.?bleed|cinematic|immersive|全宽|全屏|沉浸/iu.test(evidence)) return "full-bleed";
  if (/split|two.?column|分栏|双栏/iu.test(evidence)) return "split";
  if (/compact|dense|editorial|紧凑|高密度|编辑/iu.test(evidence)) return "compact";
  return fallback;
}

function navigationModeFromPlan(
  fallback: StableLayoutFamily["navigationMode"],
  evidence: string,
): StableLayoutFamily["navigationMode"] {
  if (/sidebar|side navigation|侧栏|侧边导航/iu.test(evidence)) return "side";
  if (/minimal navigation|no navigation|极简导航|弱导航/iu.test(evidence)) return "minimal";
  if (/top navigation|header navigation|顶部导航|顶栏导航/iu.test(evidence)) return "top";
  return fallback;
}

function motifFromPlan(
  fallback: StableLayoutFamily["motif"],
  evidence: string,
): StableLayoutFamily["motif"] {
  const rules: Array<[StableLayoutFamily["motif"], RegExp]> = [
    ["route-line", /route|map|path|路线|地图|路径/iu],
    ["status-band", /status|alert|incident|状态|告警|事故/iu],
    ["chapter-index", /chapter|index|章节|索引/iu],
    ["media-cut", /media|asymmetric|image break|媒体|非对称|图像断点/iu],
    ["data-spine", /data|metric|telemetry|数据|指标|遥测/iu],
    ["signal-rail", /signal|hud|pulse|信号|脉冲/iu],
  ];
  return rules.find(([, pattern]) => pattern.test(evidence))?.[0] ?? fallback;
}

const SECTION_KIND_RULES: Array<[SectionKind, RegExp]> = [
  ["metrics", /metric|kpi|指标/iu],
  ["data-table", /table|record|表格|台账/iu],
  ["timeline", /timeline|chronology|时间线|时间轴/iu],
  ["gallery", /gallery|image|画廊|图像|作品/iu],
  ["map", /map|route|地图|路线/iu],
  ["story", /story|narrative|故事|叙事/iu],
  ["feature-list", /feature|capability|功能|能力/iu],
  ["matrix", /matrix|comparison|矩阵|对比/iu],
  ["quotes", /quote|testimonial|引语|评价/iu],
  ["faq", /faq|question|常见问题|问答/iu],
];

function sectionOrderFromPlan(
  fallback: StableLayoutFamily["sectionOrder"],
  designPlan?: DesignPlan,
): StableLayoutFamily["sectionOrder"] {
  if (!designPlan) return [...fallback];
  const planned = designPlan.visualDNA.sectionRhythm.flatMap((entry) =>
    SECTION_KIND_RULES.filter(([, pattern]) => pattern.test(entry)).map(([kind]) => kind),
  );
  return [...new Set([...planned, ...fallback])];
}

export function deriveStableLayoutFamily(
  content: StablePageContent,
  designPlan?: DesignPlan,
): StableLayoutFamily {
  const candidates = FAMILY_CANDIDATES[content.applicationType];
  const semantic = semanticEvidence(content);
  const plan = designEvidence(designPlan);
  const template = content.templateVariant.toLowerCase();
  const seed = stableHash(`${content.brand.title}|${content.templateVariant}|${semantic}|${plan}`);

  const intentCandidate = resolveIntentCandidate(content.applicationType, semantic);
  const scored = candidates.map((item, index) => {
    const semanticHits = item.hints.reduce((count, hint) => count + (hint.test(semantic) ? 1 : 0), 0);
    const planHits = item.hints.reduce((count, hint) => count + (hint.test(plan) ? 1 : 0), 0);
    const templateHits = item.hints.reduce((count, hint) => count + (hint.test(template) ? 1 : 0), 0);
    const sectionAffinity = item.sectionOrder.reduce(
      (count, kind) => count + (content.sections.some((section) => section.kind === kind) ? 1 : 0),
      0,
    );
    const tiebreak = ((seed + index * 2654435761) % 997) / 1000;
    return {
      item,
      score: semanticHits * 240 + planHits * 140 + templateHits * 35 + sectionAffinity * 4 + tiebreak,
    };
  });
  scored.sort((left, right) => right.score - left.score);

  const selected = intentCandidate ?? scored[0]?.item ?? candidates[seed % candidates.length]!;
  const plannedPrimitive = primitiveFromPlan(plan);
  const primaryPrimitive = plannedPrimitive ?? selected.primaryPrimitive;
  const primitives = [primaryPrimitive, ...selected.primitives.filter((item) => item !== primaryPrimitive)];
  const surfaceMode = designPlan?.visualDNA.surfaceStrategy === "contained"
    ? "contained"
    : designPlan?.visualDNA.surfaceStrategy === "open"
      ? "open"
      : selected.surfaceMode;

  return {
    family: selected.family,
    primaryPrimitive,
    primitives,
    heroMode: heroModeFromPlan(selected.heroMode, plan),
    navigationMode: navigationModeFromPlan(selected.navigationMode, plan),
    surfaceMode,
    motif: motifFromPlan(selected.motif, plan),
    sectionOrder: sectionOrderFromPlan(selected.sectionOrder, designPlan),
    evidence: [
      `applicationType=${content.applicationType}`,
      `templateVariant=${content.templateVariant}`,
      `selection=${intentCandidate ? "semantic-intent" : "weighted-fallback"}`,
      `family=${selected.family}`,
      `primaryPrimitive=${primaryPrimitive}`,
      `composition=${designPlan?.visualDNA.composition ?? "fallback"}`,
      `heroPattern=${designPlan?.visualDNA.heroPattern ?? "fallback"}`,
    ],
  };
}
