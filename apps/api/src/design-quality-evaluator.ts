import type { ApplicationType, DesignPlan } from "@appforge/protocol";

import {
    getStableTemplateVariants,
    type StablePageContent,
    type StablePageSection,
} from "./stable-page-content.js";

export type DesignQualityDimensionId =
    | "requirementCoverage"
    | "contentQuality"
    | "visualHierarchy"
    | "templateDistinctiveness"
    | "responsiveAccessibility";

export type DesignQualityFinding = {
    dimension: DesignQualityDimensionId;
    severity: "info" | "warning" | "error";
    message: string;
};

export type DesignQualityDimension = {
    id: DesignQualityDimensionId;
    label: string;
    score: number;
    maxScore: number;
};

export type DesignQualityReport = {
    score: number;
    passed: boolean;
    threshold: number;
    dimensions: DesignQualityDimension[];
    findings: DesignQualityFinding[];
    metadata: {
        applicationType: ApplicationType;
        templateVariant: string;
        palette: string;
        fontPair: string;
        sectionKinds: StablePageSection["kind"][];
    };
};

export type EvaluateDesignQualityInput = {
    goal: string;
    expectedApplicationType?: ApplicationType;
    requiredConcepts?: string[];
    expectedSectionKinds?: StablePageSection["kind"][];
    designPlan?: DesignPlan;
    content: StablePageContent;
    appSource: string;
    cssSource: string;
    threshold?: number;
};

