import type { ApplicationType } from "@appforge/protocol";

import type {
    StablePageContent,
    StablePageSection,
} from "./stable-page-content.js";

export type AntiTemplateSeverity = "info" | "warning" | "severe";

export type AntiTemplateFindingCode =
    | "card-container-ratio"
    | "large-radius-container-ratio"
    | "homogeneous-three-column-grid"
    | "repeated-dom-pattern";

export type AntiTemplateFinding = {
    code: AntiTemplateFindingCode;
    severity: AntiTemplateSeverity;
    message: string;
    actual: number;
    warningThreshold: number;
    severeThreshold: number;
};

export type AntiTemplateThresholds = {
    cardContainerRatio: {
        warning: number;
        severe: number;
    };
    largeRadiusContainerRatio: {
        warning: number;
        severe: number;
    };
    homogeneousThreeColumnGridCount: {
        warning: number;
        severe: number;
    };
    repeatedDomPatternRatio: {
        warning: number;
        severe: number;
    };
    minimumScore: {
        warning: number;
        severe: number;
    };
};

export type AntiTemplateMetrics = {
    majorContainerCount: number;
    majorSurfaceCount: number;
    cardContainerCount: number;
    operationalPanelCount: number;
    cardContainerRatio: number;
    roundedContainerCount: number;
    largeRadiusContainerCount: number;
    largeRadiusContainerRatio: number;
    roundedSurfaceRatio: number;
    shadowedSurfaceCount: number;
    shadowedSurfaceRatio: number;
    threeColumnGridCount: number;
    homogeneousThreeColumnGridCount: number;
    equalColumnGridCount: number;
    domPatternCount: number;
    repeatedDomPatternCount: number;
    repeatedDomPatternRatio: number;
    repeatedStructureCount: number;
    largestRepeatedComponentGroup: number;
};

export type AntiTemplateReport = {
    score: number;
    level: "pass" | "warning" | "severe";
    softGatePassed: boolean;
    thresholds: AntiTemplateThresholds;
    metrics: AntiTemplateMetrics;
    findings: AntiTemplateFinding[];
    fingerprints: {
        sectionSignatures: string[];
        threeColumnSelectors: string[];
        homogeneousThreeColumnSelectors: string[];
    };
};

export type EvaluateAntiTemplateInput = {
    applicationType?: ApplicationType;
    content: StablePageContent;
    appSource: string;
    cssSource: string;
    thresholds?: Partial<AntiTemplateThresholds>;
};

export type EvaluateAntiTemplateSourceInput = {
    applicationType?: ApplicationType;
    appSource: string;
    cssSource: string;
    thresholds?: Partial<AntiTemplateThresholds>;
};

const DEFAULT_THRESHOLDS: AntiTemplateThresholds = {
    cardContainerRatio: {
        warning: 0.65,
        severe: 0.8,
    },
    largeRadiusContainerRatio: {
        warning: 0.5,
        severe: 0.7,
    },
    homogeneousThreeColumnGridCount: {
        warning: 2,
        severe: 3,
    },
    repeatedDomPatternRatio: {
        warning: 0.55,
        severe: 0.7,
    },
    minimumScore: {
        warning: 75,
        severe: 60,
    },
};

const SECTION_ITEM_SELECTORS: Record<StablePageSection["kind"], readonly string[]> = {
    "feature-list": [".feature-row"],
    timeline: [".timeline-rail li"],
    matrix: [".matrix-row"],
    gallery: [".gallery-piece"],
    "data-table": ["table"],
    story: [".story-flow article"],
    quotes: [".quote-flow article"],
    faq: [".faq-flow details"],
    metrics: [".metric-rail article"],
    map: [".map-legend > div", ".map-surface"],
};

const OPERATIONAL_SECTION_KINDS = new Set<StablePageSection["kind"]>([
    "metrics",
    "data-table",
    "matrix",
    "timeline",
]);

