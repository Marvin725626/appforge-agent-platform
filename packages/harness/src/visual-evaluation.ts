import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

export type VisualViewportId = "mobile" | "tablet" | "desktop" | "wide";

export type VisualViewportSpec = {
    id: VisualViewportId;
    width: number;
    height: number;
};

export const DEFAULT_VISUAL_VIEWPORTS: readonly VisualViewportSpec[] = [
    { id: "mobile", width: 375, height: 812 },
    { id: "tablet", width: 768, height: 1024 },
    { id: "desktop", width: 1280, height: 800 },
    { id: "wide", width: 1440, height: 900 },
] as const;

export type VisualViewportIssue = {
    selector: string;
    message: string;
};

export type VisualViewportMetrics = {
    pageOverflowPx: number;
    criticalOverlapCount: number;
    clippedElementCount: number;
    lowContrastCount: number;
    contrastSampleCount: number;
    undersizedControlCount: number;
    controlCount: number;
    tinyTextCount: number;
    textSampleCount: number;
    minimumFontSizePx?: number;
};

export type VisualViewportEvidence = {
    metrics: VisualViewportMetrics;
    overlapIssues: VisualViewportIssue[];
    clippedIssues: VisualViewportIssue[];
    contrastIssues: VisualViewportIssue[];
    controlIssues: VisualViewportIssue[];
    textIssues: VisualViewportIssue[];
};

export type VisualQualityCheck = {
    name: string;
    passed: boolean;
    message?: string;
};

export type VisualViewportResult = {
    viewport: VisualViewportSpec;
    passed: boolean;
    checks: VisualQualityCheck[];
    metrics: VisualViewportMetrics;
    screenshotPath?: string;
};

export type MultiViewportVisualReport = {
    passed: boolean;
    viewports: VisualViewportResult[];
};

const VISUAL_CHECK_PREFIX = "visual quality:";

export function isMultiViewportVisualCheckName(name: string): boolean {
    return name.startsWith(VISUAL_CHECK_PREFIX);
}

function summarizeIssues(issues: VisualViewportIssue[]): string {
    return issues
        .slice(0, 3)
        .map((issue) => `${issue.selector}: ${issue.message}`)
        .join(" | ");
}

