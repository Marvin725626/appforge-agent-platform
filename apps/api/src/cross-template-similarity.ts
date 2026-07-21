import type { ApplicationType } from "@appforge/protocol";
import { inflateSync } from "node:zlib";

import type { StablePageContent } from "./stable-page-content.js";

export type TokenFingerprint = Record<string, number>;

export type ScreenshotFingerprint = {
    gridWidth: number;
    gridHeight: number;
    luminance: number[];
    edges: number[];
};

export type RuntimeLayoutTrace = {
    layoutFamily: string;
    layoutPrimitive: string;
    renderer: string;
    rootStructureSignature: string;
};

export type CrossTemplateSimilarityCaseInput = {
    id: string;
    applicationType: ApplicationType;
    templateVariant: string;
    structureTokens: TokenFingerprint;
    styleTokens: TokenFingerprint;
    screenshotFingerprint?: ScreenshotFingerprint;
    screenshotPath?: string;
    screenshotError?: string;
    runtimeTrace?: RuntimeLayoutTrace;
};

export type CrossTemplateSimilarityThresholds = {
    screenshotHigh: number;
    structureHigh: number;
    warningScore: number;
    severeScore: number;
    clusterScore: number;
};

export type CrossTemplateSimilarityPair = {
    leftId: string;
    rightId: string;
    sameApplicationType: boolean;
    screenshotSimilarity: number | null;
    structureSimilarity: number;
    styleSimilarity: number;
    repetitionScore: number;
    level: "pass" | "warning" | "severe";
};

export type CrossTemplateSimilarityCaseResult = {
    id: string;
    applicationType: ApplicationType;
    templateVariant: string;
    screenshotPath?: string;
    screenshotCaptured: boolean;
    screenshotError?: string;
    layoutFamily?: string;
    layoutPrimitive?: string;
    renderer?: string;
    rootStructureSignature?: string;
    mostSimilarCase: string | null;
    mostSimilarApplicationType: ApplicationType | null;
    mostSimilarIsSameType: boolean | null;
    screenshotSimilarity: number | null;
    structureSimilarity: number;
    styleSimilarity: number;
    repetitionScore: number;
    level: "pass" | "warning" | "severe";
};

export type CrossTemplateCluster = {
    id: string;
    members: string[];
    applicationTypes: ApplicationType[];
    averageInternalScore: number;
    crossType: boolean;
};

export type CrossTemplateSimilarityReport = {
    version: 1;
    generatedAt: string;
    viewport: {
        width: number;
        height: number;
    };
    thresholds: CrossTemplateSimilarityThresholds;
    screenshotCapture: {
        requested: boolean;
        available: boolean;
        capturedCases: string[];
        failedCases: Array<{ id: string; error: string }>;
    };
    summary: {
        totalCases: number;
        totalPairs: number;
        averageNearestNeighborScore: number;
        averageSameTypeScore: number;
        averageCrossTypeScore: number;
        warningPairs: number;
        severePairs: number;
        severeCrossTypePairs: number;
        softGatePassed: boolean;
        highestSimilarityPairs: CrossTemplateSimilarityPair[];
    };
    cases: CrossTemplateSimilarityCaseResult[];
    pairs: CrossTemplateSimilarityPair[];
    clusters: CrossTemplateCluster[];
};

export type RuntimeVisualFingerprint = {
    structureTokens: TokenFingerprint;
    styleTokens: TokenFingerprint;
    trace?: RuntimeLayoutTrace;
};

const DEFAULT_THRESHOLDS: CrossTemplateSimilarityThresholds = {
    screenshotHigh: 0.88,
    structureHigh: 0.85,
    warningScore: 75,
    severeScore: 88,
    clusterScore: 80,
};

const LAYOUT_PROPERTIES = new Set([
    "display",
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-auto-flow",
    "flex-direction",
    "flex-wrap",
    "align-items",
    "justify-content",
    "position",
    "overflow",
    "overflow-x",
    "overflow-y",
    "max-width",
    "min-width",
    "width",
    "gap",
    "row-gap",
    "column-gap",
    "padding",
    "margin",
    "border-radius",
    "clip-path",
    "box-shadow",
]);