const OPERATIONAL_SELECTOR_PATTERN = /(?:metric|stat|kpi|dashboard|data|table|alert|status|service|timeline|matrix|chart|monitor)/iu;
const MEDIA_SELECTOR_PATTERN = /(?:gallery|media|image|logo|photo|map)/iu;
const CARD_NAME_PATTERN = /(?:card|panel|tile|box)/iu;
const GENERIC_GRID_PATTERN = /(?:grid|feature|benefit|pricing|card|panel|tile)/iu;

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function mergeThresholds(
    overrides: Partial<AntiTemplateThresholds> | undefined,
): AntiTemplateThresholds {
    return {
        cardContainerRatio: {
            ...DEFAULT_THRESHOLDS.cardContainerRatio,
            ...overrides?.cardContainerRatio,
        },
        largeRadiusContainerRatio: {
            ...DEFAULT_THRESHOLDS.largeRadiusContainerRatio,
            ...overrides?.largeRadiusContainerRatio,
        },
        homogeneousThreeColumnGridCount: {
            ...DEFAULT_THRESHOLDS.homogeneousThreeColumnGridCount,
            ...overrides?.homogeneousThreeColumnGridCount,
        },
        repeatedDomPatternRatio: {
            ...DEFAULT_THRESHOLDS.repeatedDomPatternRatio,
            ...overrides?.repeatedDomPatternRatio,
        },
        minimumScore: {
            ...DEFAULT_THRESHOLDS.minimumScore,
            ...overrides?.minimumScore,
        },
    };
}

type CssRule = {
    selector: string;
    declarations: Map<string, string>;
};

function parseCssVariables(cssSource: string): Map<string, string> {
    const variables = new Map<string, string>();
    const variablePattern = /(--[\w-]+)\s*:\s*([^;{}]+);/gu;
    for (const match of cssSource.matchAll(variablePattern)) {
        const name = match[1]?.trim();
        const value = match[2]?.trim();
        if (name && value) {
            variables.set(name, value);
        }
    }
    return variables;
}

function parseCssRules(cssSource: string): CssRule[] {
    const source = cssSource.replace(/\/\*[\s\S]*?\*\//gu, "");
    const rules: CssRule[] = [];
    const leafRulePattern = /([^{}]+)\{([^{}]*)\}/gu;

    for (const match of source.matchAll(leafRulePattern)) {
        const rawSelector = match[1]?.trim();
        const rawBody = match[2] ?? "";
        if (!rawSelector || rawSelector.startsWith("@")) {
            continue;
        }
        const declarations = new Map<string, string>();
        for (const declaration of rawBody.split(";")) {
            const separator = declaration.indexOf(":");
            if (separator <= 0) {
                continue;
            }
            const property = declaration.slice(0, separator).trim().toLowerCase();
            const value = declaration.slice(separator + 1).trim();
            if (property && value) {
                declarations.set(property, value);
            }
        }
        for (const selector of rawSelector.split(",")) {
            const normalized = selector.trim();
            if (normalized) {
                rules.push({ selector: normalized, declarations });
            }
        }
    }

    return rules;
}

function declarationsForSelector(rules: CssRule[], selector: string): Map<string, string> {
    const merged = new Map<string, string>();
    for (const rule of rules) {
        if (rule.selector === selector) {
            for (const [property, value] of rule.declarations) {
                merged.set(property, value);
            }
        }
    }
    return merged;
}

function resolveCssValue(value: string | undefined, variables: Map<string, string>): string {
    if (!value) {
        return "";
    }
    return value.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/gu, (_match, variableName: string) =>
        variables.get(variableName) ?? "0px",
    );
}

function maximumPixelValue(value: string | undefined, variables: Map<string, string>): number {
    const resolved = resolveCssValue(value, variables);
    const values = [...resolved.matchAll(/(-?\d+(?:\.\d+)?)px/gu)].map((match) =>
        Number(match[1]),
    );
    return values.length === 0 ? 0 : Math.max(...values);
}

function hasBoxSurface(declarations: Map<string, string>): boolean {
    const hasBackground = declarations.has("background") || declarations.has("background-color");
    const hasBoundary =
        declarations.has("border") ||
        declarations.has("box-shadow") ||
        declarations.has("outline");
    return hasBackground && hasBoundary;
}

function selectorClassToken(selector: string): string | undefined {
    return selector.match(/\.([A-Za-z0-9_-]+)/u)?.[1];
}

function sourceUsesSelector(appSource: string, selector: string): boolean {
    const token = selectorClassToken(selector);
    if (!token) {
        return selector === "table" && /<table[\s>]/u.test(appSource);
    }
    const classPattern = new RegExp(
        `className=(?:"[^"]*\\b${token}\\b[^"]*"|'[^']*\\b${token}\\b[^']*'|\\{[^}]*\\b${token}\\b[^}]*\\})`,
        "u",
    );
    return classPattern.test(appSource);
}

