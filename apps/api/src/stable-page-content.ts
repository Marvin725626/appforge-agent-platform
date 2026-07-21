import type { ModelProvider } from "@appforge/agent-core";
import type { ApplicationType, DesignPlan } from "@appforge/protocol";
import { z } from "zod";

const TemplateVariantSchema = z.enum([
    "cinematic-stage",
    "command-console",
    "season-archive",
    "sidebar-console",
    "wide-monitor",
    "report-board",
    "product-narrative",
    "developer-launch",
    "enterprise-solution",
    "brand-story",
    "catalog-rail",
    "product-launch",
    "editorial-feature",
    "research-report",
    "institution-portal",
    "project-gallery",
    "case-study",
    "resume-story",
    "adaptive-story",
]);

const PaletteSchema = z.enum([
    "tactical-amber",
    "ocean-cyan",
    "violet-signal",
    "forest-lime",
    "sand-coral",
    "monochrome",
    "crimson-night",
]);

const FontPairSchema = z.enum([
    "system-modern",
    "editorial-serif",
    "condensed-mono",
    "geometric-sans",
]);

const SectionKindSchema = z.enum([
    "feature-list",
    "timeline",
    "matrix",
    "gallery",
    "data-table",
    "story",
    "quotes",
    "faq",
    "metrics",
    "map",
]);

const StablePageItemSchema = z.object({
    title: z.string().trim().min(1).max(72),
    meta: z.string().trim().max(48).default(""),
    description: z.string().trim().min(1).max(220),
    value: z.string().trim().max(32).default(""),
    status: z.string().trim().max(24).default(""),
});

const StablePageSectionSchema = z.object({
    id: z.string().trim().min(1).max(40),
    kind: SectionKindSchema,
    eyebrow: z.string().trim().max(36).default(""),
    title: z.string().trim().min(1).max(52),
    description: z.string().trim().min(1).max(260),
    items: z.array(StablePageItemSchema).min(2).max(8),
});

export const StablePageContentSchema = z.object({
    version: z.literal(1),
    applicationType: z.enum([
        "editorial",
        "institution",
        "dashboard",
        "commerce",
        "product",
        "portfolio",
        "game",
        "custom",
    ]),
    templateVariant: TemplateVariantSchema,
    theme: z.object({
        palette: PaletteSchema,
        fontPair: FontPairSchema,
        density: z.enum(["comfortable", "compact", "spacious"]),
    }),
    brand: z.object({
        name: z.string().trim().min(1).max(34),
        kicker: z.string().trim().min(1).max(38),
        title: z.string().trim().min(1).max(42),
        summary: z.string().trim().min(1).max(240),
        primaryAction: z.string().trim().min(1).max(16),
        secondaryAction: z.string().trim().min(1).max(18),
        statusLabel: z.string().trim().min(1).max(20),
    }),
    hero: z.object({
        imagePrompt: z.string().trim().min(1).max(500),
        imageAlt: z.string().trim().min(1).max(120),
        stats: z
            .array(
                z.object({
                    label: z.string().trim().min(1).max(20),
                    value: z.string().trim().min(1).max(32),
                }),
            )
            .min(3)
            .max(4),
    }),
    sections: z.array(StablePageSectionSchema).min(4).max(6),
    footer: z.object({
        statement: z.string().trim().min(1).max(120),
        links: z
            .array(z.string().trim().min(1).max(24))
            .min(2)
            .max(5),
    }),
});

export type StableTemplateVariant = z.infer<typeof TemplateVariantSchema>;
export type StablePageContent = z.infer<typeof StablePageContentSchema>;
export type StablePageSection = z.infer<typeof StablePageSectionSchema>;

export type GenerateStablePageContentInput = {
    goal: string;
    designPlan?: DesignPlan;
    model?: ModelProvider;
    signal?: AbortSignal;
};

export type GenerateStablePageContentResult = {
    content: StablePageContent;
    source: "ai" | "fallback";
    warnings: string[];
};