function clamp(value: number, minimum = 0, maximum = 1): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 3): number {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function roundScore(value: number): number {
    return Math.round(value * 10) / 10;
}

function addToken(
    fingerprint: TokenFingerprint,
    token: string,
    weight = 1,
): void {
    if (!token || !Number.isFinite(weight) || weight <= 0) {
        return;
    }
    fingerprint[token] = (fingerprint[token] ?? 0) + weight;
}

function mergeTokenFingerprints(
    base: TokenFingerprint,
    extra: TokenFingerprint | undefined,
    extraWeight = 1,
): TokenFingerprint {
    const merged: TokenFingerprint = { ...base };
    if (!extra) {
        return merged;
    }
    for (const [token, count] of Object.entries(extra)) {
        addToken(merged, token, count * extraWeight);
    }
    return merged;
}

function itemCountBucket(count: number): string {
    if (count <= 2) {
        return "0-2";
    }
    if (count <= 4) {
        return "3-4";
    }
    return "5+";
}

function normalizeCssValue(property: string, value: string): string {
    const normalized = value
        .replace(/\s+/gu, " ")
        .replace(/\b-?\d+(?:\.\d+)?(?:px|rem|em|vw|vh|%)\b/gu, (numeric) => {
            const parsed = Number.parseFloat(numeric);
            if (!Number.isFinite(parsed)) {
                return numeric;
            }
            const unit = numeric.replace(/[-\d.]/gu, "");
            if (Math.abs(parsed) <= 4) {
                return `small-${unit || "number"}`;
            }
            if (Math.abs(parsed) <= 16) {
                return `medium-${unit || "number"}`;
            }
            if (Math.abs(parsed) <= 48) {
                return `large-${unit || "number"}`;
            }
            return `xlarge-${unit || "number"}`;
        })
        .trim()
        .toLowerCase();

    if (property === "grid-template-columns") {
        const repeatMatch = normalized.match(/repeat\((\d+)/u);
        if (repeatMatch?.[1]) {
            return `repeat-${repeatMatch[1]}`;
        }
        const columnCount = normalized
            .split(" ")
            .filter((part) => part && part !== "/").length;
        return `columns-${Math.max(1, Math.min(columnCount, 6))}`;
    }

    if (property === "border-radius") {
        if (/0(?:px|rem|em|%)?\b/u.test(normalized)) {
            return "square";
        }
        if (/50%|999/u.test(normalized)) {
            return "pill";
        }
    }

    return normalized.slice(0, 96);
}

function selectorRole(selector: string): string {
    const normalized = selector.toLowerCase();
    const roles: Array<[RegExp, string]> = [
        [/(?:hero|stage|masthead)/u, "hero"],
        [/(?:dashboard|shell|workspace|layout)/u, "shell"],
        [/(?:sidebar|rail)/u, "sidebar"],
        [/(?:grid|matrix)/u, "grid"],
        [/(?:table|data)/u, "table"],
        [/(?:timeline|workflow|process)/u, "timeline"],
        [/(?:card|panel|tile)/u, "card"],
        [/(?:gallery|media|image)/u, "media"],
        [/(?:nav|header)/u, "navigation"],
        [/(?:footer)/u, "footer"],
    ];
    return roles.find(([pattern]) => pattern.test(normalized))?.[1] ?? "generic";
}

export function createStaticSimilarityFingerprints(input: {
    content: StablePageContent;
    appSource: string;
    cssSource: string;
    runtime?: RuntimeVisualFingerprint;
}): {
    structureTokens: TokenFingerprint;
    styleTokens: TokenFingerprint;
} {
    const structureTokens: TokenFingerprint = {};
    const styleTokens: TokenFingerprint = {};
    const { content, appSource, cssSource } = input;

    addToken(structureTokens, `application:${content.applicationType}`, 2);
    addToken(structureTokens, `template:${content.templateVariant}`, 1);
    addToken(
        structureTokens,
        `hero-stat-count:${itemCountBucket(content.hero.stats.length)}`,
        1,
    );
    addToken(
        structureTokens,
        `section-count:${itemCountBucket(content.sections.length)}`,
        2,
    );

    content.sections.forEach((section, index) => {
        addToken(structureTokens, `section-kind:${section.kind}`, 2);
        addToken(
            structureTokens,
            `section-position:${index}:${section.kind}`,
            3,
        );
        addToken(
            structureTokens,
            `section-items:${section.kind}:${itemCountBucket(section.items.length)}`,
            1.5,
        );
        const populatedFields = ["meta", "value", "status"].filter((field) =>
            section.items.some((item) => {
                const value = item[field as keyof typeof item];
                return typeof value === "string" && value.trim().length > 0;
            }),
        );
        addToken(
            structureTokens,
            `section-fields:${section.kind}:${populatedFields.join("+") || "description"}`,
            1,
        );
    });

    for (const match of appSource.matchAll(/className=(?:"([^"]+)"|'([^']+)')/gu)) {
        const classValue = match[1] ?? match[2] ?? "";
        for (const token of classValue.split(/\s+/u)) {
            if (token && !token.includes("${")) {
                addToken(structureTokens, `source-class:${token}`, 0.15);
            }
        }
    }

    const cssWithoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//gu, "");
    const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
    for (const match of cssWithoutComments.matchAll(rulePattern)) {
        const selectorText = match[1]?.trim();
        const body = match[2] ?? "";
        if (!selectorText || selectorText.startsWith("@")) {
            continue;
        }
        const role = selectorRole(selectorText);
        for (const declaration of body.split(";")) {
            const separator = declaration.indexOf(":");
            if (separator <= 0) {
                continue;
            }
            const property = declaration.slice(0, separator).trim().toLowerCase();
            const value = declaration.slice(separator + 1).trim();
            if (!property || !value) {
                continue;
            }
            if (LAYOUT_PROPERTIES.has(property)) {
                addToken(
                    styleTokens,
                    `layout:${role}:${property}:${normalizeCssValue(property, value)}`,
                    property === "display" || property === "grid-template-columns" ? 2 : 1,
                );
            }
            if (
                property === "background" ||
                property === "background-color" ||
                property === "color" ||
                property === "border" ||
                property === "font-family" ||
                property === "font-size"
            ) {
                addToken(
                    styleTokens,
                    `surface:${role}:${property}:${normalizeCssValue(property, value)}`,
                    0.5,
                );
            }
        }
    }

    for (const match of cssSource.matchAll(/(--(?:surface-strategy|layout-primitives|radius|font-display|font-body|accent|bg))\s*:\s*([^;]+);/gu)) {
        const name = match[1];
        const value = match[2];
        if (name && value) {
            addToken(
                styleTokens,
                `token:${name}:${normalizeCssValue(name, value)}`,
                1,
            );
        }
    }

    return {
        structureTokens: mergeTokenFingerprints(
            structureTokens,
            input.runtime?.structureTokens,
            1.75,
        ),
        styleTokens: mergeTokenFingerprints(
            styleTokens,
            input.runtime?.styleTokens,
            1.5,
        ),
    };
}

export function weightedJaccard(
    left: TokenFingerprint,
    right: TokenFingerprint,
): number {
    const tokens = new Set([...Object.keys(left), ...Object.keys(right)]);
    if (tokens.size === 0) {
        return 1;
    }
    let intersection = 0;
    let union = 0;
    for (const token of tokens) {
        const leftValue = left[token] ?? 0;
        const rightValue = right[token] ?? 0;
        intersection += Math.min(leftValue, rightValue);
        union += Math.max(leftValue, rightValue);
    }
    return union <= 0 ? 1 : clamp(intersection / union);
}

function cosineSimilarity(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    if (length === 0) {
        return 1;
    }
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
        const leftValue = left[index] ?? 0;
        const rightValue = right[index] ?? 0;
        dot += leftValue * rightValue;
        leftNorm += leftValue * leftValue;
        rightNorm += rightValue * rightValue;
    }
    if (leftNorm === 0 && rightNorm === 0) {
        return 1;
    }
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return clamp(dot / Math.sqrt(leftNorm * rightNorm));
}

function centeredCorrelation(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    if (length === 0) {
        return 1;
    }
    const leftMean = left.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
    const rightMean = right.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
    const centeredLeft = left.slice(0, length).map((value) => value - leftMean);
    const centeredRight = right.slice(0, length).map((value) => value - rightMean);
    const cosine = cosineSimilarity(centeredLeft, centeredRight);
    return clamp((cosine + 1) / 2);
}

export function compareScreenshotFingerprints(
    left: ScreenshotFingerprint,
    right: ScreenshotFingerprint,
): number {
    if (
        left.gridWidth !== right.gridWidth ||
        left.gridHeight !== right.gridHeight
    ) {
        return 0;
    }
    const edgeSimilarity = cosineSimilarity(left.edges, right.edges);
    const luminanceSimilarity = centeredCorrelation(
        left.luminance,
        right.luminance,
    );
    return round(clamp(edgeSimilarity * 0.7 + luminanceSimilarity * 0.3), 4);
}

function readUInt32(buffer: Buffer, offset: number): number {
    return buffer.readUInt32BE(offset);
}

function paethPredictor(left: number, up: number, upLeft: number): number {
    const prediction = left + up - upLeft;
    const leftDistance = Math.abs(prediction - left);
    const upDistance = Math.abs(prediction - up);
    const upLeftDistance = Math.abs(prediction - upLeft);
    if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
        return left;
    }
    if (upDistance <= upLeftDistance) {
        return up;
    }
    return upLeft;
}