function sourceHasMappedChildren(appSource: string, selector: string): boolean {
    const token = selectorClassToken(selector);
    if (!token) {
        return false;
    }
    const markerPatterns = [
        `className="${token}"`,
        `className='${token}'`,
        token,
    ];
    const positions = markerPatterns
        .map((marker) => appSource.indexOf(marker))
        .filter((position) => position >= 0);
    if (positions.length === 0) {
        return false;
    }
    const start = Math.min(...positions);
    const nearbySource = appSource.slice(start, start + 2200);
    return /\.map\s*\(/u.test(nearbySource) && /<(?:article|div|li|section)\b/u.test(nearbySource);
}

function sourceClassTokenCount(appSource: string, token: string): number {
    const classNamePattern = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/gu;
    let count = 0;
    for (const match of appSource.matchAll(classNamePattern)) {
        const classSource = match[1] ?? match[2] ?? match[3] ?? "";
        if (new RegExp(`\\b${token}\\b`, "u").test(classSource)) {
            count += 1;
        }
    }
    return count;
}

function isProjectSurfaceSelector(selector: string): boolean {
    if (!selector.startsWith(".")) {
        return selector === "table";
    }
    if (/[>+~]/u.test(selector)) {
        return false;
    }
    if (/:(?:root|hover|focus|focus-visible|before|after|nth-|not|is|where)/u.test(selector)) {
        return false;
    }
    return true;
}

function itemFieldPattern(section: StablePageSection): string {
    const fields = ["meta", "value", "status"] as const;
    return fields
        .map((field) =>
            section.items.some((item) => item[field].trim().length > 0)
                ? field.slice(0, 1)
                : "-",
        )
        .join("");
}

function itemCountBucket(count: number): string {
    if (count <= 2) {
        return "2";
    }
    if (count <= 4) {
        return "3-4";
    }
    return "5+";
}

function sectionSignature(section: StablePageSection): string {
    return `${section.kind}|${itemCountBucket(section.items.length)}|${itemFieldPattern(section)}`;
}

function calculateRepeatedDomMetrics(sections: StablePageSection[]): {
    signatures: string[];
    repeatedCount: number;
    largestGroup: number;
    ratio: number;
} {
    const signatures = sections.map(sectionSignature);
    const counts = new Map<string, number>();
    for (const signature of signatures) {
        counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
    const duplicateExcess = [...counts.values()].reduce(
        (sum, count) => sum + Math.max(0, count - 1),
        0,
    );
    const denominator = Math.max(1, sections.length - 1);
    return {
        signatures,
        repeatedCount: duplicateExcess,
        largestGroup: Math.max(0, ...counts.values()),
        ratio: duplicateExcess / denominator,
    };
}

function activeContainerMetrics(
    content: StablePageContent,
    rules: CssRule[],
    variables: Map<string, string>,
): {
    majorContainerCount: number;
    cardContainerCount: number;
    operationalPanelCount: number;
    roundedContainerCount: number;
    largeRadiusContainerCount: number;
    shadowedSurfaceCount: number;
} {
    let majorContainerCount = 0;
    let cardContainerCount = 0;
    let operationalPanelCount = 0;
    let roundedContainerCount = 0;
    let largeRadiusContainerCount = 0;
    let shadowedSurfaceCount = 0;

    for (const section of content.sections) {
        const selectors = SECTION_ITEM_SELECTORS[section.kind];
        const weights = selectors.length === 1
            ? [section.items.length]
            : selectors.map((selector) =>
                selector === ".map-surface" ? 1 : section.items.length,
            );

        selectors.forEach((selector, index) => {
            const weight = weights[index] ?? section.items.length;
            const declarations = declarationsForSelector(rules, selector);
            const radius = Math.max(
                maximumPixelValue(declarations.get("border-radius"), variables),
                maximumPixelValue(declarations.get("border-start-start-radius"), variables),
            );
            const operational =
                OPERATIONAL_SECTION_KINDS.has(section.kind) ||
                OPERATIONAL_SELECTOR_PATTERN.test(selector);
            const namedCard = CARD_NAME_PATTERN.test(selector);
            const cardLike = namedCard || (hasBoxSurface(declarations) && radius >= 12);

            majorContainerCount += weight;
            if (operational) {
                operationalPanelCount += weight;
            }
            if (radius > 0) {
                roundedContainerCount += weight;
            }
            if (radius >= 16) {
                largeRadiusContainerCount += weight;
            }
            if (declarations.has("box-shadow")) {
                shadowedSurfaceCount += weight;
            }
            if (cardLike && (!operational || radius >= 16)) {
                cardContainerCount += weight;
            }
        });
    }

    return {
        majorContainerCount,
        cardContainerCount,
        operationalPanelCount,
        roundedContainerCount,
        largeRadiusContainerCount,
        shadowedSurfaceCount,
    };
}

function findThreeColumnGrids(
    appSource: string,
    rules: CssRule[],
): {
    selectors: string[];
    homogeneousSelectors: string[];
} {
    const selectors = new Set<string>();
    const homogeneousSelectors = new Set<string>();

    for (const rule of rules) {
        const gridColumns = rule.declarations.get("grid-template-columns") ?? "";
        if (!/repeat\(\s*3\s*,/iu.test(gridColumns)) {
            continue;
        }
        if (!sourceUsesSelector(appSource, rule.selector)) {
            continue;
        }
        selectors.add(rule.selector);

        const operational = OPERATIONAL_SELECTOR_PATTERN.test(rule.selector);
        const mediaLayout = MEDIA_SELECTOR_PATTERN.test(rule.selector);
        const genericGrid = GENERIC_GRID_PATTERN.test(rule.selector);
        const mappedChildren = sourceHasMappedChildren(appSource, rule.selector);
        if (!operational && !mediaLayout && (genericGrid || mappedChildren)) {
            homogeneousSelectors.add(rule.selector);
        }
    }

    return {
        selectors: [...selectors].sort(),
        homogeneousSelectors: [...homogeneousSelectors].sort(),
    };
}

function addRatioFinding(
    findings: AntiTemplateFinding[],
    code: AntiTemplateFindingCode,
    label: string,
    actual: number,
    warningThreshold: number,
    severeThreshold: number,
): void {
    if (actual < warningThreshold) {
        return;
    }
    const severity: AntiTemplateSeverity = actual >= severeThreshold ? "severe" : "warning";
    findings.push({
        code,
        severity,
        message: `${label}为 ${(actual * 100).toFixed(1)}%，超过${severity === "severe" ? "严重" : "警告"}阈值。`,
        actual: round(actual),
        warningThreshold,
        severeThreshold,
    });
}

function addCountFinding(
    findings: AntiTemplateFinding[],
    code: AntiTemplateFindingCode,
    label: string,
    actual: number,
    warningThreshold: number,
    severeThreshold: number,
): void {
    if (actual < warningThreshold) {
        return;
    }
    const severity: AntiTemplateSeverity = actual >= severeThreshold ? "severe" : "warning";
    findings.push({
        code,
        severity,
        message: `${label}检测到 ${actual} 处，达到${severity === "severe" ? "严重" : "警告"}阈值。`,
        actual,
        warningThreshold,
        severeThreshold,
    });
}

function normalizedPenalty(
    actual: number,
    warningThreshold: number,
    severeThreshold: number,
    maximumPenalty: number,
): number {
    if (actual < warningThreshold) {
        return 0;
    }
    if (actual >= severeThreshold) {
        return maximumPenalty;
    }
    const range = Math.max(0.0001, severeThreshold - warningThreshold);
    const progress = (actual - warningThreshold) / range;
    return maximumPenalty * (0.45 + 0.55 * progress);
}

export function evaluateAntiTemplate(
    input: EvaluateAntiTemplateInput,
): AntiTemplateReport {
    const thresholds = mergeThresholds(input.thresholds);
    const cssRules = parseCssRules(input.cssSource);
    const cssVariables = parseCssVariables(input.cssSource);
    const containers = activeContainerMetrics(input.content, cssRules, cssVariables);
    const repeatedDom = calculateRepeatedDomMetrics(input.content.sections);
    const threeColumn = findThreeColumnGrids(input.appSource, cssRules);

    const cardContainerRatio =
        containers.cardContainerCount / Math.max(1, containers.majorContainerCount);
    const largeRadiusContainerRatio =
        containers.largeRadiusContainerCount / Math.max(1, containers.majorContainerCount);
    const roundedSurfaceRatio =
        containers.roundedContainerCount / Math.max(1, containers.majorContainerCount);
    const shadowedSurfaceRatio =
        containers.shadowedSurfaceCount / Math.max(1, containers.majorContainerCount);

    const metrics: AntiTemplateMetrics = {
        ...containers,
        majorSurfaceCount: containers.majorContainerCount,
        cardContainerRatio: round(cardContainerRatio),
        largeRadiusContainerRatio: round(largeRadiusContainerRatio),
        roundedSurfaceRatio: round(roundedSurfaceRatio),
        shadowedSurfaceRatio: round(shadowedSurfaceRatio),
        threeColumnGridCount: threeColumn.selectors.length,
        homogeneousThreeColumnGridCount: threeColumn.homogeneousSelectors.length,
        equalColumnGridCount: threeColumn.selectors.length,
        domPatternCount: repeatedDom.signatures.length,
        repeatedDomPatternCount: repeatedDom.repeatedCount,
        repeatedDomPatternRatio: round(repeatedDom.ratio),
        repeatedStructureCount: repeatedDom.repeatedCount,
        largestRepeatedComponentGroup: repeatedDom.largestGroup,
    };

    const findings: AntiTemplateFinding[] = [];
    addRatioFinding(
        findings,
        "card-container-ratio",
        "卡片化主要容器比例",
        cardContainerRatio,
        thresholds.cardContainerRatio.warning,
        thresholds.cardContainerRatio.severe,
    );
    addRatioFinding(
        findings,
        "large-radius-container-ratio",
        "大圆角主要容器比例",
        largeRadiusContainerRatio,
        thresholds.largeRadiusContainerRatio.warning,
        thresholds.largeRadiusContainerRatio.severe,
    );
    addCountFinding(
        findings,
        "homogeneous-three-column-grid",
        "三列同构 Grid",
        threeColumn.homogeneousSelectors.length,
        thresholds.homogeneousThreeColumnGridCount.warning,
        thresholds.homogeneousThreeColumnGridCount.severe,
    );
    addRatioFinding(
        findings,
        "repeated-dom-pattern",
        "重复 DOM 区块比例",
        repeatedDom.ratio,
        thresholds.repeatedDomPatternRatio.warning,
        thresholds.repeatedDomPatternRatio.severe,
    );

    const penalty =
        normalizedPenalty(
            cardContainerRatio,
            thresholds.cardContainerRatio.warning,
            thresholds.cardContainerRatio.severe,
            24,
        ) +
        normalizedPenalty(
            largeRadiusContainerRatio,
            thresholds.largeRadiusContainerRatio.warning,
            thresholds.largeRadiusContainerRatio.severe,
            22,
        ) +
        normalizedPenalty(
            threeColumn.homogeneousSelectors.length,
            thresholds.homogeneousThreeColumnGridCount.warning,
            thresholds.homogeneousThreeColumnGridCount.severe,
            24,
        ) +
        normalizedPenalty(
            repeatedDom.ratio,
            thresholds.repeatedDomPatternRatio.warning,
            thresholds.repeatedDomPatternRatio.severe,
            30,
        );
    const score = Math.round(clamp(100 - penalty, 0, 100));
    const hasSevereFinding = findings.some((finding) => finding.severity === "severe");
    const hasWarningFinding = findings.some((finding) => finding.severity === "warning");
    const level: AntiTemplateReport["level"] =
        hasSevereFinding || score < thresholds.minimumScore.severe
            ? "severe"
            : hasWarningFinding || score < thresholds.minimumScore.warning
              ? "warning"
              : "pass";

    return {
        score,
        level,
        softGatePassed: level !== "severe",
        thresholds,
        metrics,
        findings,
        fingerprints: {
            sectionSignatures: repeatedDom.signatures,
            threeColumnSelectors: threeColumn.selectors,
            homogeneousThreeColumnSelectors: threeColumn.homogeneousSelectors,
        },
    };
}

function hasVisibleSurfaceDeclaration(declarations: Map<string, string>): boolean {
    return (
        declarations.has("background") ||
        declarations.has("background-color") ||
        declarations.has("border") ||
        declarations.has("box-shadow") ||
        maximumPixelValue(declarations.get("padding"), new Map()) >= 12 ||
        maximumPixelValue(declarations.get("padding-block"), new Map()) >= 12 ||
        maximumPixelValue(declarations.get("padding-inline"), new Map()) >= 12
    );
}

function sourceSurfaceScore(
    declarations: Map<string, string>,
    variables: Map<string, string>,
): number {
    let score = 0;
    if (declarations.has("background") || declarations.has("background-color")) {
        score += 1;
    }
    if (declarations.has("border") || declarations.has("outline")) {
        score += 1;
    }
    if (declarations.has("box-shadow")) {
        score += 1;
    }
    if (maximumPixelValue(declarations.get("border-radius"), variables) >= 8) {
        score += 1;
    }
    if (
        Math.max(
            maximumPixelValue(declarations.get("padding"), variables),
            maximumPixelValue(declarations.get("padding-block"), variables),
            maximumPixelValue(declarations.get("padding-inline"), variables),
        ) >= 12
    ) {
        score += 1;
    }
    return score;
}

function buildAntiTemplateReport(input: {
    thresholds: AntiTemplateThresholds;
    metrics: AntiTemplateMetrics;
    sectionSignatures: string[];
    threeColumnSelectors: string[];
    homogeneousThreeColumnSelectors: string[];
}): AntiTemplateReport {
    const findings: AntiTemplateFinding[] = [];
    addRatioFinding(
        findings,
        "card-container-ratio",
        "Card-like major container ratio",
        input.metrics.cardContainerRatio,
        input.thresholds.cardContainerRatio.warning,
        input.thresholds.cardContainerRatio.severe,
    );
    addRatioFinding(
        findings,
        "large-radius-container-ratio",
        "Large-radius major container ratio",
        input.metrics.largeRadiusContainerRatio,
        input.thresholds.largeRadiusContainerRatio.warning,
        input.thresholds.largeRadiusContainerRatio.severe,
    );
    addCountFinding(
        findings,
        "homogeneous-three-column-grid",
        "Homogeneous three-column grid",
        input.metrics.homogeneousThreeColumnGridCount,
        input.thresholds.homogeneousThreeColumnGridCount.warning,
        input.thresholds.homogeneousThreeColumnGridCount.severe,
    );
    addRatioFinding(
        findings,
        "repeated-dom-pattern",
        "Repeated component pattern ratio",
        input.metrics.repeatedDomPatternRatio,
        input.thresholds.repeatedDomPatternRatio.warning,
        input.thresholds.repeatedDomPatternRatio.severe,
    );

    const penalty =
        normalizedPenalty(
            input.metrics.cardContainerRatio,
            input.thresholds.cardContainerRatio.warning,
            input.thresholds.cardContainerRatio.severe,
            24,
        ) +
        normalizedPenalty(
            input.metrics.largeRadiusContainerRatio,
            input.thresholds.largeRadiusContainerRatio.warning,
            input.thresholds.largeRadiusContainerRatio.severe,
            22,
        ) +
        normalizedPenalty(
            input.metrics.homogeneousThreeColumnGridCount,
            input.thresholds.homogeneousThreeColumnGridCount.warning,
            input.thresholds.homogeneousThreeColumnGridCount.severe,
            24,
        ) +
        normalizedPenalty(
            input.metrics.repeatedDomPatternRatio,
            input.thresholds.repeatedDomPatternRatio.warning,
            input.thresholds.repeatedDomPatternRatio.severe,
            30,
        );
    const score = Math.round(clamp(100 - penalty, 0, 100));
    const hasSevereFinding = findings.some((finding) => finding.severity === "severe");
    const hasWarningFinding = findings.some((finding) => finding.severity === "warning");
    const level: AntiTemplateReport["level"] =
        hasSevereFinding || score < input.thresholds.minimumScore.severe
            ? "severe"
            : hasWarningFinding || score < input.thresholds.minimumScore.warning
              ? "warning"
              : "pass";

    return {
        score,
        level,
        softGatePassed: level !== "severe",
        thresholds: input.thresholds,
        metrics: input.metrics,
        findings,
        fingerprints: {
            sectionSignatures: input.sectionSignatures,
            threeColumnSelectors: input.threeColumnSelectors,
            homogeneousThreeColumnSelectors: input.homogeneousThreeColumnSelectors,
        },
    };
}

export function evaluateAntiTemplateSource(
    input: EvaluateAntiTemplateSourceInput,
): AntiTemplateReport {
    const thresholds = mergeThresholds(input.thresholds);
    const cssRules = parseCssRules(input.cssSource);
    const cssVariables = parseCssVariables(input.cssSource);
    const threeColumn = findThreeColumnGrids(input.appSource, cssRules);

    let majorContainerCount = 0;
    let cardContainerCount = 0;
    let operationalPanelCount = 0;
    let roundedContainerCount = 0;
    let largeRadiusContainerCount = 0;
    let shadowedSurfaceCount = 0;
    const signatures: string[] = [];

    for (const rule of cssRules) {
        if (!isProjectSurfaceSelector(rule.selector) || !sourceUsesSelector(input.appSource, rule.selector)) {
            continue;
        }
        if (!hasVisibleSurfaceDeclaration(rule.declarations)) {
            continue;
        }
        const token = selectorClassToken(rule.selector);
        const weight = token
            ? Math.max(1, sourceClassTokenCount(input.appSource, token))
            : 1;
        const radius = Math.max(
            maximumPixelValue(rule.declarations.get("border-radius"), cssVariables),
            maximumPixelValue(rule.declarations.get("border-start-start-radius"), cssVariables),
        );
        const operational =
            OPERATIONAL_SELECTOR_PATTERN.test(rule.selector) ||
            input.applicationType === "dashboard";
        const namedCard = CARD_NAME_PATTERN.test(rule.selector);
        const cardLike = namedCard || sourceSurfaceScore(rule.declarations, cssVariables) >= 3;

        majorContainerCount += weight;
        signatures.push(`${rule.selector}|${weight}|${cardLike ? "card" : "surface"}`);
        if (operational) {
            operationalPanelCount += weight;
        }
        if (cardLike && (!operational || radius >= 16)) {
            cardContainerCount += weight;
        }
        if (radius > 0) {
            roundedContainerCount += weight;
        }
        if (radius >= 16) {
            largeRadiusContainerCount += weight;
        }
        if (rule.declarations.has("box-shadow")) {
            shadowedSurfaceCount += weight;
        }
    }

    const repeatedStructureCount = signatures.reduce((sum, signature) => {
        const parts = signature.split("|");
        return sum + Math.max(0, Number(parts[1] ?? "1") - 1);
    }, 0);
    const largestRepeatedComponentGroup = Math.max(
        0,
        ...signatures.map((signature) => Number(signature.split("|")[1] ?? "1")),
    );
    const repeatedDomPatternRatio =
        repeatedStructureCount / Math.max(1, majorContainerCount - 1);

    const metrics: AntiTemplateMetrics = {
        majorContainerCount,
        majorSurfaceCount: majorContainerCount,
        cardContainerCount,
        operationalPanelCount,
        cardContainerRatio: round(cardContainerCount / Math.max(1, majorContainerCount)),
        roundedContainerCount,
        largeRadiusContainerCount,
        largeRadiusContainerRatio: round(
            largeRadiusContainerCount / Math.max(1, majorContainerCount),
        ),
        roundedSurfaceRatio: round(roundedContainerCount / Math.max(1, majorContainerCount)),
        shadowedSurfaceCount,
        shadowedSurfaceRatio: round(shadowedSurfaceCount / Math.max(1, majorContainerCount)),
        threeColumnGridCount: threeColumn.selectors.length,
        homogeneousThreeColumnGridCount: threeColumn.homogeneousSelectors.length,
        equalColumnGridCount: threeColumn.selectors.length,
        domPatternCount: signatures.length,
        repeatedDomPatternCount: repeatedStructureCount,
        repeatedDomPatternRatio: round(repeatedDomPatternRatio),
        repeatedStructureCount,
        largestRepeatedComponentGroup,
    };

    return buildAntiTemplateReport({
        thresholds,
        metrics,
        sectionSignatures: signatures,
        threeColumnSelectors: threeColumn.selectors,
        homogeneousThreeColumnSelectors: threeColumn.homogeneousSelectors,
    });
}

export { DEFAULT_THRESHOLDS as DEFAULT_ANTI_TEMPLATE_THRESHOLDS };