export const STABLE_TEMPLATE_VARIANTS: Record<ApplicationType, readonly StableTemplateVariant[]> = {
    game: ["cinematic-stage", "command-console", "season-archive"],
    dashboard: ["sidebar-console", "wide-monitor", "report-board"],
    product: ["product-narrative", "developer-launch", "enterprise-solution"],
    commerce: ["brand-story", "catalog-rail", "product-launch"],
    editorial: ["editorial-feature", "research-report"],
    institution: ["institution-portal", "research-report"],
    portfolio: ["project-gallery", "case-study", "resume-story"],
    custom: ["adaptive-story"],
};


export function getStableTemplateVariants(
    applicationType: ApplicationType,
): readonly StableTemplateVariant[] {
    return STABLE_TEMPLATE_VARIANTS[applicationType];
}

function stableStringHash(value: string): number {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function selectFallbackTemplateVariant(
    goal: string,
    applicationType: ApplicationType,
): StableTemplateVariant {
    const variants = getStableTemplateVariants(applicationType);
    if (variants.length === 0) {
        return "adaptive-story";
    }
    return variants[stableStringHash(goal.trim()) % variants.length] ?? variants[0] ?? "adaptive-story";
}

const TYPE_DEFAULTS: Record<
    ApplicationType,
    {
        brand: string;
        kicker: string;
        title: string;
        summary: string;
        primaryAction: string;
        secondaryAction: string;
        statusLabel: string;
        palette: z.infer<typeof PaletteSchema>;
        fontPair: z.infer<typeof FontPairSchema>;
        sectionKinds: z.infer<typeof SectionKindSchema>[];
        sectionTitles: string[];
    }
> = {
    game: {
        brand: "TACTICAL ARCHIVE",
        kicker: "LIVE OPERATION",
        title: "暗夜行动档案",
        summary: "以电影化舞台、实时读数与战术轨道组织行动叙事，让任务背景、编成、地图与阶段推进在同一战场界面中清晰展开。",
        primaryAction: "进入行动",
        secondaryAction: "查看情报",
        statusLabel: "MISSION READY",
        palette: "tactical-amber",
        fontPair: "condensed-mono",
        sectionKinds: ["timeline", "map", "matrix", "feature-list"],
        sectionTitles: ["行动时间轨", "战场点位", "干员与装备", "任务简报"],
    },
    dashboard: {
        brand: "SIGNAL OPERATIONS",
        kicker: "LIVE DATA CONTROL",
        title: "实时运营数据中枢",
        summary: "聚合关键指标、趋势、异常与执行队列，让管理者在单一视图中完成监控、判断和行动。",
        primaryAction: "查看核心指标",
        secondaryAction: "打开报告",
        statusLabel: "DATA LIVE",
        palette: "ocean-cyan",
        fontPair: "system-modern",
        sectionKinds: ["metrics", "data-table", "timeline", "feature-list"],
        sectionTitles: ["关键指标", "运行明细", "活动时间线", "决策建议"],
    },
    product: {
        brand: "PRODUCT STUDIO",
        kicker: "BUILT FOR REAL WORK",
        title: "让复杂工作自然流动",
        summary: "用清晰的产品叙事、真实工作流与能力说明呈现核心价值，帮助用户快速理解产品如何解决问题。",
        primaryAction: "开始体验",
        secondaryAction: "查看工作流",
        statusLabel: "AVAILABLE NOW",
        palette: "violet-signal",
        fontPair: "geometric-sans",
        sectionKinds: ["feature-list", "story", "matrix", "faq"],
        sectionTitles: ["核心能力", "工作方式", "能力矩阵", "常见问题"],
    },
    commerce: {
        brand: "CURATED EDITION",
        kicker: "NEW COLLECTION",
        title: "精选系列正在发布",
        summary: "以品牌故事、重点商品、规格与购买路径构成完整陈列，让视觉氛围与商品信息共同推动选择。",
        primaryAction: "探索系列",
        secondaryAction: "查看详情",
        statusLabel: "IN STOCK",
        palette: "sand-coral",
        fontPair: "editorial-serif",
        sectionKinds: ["gallery", "feature-list", "matrix", "story"],
        sectionTitles: ["精选系列", "设计亮点", "规格与选择", "品牌故事"],
    },
    editorial: {
        brand: "FIELD NOTES",
        kicker: "FEATURE STORY",
        title: "一场值得深入阅读的专题",
        summary: "通过封面、导语、章节、数据与引用建立清晰阅读节奏，让复杂议题既有观点，也有证据。",
        primaryAction: "开始阅读",
        secondaryAction: "查看摘要",
        statusLabel: "PUBLISHED",
        palette: "monochrome",
        fontPair: "editorial-serif",
        sectionKinds: ["story", "metrics", "quotes", "timeline"],
        sectionTitles: ["核心叙事", "关键数据", "观点与引语", "事件脉络"],
    },
    institution: {
        brand: "PUBLIC KNOWLEDGE",
        kicker: "INSTITUTION PORTAL",
        title: "连接使命、项目与公共价值",
        summary: "以正式、可信且易检索的信息架构呈现机构使命、重点项目、研究成果与参与方式。",
        primaryAction: "了解重点项目",
        secondaryAction: "查看机构信息",
        statusLabel: "PUBLIC ACCESS",
        palette: "forest-lime",
        fontPair: "system-modern",
        sectionKinds: ["feature-list", "metrics", "timeline", "story"],
        sectionTitles: ["重点项目", "影响数据", "发展历程", "使命与方法"],
    },
    portfolio: {
        brand: "SELECTED WORK",
        kicker: "PORTFOLIO 2026",
        title: "用作品讲清方法与判断",
        summary: "通过精选项目、案例过程、能力轨道与经历时间线，集中展示创作者的审美、思考和交付能力。",
        primaryAction: "查看项目",
        secondaryAction: "了解经历",
        statusLabel: "OPEN TO WORK",
        palette: "crimson-night",
        fontPair: "geometric-sans",
        sectionKinds: ["gallery", "story", "matrix", "timeline"],
        sectionTitles: ["精选项目", "案例过程", "能力矩阵", "经历时间线"],
    },
    custom: {
        brand: "APPFORGE ORIGINAL",
        kicker: "CUSTOM EXPERIENCE",
        title: "为当前需求定制的数字现场",
        summary: "以稳定单页骨架承载核心内容、关键数据、过程与行动入口，并根据设计规划自动调整视觉语言。",
        primaryAction: "进入内容",
        secondaryAction: "查看详情",
        statusLabel: "READY",
        palette: "ocean-cyan",
        fontPair: "system-modern",
        sectionKinds: ["feature-list", "story", "metrics", "timeline"],
        sectionTitles: ["核心内容", "主题叙事", "关键数据", "推进过程"],
    },
};

function compactText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, " ").trim();
    return normalized.length <= maxLength
        ? normalized
        : `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function normalizeApplicationType(designPlan?: DesignPlan): ApplicationType {
    return designPlan?.applicationType ?? "custom";
}

function fallbackItems(
    applicationType: ApplicationType,
    sectionTitle: string,
    index: number,
): StablePageContent["sections"][number]["items"] {
    const prefixes: Record<ApplicationType, string[]> = {
        game: ["侦察", "部署", "推进", "确认"],
        dashboard: ["当前", "趋势", "异常", "行动"],
        product: ["输入", "协作", "自动化", "交付"],
        commerce: ["材质", "工艺", "规格", "服务"],
        editorial: ["背景", "证据", "观点", "影响"],
        institution: ["项目", "研究", "服务", "参与"],
        portfolio: ["问题", "过程", "判断", "结果"],
        custom: ["目标", "结构", "执行", "结果"],
    };

    return prefixes[applicationType].map((prefix, itemIndex) => ({
        title: `${prefix}${itemIndex + 1}`,
        meta: `0${index + 1}.${itemIndex + 1}`,
        description: `${sectionTitle}中的${prefix}信息，围绕真实目标组织内容，并提供可快速理解的说明。`,
        value: itemIndex % 2 === 0 ? `${72 + itemIndex * 7}%` : "READY",
        status: itemIndex === 0 ? "ACTIVE" : "VERIFIED",
    }));
}

function createFallbackStablePageContent(
    goal: string,
    designPlan?: DesignPlan,
): StablePageContent {
    const applicationType = normalizeApplicationType(designPlan);
    const defaults = TYPE_DEFAULTS[applicationType];
    const sectionRhythm = designPlan?.visualDNA.sectionRhythm ?? [];
    const primaryGoal = compactText(
        designPlan?.designIntent.primaryGoal ?? goal,
        220,
    );
    const sectionTitles = defaults.sectionTitles.map(
        (title, index) => compactText(sectionRhythm[index] ?? title, 52),
    );

    const content: StablePageContent = {
        version: 1,
        applicationType,
        templateVariant: selectFallbackTemplateVariant(goal, applicationType),
        theme: {
            palette: defaults.palette,
            fontPair: defaults.fontPair,
            density:
                designPlan?.visualDNA.density === "high"
                    ? "compact"
                    : designPlan?.visualDNA.density === "low"
                      ? "spacious"
                      : "comfortable",
        },
        brand: {
            name: defaults.brand,
            kicker: defaults.kicker,
            title: defaults.title,
            summary: primaryGoal || defaults.summary,
            primaryAction: defaults.primaryAction,
            secondaryAction: defaults.secondaryAction,
            statusLabel: defaults.statusLabel,
        },
        hero: {
            imagePrompt: [
                `Create a polished hero image for a ${applicationType} website.`,
                designPlan?.visualDNA.mediaStrategy ?? "cinematic editorial composition",
                designPlan?.visualDNA.composition ?? "strong focal subject with clean negative space",
                "No text, no logos, no UI screenshots, web hero aspect ratio 16:9.",
            ].join(" "),
            imageAlt: `${defaults.title}主题视觉`,
            stats: [
                { label: "目标受众", value: compactText(designPlan?.designIntent.audience ?? "目标用户", 32) },
                { label: "内容模块", value: "04" },
                { label: "视觉策略", value: compactText(designPlan?.visualDNA.surfaceStrategy ?? "mixed", 32) },
                { label: "运行状态", value: defaults.statusLabel },
            ],
        },
        sections: sectionTitles.map((title, index) => ({
            id: `section-${index + 1}`,
            kind: defaults.sectionKinds[index] ?? "feature-list",
            eyebrow: `SECTION ${String(index + 1).padStart(2, "0")}`,
            title,
            description: `${title}围绕“${defaults.title}”展开，提供结构化信息、明确层级与可执行的下一步。`,
            items: fallbackItems(applicationType, title, index),
        })),
        footer: {
            statement: `${defaults.title} · ${compactText(goal, 72)}`,
            links: ["概览", "核心内容", "进度", "联系"],
        },
    };

    return StablePageContentSchema.parse(content);
}

function formatValidationError(error: z.ZodError): string {
    return error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
}

function parseModelContent(text: string): StablePageContent {
    const parsed = JSON.parse(text) as unknown;
    return StablePageContentSchema.parse(parsed);
}


const DASHBOARD_REQUIRED_METRICS: StablePageContent["sections"][number]["items"] = [
    {
        title: "CPU 使用率",
        meta: "阈值 75%",
        description: "跟踪核心节点的处理器负载、峰值与阈值状态，便于快速定位计算热点。",
        value: "68%",
        status: "正常",
    },
    {
        title: "内存占用",
        meta: "阈值 80%",
        description: "观察堆内存、缓存实例与回收压力，提前识别容量和泄漏风险。",
        value: "72%",
        status: "关注",
    },
    {
        title: "请求延迟 P95",
        meta: "SLA 150ms",
        description: "展示核心请求的尾延迟与基线变化，帮助判断下游依赖和连接池异常。",
        value: "126ms",
        status: "正常",
    },
];

const DASHBOARD_REQUIRED_STATS: StablePageContent["hero"]["stats"] = [
    { label: "全局健康", value: "稳定" },
    { label: "在线节点", value: "284 / 300" },
    { label: "活动告警", value: "18" },
    { label: "刷新频率", value: "10s" },
];

function includesDashboardMetric(item: StablePageContent["sections"][number]["items"][number], pattern: RegExp): boolean {
    return pattern.test(`${item.title} ${item.meta} ${item.description}`);
}

function ensureDashboardMetricItems(
    items: StablePageContent["sections"][number]["items"],
): StablePageContent["sections"][number]["items"] {
    const required: Array<{ pattern: RegExp; item: StablePageContent["sections"][number]["items"][number] }> = [
        { pattern: /\bCPU\b|处理器/iu, item: DASHBOARD_REQUIRED_METRICS[0]! },
        { pattern: /内存|memory/iu, item: DASHBOARD_REQUIRED_METRICS[1]! },
        { pattern: /请求.{0,8}延迟|延迟|latency|P95/iu, item: DASHBOARD_REQUIRED_METRICS[2]! },
    ];
    const selected = required.map(
        (requirement) =>
            items.find((item) =>
                includesDashboardMetric(item, requirement.pattern),
            ) ?? requirement.item,
    );
    const selectedTitles = new Set(selected.map((item) => item.title));
    const remaining = items.filter((item) => !selectedTitles.has(item.title));

    return [...selected, ...remaining].slice(0, 6);
}

function ensureDashboardStats(
    stats: StablePageContent["hero"]["stats"],
): StablePageContent["hero"]["stats"] {
    const required: Array<{ pattern: RegExp; item: StablePageContent["hero"]["stats"][number] }> = [
        { pattern: /健康|health/iu, item: DASHBOARD_REQUIRED_STATS[0]! },
        { pattern: /节点|node|服务/iu, item: DASHBOARD_REQUIRED_STATS[1]! },
        { pattern: /告警|alert/iu, item: DASHBOARD_REQUIRED_STATS[2]! },
        { pattern: /刷新|refresh|更新/iu, item: DASHBOARD_REQUIRED_STATS[3]! },
    ];

    return required.map(
        (requirement) =>
            stats.find((item) =>
                requirement.pattern.test(`${item.label} ${item.value}`),
            ) ?? requirement.item,
    );
}

function enforceDashboardContentContract(
    content: StablePageContent,
    fallback: StablePageContent,
): StablePageContent {
    const requiredKinds: StablePageSection["kind"][] = [
        "metrics",
        "data-table",
        "feature-list",
        "timeline",
    ];
    const selectedRequiredSections = requiredKinds
        .map(
            (kind) =>
                content.sections.find((section) => section.kind === kind) ??
                fallback.sections.find((section) => section.kind === kind),
        )
        .filter((section): section is StablePageSection => section !== undefined)
        .map((section) =>
            section.kind === "metrics"
                ? {
                      ...section,
                      items: ensureDashboardMetricItems(section.items),
                  }
                : section,
        );
    const selectedIds = new Set(selectedRequiredSections.map((section) => section.id));
    const remainingSections = content.sections.filter(
        (section) => !selectedIds.has(section.id),
    );

    return StablePageContentSchema.parse({
        ...content,
        brand: {
            ...content.brand,
            title: compactText(content.brand.title, 24),
        },
        hero: {
            ...content.hero,
            stats: ensureDashboardStats(content.hero.stats),
        },
        sections: [...selectedRequiredSections, ...remainingSections].slice(0, 6),
    });
}

function enforceApplicationContentContract(
    content: StablePageContent,
    fallback: StablePageContent,
): StablePageContent {
    if (content.applicationType === "dashboard") {
        return enforceDashboardContentContract(content, fallback);
    }

    return content;
}

function normalizeContentForDesignPlan(
    content: StablePageContent,
    designPlan: DesignPlan | undefined,
    fallback: StablePageContent,
): StablePageContent {
    const applicationType = normalizeApplicationType(designPlan);
    const allowedVariants = STABLE_TEMPLATE_VARIANTS[applicationType];
    const templateVariant = allowedVariants.includes(content.templateVariant)
        ? content.templateVariant
        : (allowedVariants[0] ?? "adaptive-story");
    const usedIds = new Set<string>();
    const sections = content.sections.map((section, index) => {
        const baseId = section.id
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff-]+/gu, "-")
            .replace(/^-+|-+$/gu, "") || `section-${index + 1}`;
        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${baseId}-${suffix}`;
            suffix += 1;
        }
        usedIds.add(id);
        return { ...section, id };
    });

    const normalized = StablePageContentSchema.parse({
        ...content,
        applicationType,
        templateVariant,
        sections,
    });

    return enforceApplicationContentContract(normalized, fallback);
}