function decodePng(buffer: Buffer): {
    width: number;
    height: number;
    channels: number;
    pixels: Uint8Array;
} {
    const signature = buffer.subarray(0, 8);
    if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error("Screenshot fingerprinting expected a PNG image.");
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatChunks: Buffer[] = [];

    while (offset + 12 <= buffer.length) {
        const length = readUInt32(buffer, offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            throw new Error("PNG chunk exceeded the screenshot buffer.");
        }
        const data = buffer.subarray(dataStart, dataEnd);
        if (type === "IHDR") {
            width = readUInt32(data, 0);
            height = readUInt32(data, 4);
            bitDepth = data[8] ?? 0;
            colorType = data[9] ?? 0;
            interlace = data[12] ?? 0;
        } else if (type === "IDAT") {
            idatChunks.push(data);
        } else if (type === "IEND") {
            break;
        }
        offset = dataEnd + 4;
    }

    if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) {
        throw new Error(
            `Unsupported PNG screenshot format: ${width}x${height}, bitDepth=${bitDepth}, interlace=${interlace}.`,
        );
    }

    const channelsByColorType: Record<number, number> = {
        0: 1,
        2: 3,
        4: 2,
        6: 4,
    };
    const channels = channelsByColorType[colorType];
    if (!channels) {
        throw new Error(`Unsupported PNG color type ${colorType}.`);
    }

    const inflated = inflateSync(Buffer.concat(idatChunks));
    const rowLength = width * channels;
    const expectedLength = (rowLength + 1) * height;
    if (inflated.length < expectedLength) {
        throw new Error(
            `PNG pixel stream was truncated: expected ${expectedLength}, received ${inflated.length}.`,
        );
    }

    const pixels = new Uint8Array(rowLength * height);
    for (let row = 0; row < height; row += 1) {
        const sourceOffset = row * (rowLength + 1);
        const filter = inflated[sourceOffset] ?? 0;
        const targetOffset = row * rowLength;
        for (let column = 0; column < rowLength; column += 1) {
            const raw = inflated[sourceOffset + 1 + column] ?? 0;
            const left = column >= channels ? pixels[targetOffset + column - channels] ?? 0 : 0;
            const up = row > 0 ? pixels[targetOffset + column - rowLength] ?? 0 : 0;
            const upLeft =
                row > 0 && column >= channels
                    ? pixels[targetOffset + column - rowLength - channels] ?? 0
                    : 0;
            let value: number;
            switch (filter) {
                case 0:
                    value = raw;
                    break;
                case 1:
                    value = raw + left;
                    break;
                case 2:
                    value = raw + up;
                    break;
                case 3:
                    value = raw + Math.floor((left + up) / 2);
                    break;
                case 4:
                    value = raw + paethPredictor(left, up, upLeft);
                    break;
                default:
                    throw new Error(`Unsupported PNG row filter ${filter}.`);
            }
            pixels[targetOffset + column] = value & 0xff;
        }
    }

    return { width, height, channels, pixels };
}