export function createVisualViewportChecks(
    viewport: VisualViewportSpec,
    evidence: VisualViewportEvidence,
): VisualQualityCheck[] {
    const label = `${viewport.width}x${viewport.height}`;
    const contrastAllowance = Math.max(
        2,
        Math.floor(evidence.metrics.contrastSampleCount * 0.08),
    );
    const controlAllowance = Math.max(
        1,
        Math.floor(evidence.metrics.controlCount * 0.1),
    );
    const textAllowance = Math.max(
        2,
        Math.floor(evidence.metrics.textSampleCount * 0.08),
    );

    const checks: VisualQualityCheck[] = [
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} has no page horizontal overflow`,
            passed: evidence.metrics.pageOverflowPx <= 2,
            ...(evidence.metrics.pageOverflowPx <= 2
                ? {}
                : {
                      message: `The document is ${evidence.metrics.pageOverflowPx}px wider than the viewport. Local table scrollers are allowed, but the page itself must not overflow.`,
                  }),
        },
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} has no critical element overlap`,
            passed: evidence.metrics.criticalOverlapCount === 0,
            ...(evidence.metrics.criticalOverlapCount === 0
                ? {}
                : {
                      message: `${evidence.metrics.criticalOverlapCount} critical overlap(s) detected. ${summarizeIssues(evidence.overlapIssues)}`,
                  }),
        },
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} keeps key content inside the viewport`,
            passed: evidence.metrics.clippedElementCount === 0,
            ...(evidence.metrics.clippedElementCount === 0
                ? {}
                : {
                      message: `${evidence.metrics.clippedElementCount} visible heading/control/landmark element(s) are horizontally clipped. ${summarizeIssues(evidence.clippedIssues)}`,
                  }),
        },
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} text contrast is readable`,
            passed: evidence.metrics.lowContrastCount <= contrastAllowance,
            ...(evidence.metrics.lowContrastCount <= contrastAllowance
                ? {}
                : {
                      message: `${evidence.metrics.lowContrastCount}/${evidence.metrics.contrastSampleCount} sampled text elements fall below their WCAG contrast target. ${summarizeIssues(evidence.contrastIssues)}`,
                  }),
        },
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} interactive controls have usable targets`,
            passed:
                evidence.metrics.undersizedControlCount <= controlAllowance,
            ...(evidence.metrics.undersizedControlCount <= controlAllowance
                ? {}
                : {
                      message: `${evidence.metrics.undersizedControlCount}/${evidence.metrics.controlCount} button-like controls are smaller than 32x32px. ${summarizeIssues(evidence.controlIssues)}`,
                  }),
        },
        {
            name: `${VISUAL_CHECK_PREFIX} ${label} visible text is not excessively small`,
            passed: evidence.metrics.tinyTextCount <= textAllowance,
            ...(evidence.metrics.tinyTextCount <= textAllowance
                ? {}
                : {
                      message: `${evidence.metrics.tinyTextCount}/${evidence.metrics.textSampleCount} sampled text elements use a font size below 10.5px. ${summarizeIssues(evidence.textIssues)}`,
                  }),
        },
    ];

    return checks;
}

export async function collectMultiViewportVisualReport(input: {
    page: Page;
    goal?: string;
    artifactDirectory?: string;
    viewports?: readonly VisualViewportSpec[];
    signal?: AbortSignal;
}): Promise<MultiViewportVisualReport> {
    const viewports = input.viewports ?? DEFAULT_VISUAL_VIEWPORTS;
    const results: VisualViewportResult[] = [];

    if (input.artifactDirectory) {
        await mkdir(input.artifactDirectory, { recursive: true });
    }

    for (const viewport of viewports) {
        input.signal?.throwIfAborted();
        await input.page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
        });
        await input.page.waitForTimeout(40);

        const evidence = await input.page.evaluate<VisualViewportEvidence>(() => {
            type Rgba = { r: number; g: number; b: number; a: number };

            const viewportWidth = Math.max(window.innerWidth, 1);
            const root = document.documentElement;
            const body = document.body;
            const pageOverflowPx = Math.max(
                0,
                root.scrollWidth - root.clientWidth,
                body ? body.scrollWidth - body.clientWidth : 0,
            );
            const isVisible = (element: Element): element is HTMLElement => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    Number.parseFloat(style.opacity || "1") > 0.05 &&
                    rect.width > 1 &&
                    rect.height > 1
                );
            };
            const selectorFor = (element: Element): string => {
                if (element.id) {
                    return `#${element.id}`;
                }
                const classes = Array.from(element.classList).slice(0, 2);
                const suffix = classes.length > 0 ? `.${classes.join(".")}` : "";

                return `${element.tagName.toLowerCase()}${suffix}`;
            };
            const hasHorizontalScrollAncestor = (element: HTMLElement): boolean => {
                let current = element.parentElement;

                while (current && current !== document.body) {
                    const style = getComputedStyle(current);
                    const overflowX = style.overflowX;

                    if (
                        ["auto", "scroll"].includes(overflowX) &&
                        current.scrollWidth > current.clientWidth + 2
                    ) {
                        return true;
                    }
                    current = current.parentElement;
                }

                return false;
            };
            const keyElements = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "header, nav, aside, main, h1, h2, h3, button, input, select, textarea, [role='button']",
                ),
            )
                .filter(isVisible)
                .slice(0, 120);
            const clippedIssues = keyElements
                .filter((element) => {
                    const rect = element.getBoundingClientRect();

                    return (
                        (rect.left < -2 || rect.right > viewportWidth + 2) &&
                        !hasHorizontalScrollAncestor(element)
                    );
                })
                .slice(0, 10)
                .map((element) => {
                    const rect = element.getBoundingClientRect();

                    return {
                        selector: selectorFor(element),
                        message: `bounds ${Math.round(rect.left)}..${Math.round(rect.right)} exceed viewport width ${viewportWidth}`,
                    };
                });
            const overlapCandidates = keyElements.filter((element) => {
                const rect = element.getBoundingClientRect();

                return rect.bottom > 0 && rect.top < window.innerHeight;
            });
            const overlapIssues: VisualViewportIssue[] = [];

            for (let leftIndex = 0; leftIndex < overlapCandidates.length; leftIndex += 1) {
                const left = overlapCandidates[leftIndex];
                if (!left) continue;
                const leftRect = left.getBoundingClientRect();
                const leftArea = leftRect.width * leftRect.height;
                if (leftArea <= 0) continue;

                for (
                    let rightIndex = leftIndex + 1;
                    rightIndex < overlapCandidates.length;
                    rightIndex += 1
                ) {
                    const right = overlapCandidates[rightIndex];
                    if (!right || left.contains(right) || right.contains(left)) {
                        continue;
                    }
                    const rightRect = right.getBoundingClientRect();
                    const intersectionWidth = Math.max(
                        0,
                        Math.min(leftRect.right, rightRect.right) -
                            Math.max(leftRect.left, rightRect.left),
                    );
                    const intersectionHeight = Math.max(
                        0,
                        Math.min(leftRect.bottom, rightRect.bottom) -
                            Math.max(leftRect.top, rightRect.top),
                    );
                    const intersectionArea = intersectionWidth * intersectionHeight;
                    const smallerArea = Math.min(
                        leftArea,
                        rightRect.width * rightRect.height,
                    );

                    if (
                        intersectionArea >= 64 &&
                        smallerArea > 0 &&
                        intersectionArea / smallerArea >= 0.35
                    ) {
                        overlapIssues.push({
                            selector: `${selectorFor(left)} ↔ ${selectorFor(right)}`,
                            message: `${Math.round((intersectionArea / smallerArea) * 100)}% of the smaller element overlaps`,
                        });
                        if (overlapIssues.length >= 10) break;
                    }
                }
                if (overlapIssues.length >= 10) break;
            }

            const parseColor = (value: string): Rgba | undefined => {
                const match = value
                    .trim()
                    .match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/iu);
                if (!match) return undefined;

                return {
                    r: Number(match[1]),
                    g: Number(match[2]),
                    b: Number(match[3]),
                    a: match[4] === undefined ? 1 : Number(match[4]),
                };
            };
            const blend = (foreground: Rgba, background: Rgba): Rgba => {
                const alpha = foreground.a + background.a * (1 - foreground.a);
                if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };

                return {
                    r:
                        (foreground.r * foreground.a +
                            background.r * background.a * (1 - foreground.a)) /
                        alpha,
                    g:
                        (foreground.g * foreground.a +
                            background.g * background.a * (1 - foreground.a)) /
                        alpha,
                    b:
                        (foreground.b * foreground.a +
                            background.b * background.a * (1 - foreground.a)) /
                        alpha,
                    a: alpha,
                };
            };
            const effectiveBackground = (element: HTMLElement): Rgba | undefined => {
                let result: Rgba = { r: 255, g: 255, b: 255, a: 1 };
                const layers: Rgba[] = [];
                let current: HTMLElement | null = element;

                while (current) {
                    const style = getComputedStyle(current);
                    if (style.backgroundImage !== "none") {
                        return undefined;
                    }
                    const color = parseColor(style.backgroundColor);
                    if (color && color.a > 0) layers.push(color);
                    current = current.parentElement;
                }
                for (const layer of layers.reverse()) {
                    result = blend(layer, result);
                }

                return result;
            };
            const luminance = (color: Rgba): number => {
                const channel = (value: number): number => {
                    const normalized = value / 255;
                    return normalized <= 0.03928
                        ? normalized / 12.92
                        : ((normalized + 0.055) / 1.055) ** 2.4;
                };

                return (
                    0.2126 * channel(color.r) +
                    0.7152 * channel(color.g) +
                    0.0722 * channel(color.b)
                );
            };
            const contrastRatio = (left: Rgba, right: Rgba): number => {
                const leftLum = luminance(left);
                const rightLum = luminance(right);
                const bright = Math.max(leftLum, rightLum);
                const dark = Math.min(leftLum, rightLum);

                return (bright + 0.05) / (dark + 0.05);
            };
            const textElements = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "h1, h2, h3, h4, p, li, td, th, label, button, a, span, small, time, input, select, textarea",
                ),
            )
                .filter((element) => {
                    if (!isVisible(element)) return false;
                    const text = (element.innerText || element.textContent || "")
                        .replace(/\s+/gu, " ")
                        .trim();
                    if (text.length === 0) return false;
                    const childText = Array.from(element.children).some((child) =>
                        /^(?:H1|H2|H3|H4|P|LI|TD|TH|LABEL|BUTTON|A|SPAN|SMALL|TIME)$/u.test(
                            child.tagName,
                        ),
                    );
                    return !childText;
                })
                .slice(0, 160);
            const contrastIssues: VisualViewportIssue[] = [];
            const textIssues: VisualViewportIssue[] = [];
            let contrastSampleCount = 0;
            let lowContrastCount = 0;
            let tinyTextCount = 0;
            let minimumFontSizePx: number | undefined;

            for (const element of textElements) {
                const style = getComputedStyle(element);
                const fontSize = Number.parseFloat(style.fontSize) || 0;
                minimumFontSizePx =
                    minimumFontSizePx === undefined
                        ? fontSize
                        : Math.min(minimumFontSizePx, fontSize);
                if (fontSize > 0 && fontSize < 10.5) {
                    tinyTextCount += 1;
                    if (textIssues.length < 10) {
                        textIssues.push({
                            selector: selectorFor(element),
                            message: `font-size ${fontSize.toFixed(1)}px`,
                        });
                    }
                }
                const foreground = parseColor(style.color);
                const background = effectiveBackground(element);
                if (!foreground || !background) continue;
                contrastSampleCount += 1;
                const ratio = contrastRatio(blend(foreground, background), background);
                const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
                const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
                const target = isLarge ? 3 : 4.5;
                if (ratio + 0.01 < target) {
                    lowContrastCount += 1;
                    if (contrastIssues.length < 10) {
                        contrastIssues.push({
                            selector: selectorFor(element),
                            message: `contrast ${ratio.toFixed(2)}:1, target ${target}:1`,
                        });
                    }
                }
            }

            const controls = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "button, input:not([type='hidden']), select, textarea, [role='button']",
                ),
            ).filter(isVisible);
            const controlIssues = controls
                .filter((element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.width < 32 || rect.height < 32;
                })
                .slice(0, 10)
                .map((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                        selector: selectorFor(element),
                        message: `${Math.round(rect.width)}x${Math.round(rect.height)}px target`,
                    };
                });

            return {
                metrics: {
                    pageOverflowPx: Math.round(pageOverflowPx),
                    criticalOverlapCount: overlapIssues.length,
                    clippedElementCount: clippedIssues.length,
                    lowContrastCount,
                    contrastSampleCount,
                    undersizedControlCount: controlIssues.length,
                    controlCount: controls.length,
                    tinyTextCount,
                    textSampleCount: textElements.length,
                    ...(minimumFontSizePx === undefined
                        ? {}
                        : { minimumFontSizePx }),
                },
                overlapIssues,
                clippedIssues,
                contrastIssues,
                controlIssues,
                textIssues,
            };
        });
        const checks = createVisualViewportChecks(viewport, evidence);
        let screenshotPath: string | undefined;

        if (input.artifactDirectory) {
            screenshotPath = path.join(
                input.artifactDirectory,
                `${viewport.id}-${viewport.width}x${viewport.height}.png`,
            );
            await input.page.screenshot({
                path: screenshotPath,
                fullPage: true,
            });
        }

        results.push({
            viewport,
            passed: checks.every((check) => check.passed),
            checks,
            metrics: evidence.metrics,
            ...(screenshotPath ? { screenshotPath } : {}),
        });
    }

    return {
        passed: results.every((result) => result.passed),
        viewports: results,
    };
}