function createContentPrompt(
    goal: string,
    designPlan: DesignPlan | undefined,
    fallback: StablePageContent,
): string {
    return [
        "Create the content and visual configuration for one stable React single-page website.",
        "You are not writing code. Return one JSON object only.",
        "All visible copy must match the user's language and domain. Do not mention templates, DesignPlan, acceptance checks, forbidden patterns, source code, or AppForge runtime.",
        "Use concise, specific, non-placeholder copy. Avoid generic marketing filler.",
        "Choose exactly 4 to 6 substantive sections. Every section needs 2 to 8 useful items.",
        "Choose a templateVariant compatible with applicationType.",
        "Allowed applicationType values: editorial, institution, dashboard, commerce, product, portfolio, game, custom.",
        `Allowed template variants by type: ${JSON.stringify(STABLE_TEMPLATE_VARIANTS)}.`,
        "Allowed palettes: tactical-amber, ocean-cyan, violet-signal, forest-lime, sand-coral, monochrome, crimson-night.",
        "Allowed font pairs: system-modern, editorial-serif, condensed-mono, geometric-sans.",
        "Allowed section kinds: feature-list, timeline, matrix, gallery, data-table, story, quotes, faq, metrics, map.",
        "For dashboard pages: use a compact operational overview instead of a marketing hero; make the first section metrics; include CPU, memory, and request latency when requested; include a data table, alert/status section, and workflow timeline; hero.stats must summarize health, nodes/services, alerts, and refresh cadence.",
        "Required JSON shape:",
        JSON.stringify(fallback, null, 2),
        "User goal:",
        goal,
        "Design plan:",
        JSON.stringify(designPlan ?? null, null, 2),
    ].join("\n\n");
}