function pixelLuminance(
    pixels: Uint8Array,
    channels: number,
    pixelIndex: number,
): number {
    const offset = pixelIndex * channels;
    if (channels === 1 || channels === 2) {
        return (pixels[offset] ?? 0) / 255;
    }
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

export function createScreenshotFingerprint(
    pngBuffer: Buffer,
    gridWidth = 32,
    gridHeight = 20,
): ScreenshotFingerprint {
    const decoded = decodePng(pngBuffer);
    const luminance: number[] = [];

    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
        const startY = Math.floor((gridY * decoded.height) / gridHeight);
        const endY = Math.max(
            startY + 1,
            Math.floor(((gridY + 1) * decoded.height) / gridHeight),
        );
        for (let gridX = 0; gridX < gridWidth; gridX += 1) {
            const startX = Math.floor((gridX * decoded.width) / gridWidth);
            const endX = Math.max(
                startX + 1,
                Math.floor(((gridX + 1) * decoded.width) / gridWidth),
            );
            const sampleStepX = Math.max(1, Math.floor((endX - startX) / 4));
            const sampleStepY = Math.max(1, Math.floor((endY - startY) / 4));
            let sum = 0;
            let count = 0;
            for (let y = startY; y < endY; y += sampleStepY) {
                for (let x = startX; x < endX; x += sampleStepX) {
                    sum += pixelLuminance(
                        decoded.pixels,
                        decoded.channels,
                        y * decoded.width + x,
                    );
                    count += 1;
                }
            }
            luminance.push(count === 0 ? 0 : sum / count);
        }
    }

    const edges: number[] = [];
    for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
            const index = y * gridWidth + x;
            const current = luminance[index] ?? 0;
            const right = luminance[y * gridWidth + Math.min(x + 1, gridWidth - 1)] ?? current;
            const down = luminance[Math.min(y + 1, gridHeight - 1) * gridWidth + x] ?? current;
            edges.push(Math.abs(current - right) + Math.abs(current - down));
        }
    }

    return {
        gridWidth,
        gridHeight,
        luminance: luminance.map((value) => round(value, 5)),
        edges: edges.map((value) => round(value, 5)),
    };
}