const PLACEHOLDER_PATTERN = /\b(?:lorem ipsum|placeholder|todo|tbd|sample text|example content)\b|占位(?:符|文案)?|待补充|示例文案/giu;
const GENERIC_MARKETING_PATTERN = /赋能未来|解锁无限可能|重新定义未来|一站式解决方案|引领新时代|极致体验|开启全新篇章/gu;
const FALLBACK_COPY_PATTERN = /围绕真实目标组织内容|提供结构化信息、明确层级与可执行的下一步|可快速理解的说明/gu;
const GENERIC_NUMBERED_TITLE_PATTERN = /^(?:[\p{Script=Han}A-Za-z_-]+)[1-9]\d*$/u;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function roundScore(value: number): number {
    return Math.round(value * 10) / 10;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function visibleText(content: StablePageContent): string {
    return normalizeText(
        [
            content.brand.name,
            content.brand.kicker,
            content.brand.title,
            content.brand.summary,
            content.brand.primaryAction,
            content.brand.secondaryAction,
            content.brand.statusLabel,
            content.hero.imageAlt,
            ...content.hero.stats.flatMap((stat) => [stat.label, stat.value]),
            ...content.sections.flatMap((section) => [
                section.eyebrow,
                section.title,
                section.description,
                ...section.items.flatMap((item) => [
                    item.title,
                    item.meta,
                    item.description,
                    item.value,
                    item.status,
                ]),
            ]),
            content.footer.statement,
            ...content.footer.links,
        ].join(" "),
    );
}

function uniqueRatio(values: string[]): number {
    if (values.length === 0) {
        return 0;
    }
    return new Set(values.map(normalizeText)).size / values.length;
}

function pushFinding(
    findings: DesignQualityFinding[],
    dimension: DesignQualityDimensionId,
    severity: DesignQualityFinding["severity"],
    message: string,
): void {
    findings.push({ dimension, severity, message });
}

function scoreRequirementCoverage(
    input: EvaluateDesignQualityInput,
    findings: DesignQualityFinding[],
): number {
    let score = 0;
    const contentText = visibleText(input.content);

    const expectedType = input.expectedApplicationType ?? input.designPlan?.applicationType;
    if (!expectedType || input.content.applicationType === expectedType) {
        score += 5;
    } else {
        pushFinding(
            findings,
            "requirementCoverage",
            "error",
            `页面类型为 ${input.content.applicationType}，期望 ${expectedType}。`,
        );
    }

    const concepts = input.requiredConcepts ?? [];
    if (concepts.length === 0) {
        score += 8;
    } else {
        const matched = concepts.filter((concept) =>
            contentText.includes(normalizeText(concept)),
        );
        score += 8 * (matched.length / concepts.length);
        const missing = concepts.filter((concept) => !matched.includes(concept));
        if (missing.length > 0) {
            pushFinding(
                findings,
                "requirementCoverage",
                "warning",
                `缺少明确的需求概念：${missing.join("、")}。`,
            );
        }
    }

    const expectedKinds = input.expectedSectionKinds ?? [];
    if (expectedKinds.length === 0) {
        score += 7;
    } else {
        const actualKinds = new Set(input.content.sections.map((section) => section.kind));
        const matchedKinds = expectedKinds.filter((kind) => actualKinds.has(kind));
        score += 7 * (matchedKinds.length / expectedKinds.length);
        const missingKinds = expectedKinds.filter((kind) => !actualKinds.has(kind));
        if (missingKinds.length > 0) {
            pushFinding(
                findings,
                "requirementCoverage",
                "warning",
                `缺少建议内容结构：${missingKinds.join(", ")}。`,
            );
        }
    }

    const hasSubstantiveSections =
        input.content.sections.length >= 4 &&
        input.content.sections.every((section) => section.items.length >= 2);
    if (hasSubstantiveSections) {
        score += 5;
    } else {
        pushFinding(
            findings,
            "requirementCoverage",
            "error",
            "页面没有形成至少四个包含实质条目的内容区块。",
        );
    }

    return clamp(score, 0, 25);
}

function scoreContentQuality(
    content: StablePageContent,
    findings: DesignQualityFinding[],
): number {
    let score = 20;
    const text = visibleText(content);
    const placeholderCount = text.match(PLACEHOLDER_PATTERN)?.length ?? 0;
    const genericCount = text.match(GENERIC_MARKETING_PATTERN)?.length ?? 0;
    const fallbackCopyCount = text.match(FALLBACK_COPY_PATTERN)?.length ?? 0;
    const titles = [content.brand.title, ...content.sections.map((section) => section.title)];
    const descriptions = [
        content.brand.summary,
        ...content.sections.map((section) => section.description),
        ...content.sections.flatMap((section) => section.items.map((item) => item.description)),
    ];

    if (placeholderCount > 0) {
        score -= Math.min(10, placeholderCount * 4);
        pushFinding(findings, "contentQuality", "error", "检测到占位或待补充文案。" );
    }
    if (genericCount > 0) {
        score -= Math.min(6, genericCount * 2);
        pushFinding(findings, "contentQuality", "warning", "文案中存在空泛营销表达。" );
    }
    if (fallbackCopyCount >= 4) {
        score -= 5;
        pushFinding(
            findings,
            "contentQuality",
            "warning",
            "文案具有明显的确定性 fallback 痕迹，建议使用 AI 场景文案替换。",
        );
    }

    const itemTitles = content.sections.flatMap((section) =>
        section.items.map((item) => item.title),
    );
    const genericNumberedTitleRatio = itemTitles.filter((title) =>
        GENERIC_NUMBERED_TITLE_PATTERN.test(title.trim()),
    ).length / Math.max(1, itemTitles.length);
    if (genericNumberedTitleRatio >= 0.5) {
        score -= 3;
        pushFinding(
            findings,
            "contentQuality",
            "warning",
            "条目标题以通用编号命名为主，场景辨识度不足。",
        );
    }

    const titleUniqueness = uniqueRatio(titles);
    const descriptionUniqueness = uniqueRatio(descriptions);
    if (titleUniqueness < 0.85) {
        score -= 3;
        pushFinding(findings, "contentQuality", "warning", "页面标题重复度偏高。" );
    }
    if (descriptionUniqueness < 0.8) {
        score -= 4;
        pushFinding(findings, "contentQuality", "warning", "说明文案重复度偏高。" );
    }

    const meaningfulDescriptions = descriptions.filter(
        (description) => normalizeText(description).length >= 12,
    ).length;
    if (meaningfulDescriptions / Math.max(1, descriptions.length) < 0.9) {
        score -= 3;
        pushFinding(findings, "contentQuality", "warning", "部分说明过短，难以支撑真实场景。" );
    }

    return clamp(score, 0, 20);
}

function scoreVisualHierarchy(
    appSource: string,
    cssSource: string,
    findings: DesignQualityFinding[],
): number {
    const checks: Array<{ passed: boolean; points: number; message: string }> = [
        { passed: /<h1[\s>]/u.test(appSource), points: 3, message: "缺少唯一主标题层级。" },
        { passed: /<h2[\s>]/u.test(appSource), points: 3, message: "缺少区块标题层级。" },
        { passed: /className="hero/u.test(appSource), points: 3, message: "缺少明确的首屏视觉容器。" },
        { passed: /className="stat-band/u.test(appSource), points: 2, message: "缺少首屏关键信息带。" },
        { passed: /primaryAction/u.test(appSource), points: 2, message: "缺少明确的主行动入口。" },
        { passed: /font-size:\s*clamp\(/u.test(cssSource), points: 2, message: "主视觉字号没有响应式层级。" },
        { passed: /display:\s*(?:grid|flex)/u.test(cssSource), points: 2, message: "页面缺少稳定的布局系统。" },
        { passed: /--project-composition:/u.test(cssSource), points: 1.5, message: "缺少 composition 元数据。" },
        { passed: /--surface-strategy:/u.test(cssSource), points: 1.5, message: "缺少 surfaceStrategy 元数据。" },
    ];

    let score = 0;
    for (const check of checks) {
        if (check.passed) {
            score += check.points;
        } else {
            pushFinding(findings, "visualHierarchy", "warning", check.message);
        }
    }
    return clamp(score, 0, 20);
}

function scoreTemplateDistinctiveness(
    content: StablePageContent,
    findings: DesignQualityFinding[],
): number {
    let score = 0;
    const compatibleVariants = getStableTemplateVariants(content.applicationType);
    if (compatibleVariants.includes(content.templateVariant)) {
        score += 5;
    } else {
        pushFinding(
            findings,
            "templateDistinctiveness",
            "error",
            `模板 ${content.templateVariant} 与 ${content.applicationType} 不兼容。`,
        );
    }

    if (content.applicationType === "custom" || content.templateVariant !== "adaptive-story") {
        score += 3;
    } else {
        pushFinding(findings, "templateDistinctiveness", "warning", "非自定义页面使用了通用 fallback 模板。" );
    }

    const sectionKindCount = new Set(content.sections.map((section) => section.kind)).size;
    score += sectionKindCount >= 4 ? 4 : sectionKindCount === 3 ? 3 : 1;
    if (sectionKindCount < 3) {
        pushFinding(findings, "templateDistinctiveness", "warning", "区块结构类型过于单一。" );
    }

    if (content.theme.palette && content.theme.fontPair && content.theme.density) {
        score += 3;
    }

    return clamp(score, 0, 15);
}

function scoreResponsiveAccessibility(
    appSource: string,
    cssSource: string,
    findings: DesignQualityFinding[],
): number {
    const checks: Array<{ passed: boolean; points: number; message: string }> = [
        { passed: /<main[\s>]/u.test(appSource), points: 2, message: "缺少 main 语义区域。" },
        { passed: /<nav[\s>]/u.test(appSource), points: 2, message: "缺少 nav 语义区域。" },
        { passed: /<footer[\s>]/u.test(appSource), points: 2, message: "缺少 footer 语义区域。" },
        { passed: /alt=\{/u.test(appSource), points: 2, message: "图片缺少动态 alt 文本。" },
        { passed: /aria-label=/u.test(appSource), points: 2, message: "关键区域缺少 aria-label。" },
        { passed: /:focus-visible/u.test(cssSource), points: 2, message: "缺少键盘焦点样式。" },
        { passed: (cssSource.match(/@media\s*\(max-width:/gu)?.length ?? 0) >= 2, points: 3, message: "响应式断点不足。" },
        { passed: /prefers-reduced-motion/u.test(cssSource), points: 2, message: "缺少 reduced-motion 处理。" },
        { passed: /overflow-x:\s*auto/u.test(cssSource), points: 1.5, message: "高密度内容缺少局部横向滚动保护。" },
        { passed: /max-width:\s*100%/u.test(cssSource) || /overflow-x:\s*hidden/u.test(cssSource), points: 1.5, message: "缺少页面级溢出保护。" },
    ];

    let score = 0;
    for (const check of checks) {
        if (check.passed) {
            score += check.points;
        } else {
            pushFinding(findings, "responsiveAccessibility", "warning", check.message);
        }
    }
    return clamp(score, 0, 20);
}

export function evaluateDesignQuality(
    input: EvaluateDesignQualityInput,
): DesignQualityReport {
    const findings: DesignQualityFinding[] = [];
    const threshold = input.threshold ?? 75;
    const rawDimensions: DesignQualityDimension[] = [
        {
            id: "requirementCoverage",
            label: "需求覆盖",
            score: scoreRequirementCoverage(input, findings),
            maxScore: 25,
        },
        {
            id: "contentQuality",
            label: "内容质量",
            score: scoreContentQuality(input.content, findings),
            maxScore: 20,
        },
        {
            id: "visualHierarchy",
            label: "视觉层级",
            score: scoreVisualHierarchy(input.appSource, input.cssSource, findings),
            maxScore: 20,
        },
        {
            id: "templateDistinctiveness",
            label: "模板辨识度",
            score: scoreTemplateDistinctiveness(input.content, findings),
            maxScore: 15,
        },
        {
            id: "responsiveAccessibility",
            label: "响应式与可访问性",
            score: scoreResponsiveAccessibility(input.appSource, input.cssSource, findings),
            maxScore: 20,
        },
    ];
    const dimensions: DesignQualityDimension[] = rawDimensions.map((dimension) => ({
        ...dimension,
        score: roundScore(dimension.score),
    }));
    const score = roundScore(
        dimensions.reduce((total, dimension) => total + dimension.score, 0),
    );

    return {
        score,
        passed: score >= threshold && !findings.some((finding) => finding.severity === "error"),
        threshold,
        dimensions,
        findings,
        metadata: {
            applicationType: input.content.applicationType,
            templateVariant: input.content.templateVariant,
            palette: input.content.theme.palette,
            fontPair: input.content.theme.fontPair,
            sectionKinds: input.content.sections.map((section) => section.kind),
        },
    };
}