export async function generateStablePageContent(
    input: GenerateStablePageContentInput,
): Promise<GenerateStablePageContentResult> {
    input.signal?.throwIfAborted();
    const rawFallback = createFallbackStablePageContent(
        input.goal,
        input.designPlan,
    );
    const fallback = enforceApplicationContentContract(
        rawFallback,
        rawFallback,
    );

    if (!input.model) {
        return { content: fallback, source: "fallback", warnings: [] };
    }

    const warnings: string[] = [];
    let messages = [
        {
            role: "system" as const,
            content: "You are a senior content designer. Return valid JSON only and obey the supplied schema exactly.",
        },
        {
            role: "user" as const,
            content: createContentPrompt(input.goal, input.designPlan, fallback),
        },
    ];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        input.signal?.throwIfAborted();
        try {
            const response = await input.model.complete({
                messages,
                responseFormat: "json_object",
                stream: true,
                thinking: { type: "disabled" },
                ...(input.signal ? { signal: input.signal } : {}),
            });
            const content = normalizeContentForDesignPlan(
                parseModelContent(response.content),
                input.designPlan,
                fallback,
            );
            return { content, source: "ai", warnings };
        } catch (error) {
            const detail =
                error instanceof z.ZodError
                    ? formatValidationError(error)
                    : error instanceof Error
                      ? error.message
                      : String(error);
            warnings.push(`AI content attempt ${attempt} failed: ${compactText(detail, 320)}`);
            if (attempt === 1) {
                messages = [
                    ...messages,
                    {
                        role: "user" as const,
                        content: `The previous output was invalid: ${compactText(detail, 800)}. Return a corrected complete JSON object only.`,
                    },
                ];
            }
        }
    }

    return { content: fallback, source: "fallback", warnings };
}