function pairLevel(
    screenshotSimilarity: number | null,
    structureSimilarity: number,
    repetitionScore: number,
    thresholds: CrossTemplateSimilarityThresholds,
): "pass" | "warning" | "severe" {
    if (
        repetitionScore >= thresholds.severeScore ||
        (repetitionScore >= thresholds.warningScore &&
            structureSimilarity >= thresholds.structureHigh &&
            (screenshotSimilarity ?? 0) >= thresholds.screenshotHigh)
    ) {
        return "severe";
    }
    if (
        repetitionScore >= thresholds.warningScore ||
        structureSimilarity >= thresholds.structureHigh ||
        (screenshotSimilarity ?? 0) >= thresholds.screenshotHigh
    ) {
        return "warning";
    }
    return "pass";
}

function compareCases(
    left: CrossTemplateSimilarityCaseInput,
    right: CrossTemplateSimilarityCaseInput,
    thresholds: CrossTemplateSimilarityThresholds,
): CrossTemplateSimilarityPair {
    const structureSimilarity = weightedJaccard(
        left.structureTokens,
        right.structureTokens,
    );
    const styleSimilarity = weightedJaccard(left.styleTokens, right.styleTokens);
    const screenshotSimilarity =
        left.screenshotFingerprint && right.screenshotFingerprint
            ? compareScreenshotFingerprints(
                left.screenshotFingerprint,
                right.screenshotFingerprint,
            )
            : null;
    const overall = screenshotSimilarity === null
        ? structureSimilarity * 0.62 + styleSimilarity * 0.38
        : screenshotSimilarity * 0.5 + structureSimilarity * 0.3 + styleSimilarity * 0.2;
    const repetitionScore = roundScore(clamp(overall) * 100);
    return {
        leftId: left.id,
        rightId: right.id,
        sameApplicationType: left.applicationType === right.applicationType,
        screenshotSimilarity:
            screenshotSimilarity === null ? null : round(screenshotSimilarity, 4),
        structureSimilarity: round(structureSimilarity, 4),
        styleSimilarity: round(styleSimilarity, 4),
        repetitionScore,
        level: pairLevel(
            screenshotSimilarity,
            structureSimilarity,
            repetitionScore,
            thresholds,
        ),
    };
}

class DisjointSet {
    private readonly parent = new Map<string, string>();

    add(value: string): void {
        if (!this.parent.has(value)) {
            this.parent.set(value, value);
        }
    }

    find(value: string): string {
        const parent = this.parent.get(value) ?? value;
        if (parent === value) {
            return value;
        }
        const root = this.find(parent);
        this.parent.set(value, root);
        return root;
    }

    union(left: string, right: string): void {
        const leftRoot = this.find(left);
        const rightRoot = this.find(right);
        if (leftRoot !== rightRoot) {
            this.parent.set(rightRoot, leftRoot);
        }
    }
}

function average(values: number[]): number {
    return values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createClusters(
    cases: CrossTemplateSimilarityCaseInput[],
    pairs: CrossTemplateSimilarityPair[],
    clusterScore: number,
): CrossTemplateCluster[] {
    const disjointSet = new DisjointSet();
    for (const item of cases) {
        disjointSet.add(item.id);
    }
    for (const pair of pairs) {
        if (pair.repetitionScore >= clusterScore) {
            disjointSet.union(pair.leftId, pair.rightId);
        }
    }
    const groups = new Map<string, string[]>();
    for (const item of cases) {
        const root = disjointSet.find(item.id);
        const members = groups.get(root) ?? [];
        members.push(item.id);
        groups.set(root, members);
    }
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    return [...groups.values()]
        .filter((members) => members.length > 1)
        .map((members, index) => {
            const memberSet = new Set(members);
            const internalPairs = pairs.filter(
                (pair) => memberSet.has(pair.leftId) && memberSet.has(pair.rightId),
            );
            const applicationTypes = [
                ...new Set(
                    members.flatMap((id) => {
                        const applicationType = caseMap.get(id)?.applicationType;
                        return applicationType ? [applicationType] : [];
                    }),
                ),
            ].sort() as ApplicationType[];
            return {
                id: `cluster-${String(index + 1).padStart(2, "0")}`,
                members: [...members].sort(),
                applicationTypes,
                averageInternalScore: roundScore(
                    average(internalPairs.map((pair) => pair.repetitionScore)),
                ),
                crossType: applicationTypes.length > 1,
            };
        })
        .sort((left, right) => right.averageInternalScore - left.averageInternalScore);
}

export function createCrossTemplateSimilarityReport(
    inputs: CrossTemplateSimilarityCaseInput[],
    options: {
        viewport?: { width: number; height: number };
        screenshotRequested?: boolean;
        thresholds?: Partial<CrossTemplateSimilarityThresholds>;
    } = {},
): CrossTemplateSimilarityReport {
    const thresholds: CrossTemplateSimilarityThresholds = {
        ...DEFAULT_THRESHOLDS,
        ...options.thresholds,
    };
    const pairs: CrossTemplateSimilarityPair[] = [];
    for (let leftIndex = 0; leftIndex < inputs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < inputs.length; rightIndex += 1) {
            const left = inputs[leftIndex];
            const right = inputs[rightIndex];
            if (left && right) {
                pairs.push(compareCases(left, right, thresholds));
            }
        }
    }
    pairs.sort((left, right) => right.repetitionScore - left.repetitionScore);

    const inputMap = new Map(inputs.map((input) => [input.id, input]));
    const cases: CrossTemplateSimilarityCaseResult[] = inputs.map((input) => {
        const relatedPairs = pairs.filter(
            (pair) => pair.leftId === input.id || pair.rightId === input.id,
        );
        const closest = relatedPairs[0];
        const otherId = closest
            ? closest.leftId === input.id
                ? closest.rightId
                : closest.leftId
            : null;
        const other = otherId ? inputMap.get(otherId) : undefined;
        return {
            id: input.id,
            applicationType: input.applicationType,
            templateVariant: input.templateVariant,
            ...(input.screenshotPath ? { screenshotPath: input.screenshotPath } : {}),
            screenshotCaptured: Boolean(input.screenshotFingerprint),
            ...(input.screenshotError ? { screenshotError: input.screenshotError } : {}),
            ...(input.runtimeTrace ? input.runtimeTrace : {}),
            mostSimilarCase: otherId,
            mostSimilarApplicationType: other?.applicationType ?? null,
            mostSimilarIsSameType:
                other === undefined ? null : other.applicationType === input.applicationType,
            screenshotSimilarity: closest?.screenshotSimilarity ?? null,
            structureSimilarity: closest?.structureSimilarity ?? 0,
            styleSimilarity: closest?.styleSimilarity ?? 0,
            repetitionScore: closest?.repetitionScore ?? 0,
            level: closest?.level ?? "pass",
        };
    });

    const sameTypePairs = pairs.filter((pair) => pair.sameApplicationType);
    const crossTypePairs = pairs.filter((pair) => !pair.sameApplicationType);
    const warningPairs = pairs.filter((pair) => pair.level === "warning");
    const severePairs = pairs.filter((pair) => pair.level === "severe");
    const severeCrossTypePairs = severePairs.filter(
        (pair) => !pair.sameApplicationType,
    );
    const capturedCases = inputs
        .filter((input) => input.screenshotFingerprint)
        .map((input) => input.id);
    const failedCases = inputs
        .filter((input) => input.screenshotError)
        .map((input) => ({
            id: input.id,
            error: input.screenshotError ?? "Unknown screenshot capture error.",
        }));

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        viewport: options.viewport ?? { width: 1280, height: 800 },
        thresholds,
        screenshotCapture: {
            requested: options.screenshotRequested ?? false,
            available: capturedCases.length > 0,
            capturedCases,
            failedCases,
        },
        summary: {
            totalCases: inputs.length,
            totalPairs: pairs.length,
            averageNearestNeighborScore: roundScore(
                average(cases.map((item) => item.repetitionScore)),
            ),
            averageSameTypeScore: roundScore(
                average(sameTypePairs.map((pair) => pair.repetitionScore)),
            ),
            averageCrossTypeScore: roundScore(
                average(crossTypePairs.map((pair) => pair.repetitionScore)),
            ),
            warningPairs: warningPairs.length,
            severePairs: severePairs.length,
            severeCrossTypePairs: severeCrossTypePairs.length,
            softGatePassed: severeCrossTypePairs.length === 0,
            highestSimilarityPairs: pairs.slice(0, 12),
        },
        cases,
        pairs,
        clusters: createClusters(inputs, pairs, thresholds.clusterScore),
    };
}

export function formatCrossTemplateSimilarityMarkdown(
    report: CrossTemplateSimilarityReport,
): string {
    const lines = [
        "# AppForge Cross-Template Similarity Benchmark",
        "",
        `- Generated: ${report.generatedAt}`,
        `- Viewport: ${report.viewport.width}x${report.viewport.height}`,
        `- Screenshot capture: ${report.screenshotCapture.available ? `${report.screenshotCapture.capturedCases.length}/${report.summary.totalCases}` : "unavailable"}`,
        `- Soft gate: ${report.summary.softGatePassed ? "PASS" : "WARN"}`,
        `- Average nearest-neighbor repetition: ${report.summary.averageNearestNeighborScore}/100`,
        `- Same-type pair average: ${report.summary.averageSameTypeScore}/100`,
        `- Cross-type pair average: ${report.summary.averageCrossTypeScore}/100`,
        `- Warning pairs: ${report.summary.warningPairs}`,
        `- Severe pairs: ${report.summary.severePairs}`,
        `- Severe cross-type pairs: ${report.summary.severeCrossTypePairs}`,
        "",
        "## Case nearest neighbours",
        "",
        "| Case | Type | Template | Family | Primitive | Renderer | Root signature | Screenshot | Nearest case | Nearest type | Screenshot sim | Structure sim | Style sim | Repetition | Level |",
        "|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|",
        ...report.cases.map((item) =>
            `| ${item.id} | ${item.applicationType} | ${item.templateVariant} | ${item.layoutFamily ?? "-"} | ${item.layoutPrimitive ?? "-"} | ${item.renderer ?? "-"} | ${(item.rootStructureSignature ?? "-").replace(/\|/gu, "/")} | ${item.screenshotCaptured ? "yes" : "no"} | ${item.mostSimilarCase ?? "-"} | ${item.mostSimilarApplicationType ?? "-"} | ${item.screenshotSimilarity === null ? "-" : (item.screenshotSimilarity * 100).toFixed(1)}% | ${(item.structureSimilarity * 100).toFixed(1)}% | ${(item.styleSimilarity * 100).toFixed(1)}% | ${item.repetitionScore} | ${item.level} |`,
        ),
        "",
        "## Highest similarity pairs",
        "",
        "| Pair | Scope | Screenshot | Structure | Style | Repetition | Level |",
        "|---|---|---:|---:|---:|---:|---|",
        ...report.summary.highestSimilarityPairs.map((pair) =>
            `| ${pair.leftId} ↔ ${pair.rightId} | ${pair.sameApplicationType ? "same type" : "cross type"} | ${pair.screenshotSimilarity === null ? "-" : `${(pair.screenshotSimilarity * 100).toFixed(1)}%`} | ${(pair.structureSimilarity * 100).toFixed(1)}% | ${(pair.styleSimilarity * 100).toFixed(1)}% | ${pair.repetitionScore} | ${pair.level} |`,
        ),
        "",
        "## Template clusters",
        "",
        ...(report.clusters.length === 0
            ? ["No repetition clusters exceeded the configured cluster threshold."]
            : report.clusters.flatMap((cluster) => [
                `### ${cluster.id}`,
                "",
                `- Members: ${cluster.members.join(", ")}`,
                `- Application types: ${cluster.applicationTypes.join(", ")}`,
                `- Average internal score: ${cluster.averageInternalScore}/100`,
                `- Cross type: ${cluster.crossType ? "yes" : "no"}`,
                "",
            ])),
    ];

    if (report.screenshotCapture.failedCases.length > 0) {
        lines.push(
            "## Screenshot capture failures",
            "",
            ...report.screenshotCapture.failedCases.map(
                (failure) => `- ${failure.id}: ${failure.error}`,
            ),
            "",
        );
    }

    return lines.join("\n");
}

function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function createSimilarityMatrixCsv(
    report: CrossTemplateSimilarityReport,
): string {
    const ids = report.cases.map((item) => item.id);
    const pairMap = new Map<string, number>();
    for (const pair of report.pairs) {
        pairMap.set(`${pair.leftId}\u0000${pair.rightId}`, pair.repetitionScore);
        pairMap.set(`${pair.rightId}\u0000${pair.leftId}`, pair.repetitionScore);
    }
    const rows = [
        ["case", ...ids].map(csvCell).join(","),
        ...ids.map((rowId) =>
            [
                rowId,
                ...ids.map((columnId) =>
                    rowId === columnId
                        ? 100
                        : (pairMap.get(`${rowId}\u0000${columnId}`) ?? 0),
                ),
            ]
                .map(csvCell)
                .join(","),
        ),
    ];
    return `${rows.join("\n")}\n`;
}
