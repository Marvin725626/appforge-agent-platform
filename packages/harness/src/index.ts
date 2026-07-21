import { chromium, type Browser, type Page } from "playwright";

import {
    collectMultiViewportVisualReport,
    isMultiViewportVisualCheckName,
    type MultiViewportVisualReport,
} from "./visual-evaluation.js";

export {
    DEFAULT_VISUAL_VIEWPORTS,
    collectMultiViewportVisualReport,
    createVisualViewportChecks,
    isMultiViewportVisualCheckName,
} from "./visual-evaluation.js";
export type {
    MultiViewportVisualReport,
    VisualQualityCheck,
    VisualViewportEvidence,
    VisualViewportId,
    VisualViewportIssue,
    VisualViewportMetrics,
    VisualViewportResult,
    VisualViewportSpec,
} from "./visual-evaluation.js";

export type HarnessCheck = {
    name:string;
    passed:boolean;
};

export type HarnessResult = {
    passed:boolean;
    checks:HarnessCheck[];
};

export type EvalCheck = HarnessCheck;

export type ReactAppEvalResult = HarnessResult;

export type EvaluateReactAppInput = {
    source:string;
    goal?: string;
};

const COMMON_MOJIBAKE_PATTERNS = [
    "\u95b9",
    "\u6fde",
    "\u95bb",
    "\u7eee",
    "\u95bf",
    "\u5a11",
    "\u5a34",
    "\u7f01",
    "\u951f",
    "\u93b4",
    "\u6d93",
    "\u7c99",
    "\u9423",
];

export function evaluateChecks(checks:HarnessCheck[]):HarnessResult{
    return {
        passed: checks.every((check) => check.passed),
        checks,
    };
}

export function containsChinese(text: string | undefined): boolean {
    return /[\u4e00-\u9fff]/u.test(text ?? "");
}

export function containsLikelyMojibake(text: string): boolean {
    const matches = COMMON_MOJIBAKE_PATTERNS.filter((pattern) =>
        text.includes(pattern),
    );

    return matches.length >= 2;
}
export type BrowserCheck = {
    name: string;
    passed: boolean;
    message?: string;
};

export type BrowserEvalResult = {
    passed: boolean;
    checks: BrowserCheck[];
    evidence?: BrowserEvalEvidence[];
    visualReport?: MultiViewportVisualReport;
};

export type BrowserEvalEvidence = {
    source: "browser" | "computed_style";
    requirementId?: string;
    selector?: string;
    property?: string;
    expected?: string;
    actual?: string;
    before?: string;
    after?: string;
    beforeElement?: ElementSnapshot;
    afterElement?: ElementSnapshot;
};

export type BrowserProbe = {
    requirementId: string;
    route?: string;
    selector: string;
    viewport: {
        width: number;
        height: number;
    };
    measurement:
        | "computed_style"
        | "bounding_box"
        | "visibility"
        | "text"
        | "attribute"
        | "element_count";
    property?: string;
    expected?: string | number | boolean;
    tolerance?: number;
};

export type ElementSnapshot = {
    route: string;
    selector: string;
    viewport: {
        width: number;
        height: number;
    };
    exists: boolean;
    visible: boolean;
    text?: string;
    boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    computedStyles: Record<string, string>;
};

export type BrowserRuntimeEvidence = {
    rootExists: boolean;
    rootHasContent: boolean;
    rootHasVisibleMainContent: boolean;
    runtimeErrors: readonly string[];
};

const MAX_BROWSER_RUNTIME_ERRORS = 5;
const MAX_BROWSER_RUNTIME_ERROR_CHARACTERS = 500;

function compactBrowserRuntimeError(message: string): string {
    const normalized = message.replace(/\s+/gu, " ").trim();

    if (normalized.length <= MAX_BROWSER_RUNTIME_ERROR_CHARACTERS) {
        return normalized;
    }

    return `${normalized.slice(0, MAX_BROWSER_RUNTIME_ERROR_CHARACTERS)}...`;
}

export function createBrowserRuntimeChecks(
    evidence: BrowserRuntimeEvidence,
): BrowserCheck[] {
    const rootPassed = evidence.rootExists && evidence.rootHasContent;
    const visibleMainContentPassed =
        evidence.rootExists && evidence.rootHasVisibleMainContent;
    const runtimeErrors = [
        ...new Set(
            evidence.runtimeErrors
                .map(compactBrowserRuntimeError)
                .filter((message) => message.length > 0),
        ),
    ].slice(0, MAX_BROWSER_RUNTIME_ERRORS);

    return [
        {
            name: "application root renders",
            passed: rootPassed,
            ...(rootPassed
                ? {}
                : {
                      message: evidence.rootExists
                          ? "The #root element remained empty after the page loaded."
                          : "The page did not contain a #root application element.",
                  }),
        },
        {
            name: "has no runtime errors",
            passed: runtimeErrors.length === 0,
            ...(runtimeErrors.length === 0
                ? {}
                : {
                      message: runtimeErrors.join(" | "),
                  }),
        },
        {
            name: "has visible main content",
            passed: visibleMainContentPassed,
            ...(visibleMainContentPassed
                ? {}
                : {
                      message:
                          "The application root did not contain a visible main, section, article, h1, or substantial root child with a usable bounding box.",
                  }),
        },
    ];
}

export function isVisualPageQualityGoal(goal: string | undefined): boolean {
    return /\b(?:page|homepage|landing|dashboard|portal|site|screen|workspace|workbench|console|back[- ]?office|control\s+panel)\b|页面|界面|首页|主页|官网|门户|仪表盘|后台|看板|控制台|监控台|工作台|管理台|操作台|中控台|介绍/iu.test(
        goal ?? "",
    );
}


function isDashboardVisualGoal(goal: string | undefined): boolean {
    return /\b(?:dashboard|monitoring\s+console|operations?\s+console|control\s+panel|back[- ]?office)\b|后台|看板|仪表盘|控制台|监控台|工作台|管理台/iu.test(
        goal ?? "",
    );
}

export type DashboardAboveFoldEvidence = {
    overviewVisible: boolean;
    metricVisibility: {
        cpu: boolean;
        memory: boolean;
        latency: boolean;
    };
    dominantMediaRatio: number;
};

const DASHBOARD_VISUAL_CHECK_NAMES = {
    overview: "visual contract: dashboard operational overview is visible above the fold",
    metrics: "visual contract: dashboard core metrics are visible above the fold",
    media: "visual contract: dashboard avoids dominant marketing hero media",
} as const;

export function createDashboardAboveFoldChecks(
    goal: string | undefined,
    evidence: DashboardAboveFoldEvidence,
): BrowserCheck[] {
    if (!isDashboardVisualGoal(goal)) {
        return [];
    }

    const metricsPassed =
        evidence.metricVisibility.cpu &&
        evidence.metricVisibility.memory &&
        evidence.metricVisibility.latency;
    const mediaPassed = evidence.dominantMediaRatio <= 0.22;

    return [
        {
            name: DASHBOARD_VISUAL_CHECK_NAMES.overview,
            passed: evidence.overviewVisible,
            ...(evidence.overviewVisible
                ? {}
                : {
                      message:
                          "The first viewport does not expose a compact operational overview. A dashboard should open on health and monitoring context, not a marketing introduction.",
                  }),
        },
        {
            name: DASHBOARD_VISUAL_CHECK_NAMES.metrics,
            passed: metricsPassed,
            ...(metricsPassed
                ? {}
                : {
                      message: `CPU=${evidence.metricVisibility.cpu ? "visible" : "below fold or missing"}, memory=${evidence.metricVisibility.memory ? "visible" : "below fold or missing"}, latency=${evidence.metricVisibility.latency ? "visible" : "below fold or missing"}.`,
                  }),
        },
        {
            name: DASHBOARD_VISUAL_CHECK_NAMES.media,
            passed: mediaPassed,
            ...(mediaPassed
                ? {}
                : {
                      message: `A first-viewport image/figure occupies ${(evidence.dominantMediaRatio * 100).toFixed(1)}% of the viewport. Operational dashboards must prioritize live metrics, tables, and status evidence.`,
                  }),
        },
    ];
}

export function isAdvisoryVisualBrowserCheckName(name: string): boolean {
    return (
        Object.values(DASHBOARD_VISUAL_CHECK_NAMES).includes(
            name as (typeof DASHBOARD_VISUAL_CHECK_NAMES)[keyof typeof DASHBOARD_VISUAL_CHECK_NAMES],
        ) || isMultiViewportVisualCheckName(name)
    );
}

function isExplicitlyMinimalVisualGoal(goal: string | undefined): boolean {
    return /\b(?:simple|minimal|minimalist|single[- ]?(?:screen|page)|one[- ]page)\b|极简|最简|简单页面|单屏|单页/iu.test(
        goal ?? "",
    );
}

const PLACEHOLDER_CONTENT_PATTERNS: ReadonlyArray<{
    label: string;
    pattern: RegExp;
}> = [
    {
        label: "内容建设中",
        pattern: /(?:内容|页面|网站|功能)?(?:仍在|正在)?建设中/u,
    },
    { label: "敬请期待", pattern: /敬请期待/u },
    { label: "即将上线", pattern: /即将(?:上线|推出|开放)/u },
    { label: "暂无内容", pattern: /暂无(?:内容|数据|信息)|暂未开放/u },
    { label: "待完善", pattern: /(?:内容)?待(?:完善|补充|更新)/u },
    {
        label: "coming soon",
        pattern: /\b(?:coming\s+soon|under\s+construction|stay\s+tuned)\b/iu,
    },
    { label: "lorem ipsum", pattern: /\blorem\s+ipsum\b/iu },
    { label: "placeholder", pattern: /\bplaceholder\b/iu },
    { label: "TODO/TBD", pattern: /\b(?:TODO|TBD)\b/u },
];

function listPlaceholderContent(text: string): string[] {
    return PLACEHOLDER_CONTENT_PATTERNS.filter(({ pattern }) =>
        pattern.test(text),
    ).map(({ label }) => label);
}

function effectiveContentLength(text: string): number {
    const normalized = text.replace(/\s+/gu, " ").trim();
    const cjkCharacters = normalized.match(/[\u3400-\u9fff]/gu)?.length ?? 0;

    // CJK text carries substantially more information per character than
    // space-delimited Latin prose. Weighting it prevents a complete Chinese
    // summary from being held to an English word-length proxy.
    return normalized.length + cjkCharacters;
}

async function createVisualPageQualityChecks(
    page: Page,
    goal: string | undefined,
    signal?: AbortSignal,
): Promise<BrowserCheck[]> {
    if (!isVisualPageQualityGoal(goal)) {
        return [];
    }

    signal?.throwIfAborted();
    const pageEvidence = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("#root");
        const main =
            document.querySelector<HTMLElement>('main, [role="main"]') ?? root;
        const isVisible = (element: Element): boolean => {
            if (!(element instanceof HTMLElement)) {
                return true;
            }

            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number.parseFloat(style.opacity || "1") > 0.05 &&
                rect.width > 0 &&
                rect.height > 0
            );
        };
        const normalizedText = (main?.innerText ?? main?.textContent ?? "")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 20_000);
        const contentWeight = (text: string): number => {
            const normalized = text.replace(/\s+/gu, " ").trim();
            const cjkCharacters =
                normalized.match(/[\u3400-\u9fff]/gu)?.length ?? 0;

            return normalized.length + cjkCharacters;
        };
        const meaningfulBlocks = main
            ? Array.from(
                  main.querySelectorAll(
                      "p, li, blockquote, article, section, figure, table, dl, [class*='card' i], [class*='feature' i]",
                  ),
              ).filter((element) => {
                  if (!isVisible(element)) {
                      return false;
                  }

                  const text = (element.textContent ?? "")
                      .replace(/\s+/gu, " ")
                      .trim();

                  return (
                      text.length >= 12 ||
                      element.querySelector("img, svg, video, canvas") !== null
                  );
              }).length
            : 0;
        const contentGroups = main
            ? Array.from(main.children).filter((element) => {
                  if (
                      ["SCRIPT", "STYLE", "NAV", "HEADER", "FOOTER"].includes(
                          element.tagName,
                      ) ||
                      !isVisible(element)
                  ) {
                      return false;
                  }

                  const text = (element.textContent ?? "")
                      .replace(/\s+/gu, " ")
                      .trim();

                  return (
                      text.length >= 18 ||
                      element.querySelector("img, svg, video, canvas") !== null
                  );
              }).length
            : 0;
        const headingCount = main
            ? Array.from(
                  main.querySelectorAll('h1, h2, h3, [role="heading"]'),
              ).filter(isVisible).length
            : 0;
        const mediaCount = main
            ? Array.from(
                  main.querySelectorAll("img, svg, video, canvas, picture"),
              ).filter(isVisible).length
            : 0;
        const substantiveRegionCount = main
            ? Array.from(
                  main.querySelectorAll(
                      [
                          ":scope > section",
                          ":scope > article",
                          ":scope > div",
                          ":scope > ul",
                          ":scope > ol",
                          ":scope > * > section",
                          ":scope > * > article",
                          ":scope > * > div",
                          "[class*='card' i]",
                          "[class*='feature' i]",
                          "[class*='panel' i]",
                          "[class*='tile' i]",
                          "[class*='widget' i]",
                          "[class*='metric' i]",
                      ].join(", "),
                  ),
              ).filter((element) => {
                  if (!isVisible(element)) {
                      return false;
                  }

                  const mediaDescriptions = Array.from(
                      element.querySelectorAll(
                          "img[alt], svg[aria-label], video[aria-label], canvas[aria-label]",
                      ),
                  )
                      .map(
                          (media) =>
                              media.getAttribute("alt") ??
                              media.getAttribute("aria-label") ??
                              "",
                      )
                      .join(" ");
                  const weight = contentWeight(
                      `${element.textContent ?? ""} ${mediaDescriptions}`,
                  );
                  const hasFunctionalEvidence =
                      element.querySelector(
                          "img, svg, video, canvas, table, form, input, textarea, select, button, [role='button']",
                      ) !== null;

                  return weight >= 45 || (weight >= 12 && hasFunctionalEvidence);
              }).length
            : 0;
        const landmarkCount = Array.from(
            document.querySelectorAll(
                'header, nav, main, aside, footer, [role="navigation"], [role="main"]',
            ),
        ).filter(isVisible).length;
        const layoutCandidates = Array.from(
            document.querySelectorAll<HTMLElement>(
                "#root, header, nav, main, section, article, aside, footer, [class]",
            ),
        ).filter(isVisible);
        const styleHasLayoutDeclaration = (
            style: CSSStyleDeclaration,
        ): boolean => {
            const display = style.getPropertyValue("display").trim();

            if (
                ["flex", "grid", "inline-flex", "inline-grid"].includes(
                    display,
                )
            ) {
                return true;
            }

            return Array.from({ length: style.length }, (_, index) =>
                style.item(index).toLowerCase(),
            ).some((property) =>
                /^(?:padding(?:-|$)|background(?:-|$)|border(?:-|$)|box-shadow$|max-width$|min-width$|width$|min-height$|height$|position$|inset(?:-|$)|gap$|row-gap$|column-gap$|grid(?:-|$)|flex(?:-|$)|columns?$|overflow(?:-|$))/u.test(
                    property,
                ),
            );
        };
        const authoredLayoutSelectors: string[] = [];
        let opaqueStyleSheetCount = 0;
        const visitedStyleSheets = new Set<CSSStyleSheet>();
        const visitStyleSheet = (styleSheet: CSSStyleSheet): void => {
            if (visitedStyleSheets.has(styleSheet) || styleSheet.disabled) {
                return;
            }
            visitedStyleSheets.add(styleSheet);

            let rules: CSSRuleList;

            try {
                rules = styleSheet.cssRules;
            } catch {
                opaqueStyleSheetCount += 1;
                return;
            }

            const visitRules = (ruleList: CSSRuleList): void => {
                for (const rule of Array.from(ruleList)) {
                    if (
                        rule instanceof CSSMediaRule &&
                        !window.matchMedia(rule.conditionText).matches
                    ) {
                        continue;
                    }

                    if (
                        rule instanceof CSSSupportsRule &&
                        !CSS.supports(rule.conditionText)
                    ) {
                        continue;
                    }

                    if (
                        rule instanceof CSSStyleRule &&
                        styleHasLayoutDeclaration(rule.style)
                    ) {
                        authoredLayoutSelectors.push(rule.selectorText);
                    }

                    const nestedRules = (
                        rule as CSSRule & { cssRules?: CSSRuleList }
                    ).cssRules;

                    if (nestedRules) {
                        visitRules(nestedRules);
                    }

                    const importedStyleSheet = (
                        rule as CSSRule & { styleSheet?: CSSStyleSheet }
                    ).styleSheet;

                    if (importedStyleSheet) {
                        visitStyleSheet(importedStyleSheet);
                    }
                }
            };

            visitRules(rules);
        };

        for (const styleSheet of Array.from(document.styleSheets)) {
            visitStyleSheet(styleSheet);
        }

        const hasComputedLayoutEvidence = (element: HTMLElement): boolean => {
            const style = getComputedStyle(element);
            const numeric = (value: string): number =>
                Number.parseFloat(value) || 0;
            const hasPadding =
                numeric(style.paddingTop) >= 4 ||
                numeric(style.paddingRight) >= 4 ||
                numeric(style.paddingBottom) >= 4 ||
                numeric(style.paddingLeft) >= 4;
            const hasBorder =
                numeric(style.borderTopWidth) > 0 ||
                numeric(style.borderRightWidth) > 0 ||
                numeric(style.borderBottomWidth) > 0 ||
                numeric(style.borderLeftWidth) > 0;
            const hasBackground =
                style.backgroundImage !== "none" ||
                ![
                    "rgba(0, 0, 0, 0)",
                    "transparent",
                ].includes(style.backgroundColor);

            return (
                ["flex", "grid", "inline-flex", "inline-grid"].includes(
                    style.display,
                ) ||
                hasPadding ||
                hasBorder ||
                hasBackground ||
                numeric(style.borderRadius) > 0 ||
                style.boxShadow !== "none" ||
                style.maxWidth !== "none" ||
                ["sticky", "fixed", "absolute"].includes(style.position)
            );
        };
        const authoredLayoutCount = layoutCandidates.filter((element) => {
            const hasMatchingAuthorRule = authoredLayoutSelectors.some(
                (selector) => {
                    try {
                        return element.matches(selector);
                    } catch {
                        return false;
                    }
                },
            );
            const hasInlineLayout = styleHasLayoutDeclaration(element.style);

            return (
                (hasMatchingAuthorRule || hasInlineLayout) &&
                hasComputedLayoutEvidence(element)
            );
        }).length;
        const navLinks = Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
                'nav a[href], [role="navigation"] a[href], header a[href]',
            ),
        ).filter(isVisible);
        const defaultNavLinkCount = navLinks.filter((link) => {
            const style = getComputedStyle(link);
            const color = style.color.replace(/\s+/gu, "").toLowerCase();
            const isUserAgentLinkColor = [
                "rgb(0,0,238)",
                "rgba(0,0,238,1)",
                "rgb(85,26,139)",
                "rgba(85,26,139,1)",
            ].includes(color);

            return (
                isUserAgentLinkColor &&
                style.textDecorationLine.includes("underline") &&
                Number.parseFloat(style.paddingTop) === 0 &&
                Number.parseFloat(style.paddingLeft) === 0
            );
        }).length;
        const bodyStyle = getComputedStyle(document.body);
        const bodyUsesBrowserDefaults =
            Math.abs(Number.parseFloat(bodyStyle.marginTop) - 8) < 0.5 &&
            /times new roman|serif/iu.test(bodyStyle.fontFamily);

        return {
            text: normalizedText,
            meaningfulBlocks,
            contentGroups,
            headingCount,
            mediaCount,
            substantiveRegionCount,
            landmarkCount,
            authoredLayoutCount,
            opaqueStyleSheetCount,
            navLinkCount: navLinks.length,
            defaultNavLinkCount,
            bodyUsesBrowserDefaults,
        };
    });
    const placeholderContent = listPlaceholderContent(pageEvidence.text);
    const hasNoPlaceholderContent = placeholderContent.length === 0;
    const checks: BrowserCheck[] = [
        {
            name: "contains no placeholder page content",
            passed: hasNoPlaceholderContent,
            ...(hasNoPlaceholderContent
                ? {}
                : {
                      message: `Visible main content still contains placeholder text: ${placeholderContent.join(", ")}.`,
                  }),
        },
    ];
    const isMinimalGoal = isExplicitlyMinimalVisualGoal(goal);

    if (!isMinimalGoal) {
        const effectiveText = effectiveContentLength(pageEvidence.text);
        const hasMultiRegionStructure =
            effectiveText >= 90 && pageEvidence.substantiveRegionCount >= 4;
        const hasLongFormEquivalent =
            effectiveText >= 260 && pageEvidence.meaningfulBlocks >= 4;
        const hasMediaRichEquivalent =
            effectiveText >= 40 &&
            pageEvidence.mediaCount >= 3 &&
            pageEvidence.substantiveRegionCount >= 3;
        const hasSufficientContent =
            hasMultiRegionStructure ||
            hasLongFormEquivalent ||
            hasMediaRichEquivalent;
        checks.push({
            name: "visual page has sufficient content structure",
            passed: hasSufficientContent,
            ...(hasSufficientContent
                ? {}
                : {
                      message:
                          `The initial visual page is too sparse (${effectiveText} effective text characters, ` +
                          `${pageEvidence.substantiveRegionCount} substantive regions, ${pageEvidence.contentGroups} main content groups).`,
                  }),
        });

        const defaultLinkRatio =
            pageEvidence.navLinkCount === 0
                ? 0
                : pageEvidence.defaultNavLinkCount / pageEvidence.navLinkCount;
        const appearsUnstyled =
            pageEvidence.authoredLayoutCount === 0 &&
            pageEvidence.opaqueStyleSheetCount === 0 &&
            (pageEvidence.bodyUsesBrowserDefaults || defaultLinkRatio >= 0.75);
        checks.push({
            name: "visual page has authored styling",
            passed: !appearsUnstyled,
            ...(!appearsUnstyled
                ? {}
                : {
                      message:
                          pageEvidence.defaultNavLinkCount > 0
                              ? `${pageEvidence.defaultNavLinkCount} navigation link(s) retain the browser's default blue underlined style and no authored visual layout was detected.`
                              : "The page retains browser-default typography and spacing, and no authored visual layout was detected.",
                  }),
        });
    }

    if (isDashboardVisualGoal(goal)) {
        signal?.throwIfAborted();
        const dashboardEvidence = await page.evaluate<DashboardAboveFoldEvidence>(() => {
            const viewportWidth = Math.max(window.innerWidth, 1);
            const viewportHeight = Math.max(window.innerHeight, 1);
            const isVisibleAboveFold = (element: Element | null): boolean => {
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    Number.parseFloat(style.opacity || "1") > 0.05 &&
                    rect.width >= 24 &&
                    rect.height >= 20 &&
                    rect.bottom > 0 &&
                    rect.top < viewportHeight
                );
            };
            const findMetricByText = (pattern: RegExp): HTMLElement | null =>
                Array.from(
                    document.querySelectorAll<HTMLElement>(
                        "[data-appforge-metric], article, section, [class*='metric' i]",
                    ),
                ).find((element) => pattern.test(element.innerText || element.textContent || "")) ?? null;
            const metricElement = (key: string, pattern: RegExp): HTMLElement | null =>
                document.querySelector<HTMLElement>(`[data-appforge-metric="${key}"]`) ??
                findMetricByText(pattern);
            const media = Array.from(
                document.querySelectorAll<HTMLElement>("img, figure, picture, video"),
            );
            const dominantMediaRatio = media.reduce((maxRatio, element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    Number.parseFloat(style.opacity || "1") <= 0.05 ||
                    rect.bottom <= 0 ||
                    rect.top >= viewportHeight
                ) {
                    return maxRatio;
                }
                const visibleWidth = Math.max(
                    0,
                    Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
                );
                const visibleHeight = Math.max(
                    0,
                    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
                );
                return Math.max(
                    maxRatio,
                    (visibleWidth * visibleHeight) /
                        (viewportWidth * viewportHeight),
                );
            }, 0);

            return {
                overviewVisible: isVisibleAboveFold(
                    document.querySelector('[data-appforge-role="dashboard-overview"]'),
                ),
                metricVisibility: {
                    cpu: isVisibleAboveFold(
                        metricElement("cpu", /\bCPU\b|处理器/iu),
                    ),
                    memory: isVisibleAboveFold(
                        metricElement("memory", /内存|memory/iu),
                    ),
                    latency: isVisibleAboveFold(
                        metricElement(
                            "latency",
                            /请求.{0,8}延迟|延迟|latency|P95/iu,
                        ),
                    ),
                },
                dominantMediaRatio,
            };
        });
        checks.push(...createDashboardAboveFoldChecks(goal, dashboardEvidence));
    }

    signal?.throwIfAborted();
    const brandEvidence = await page.evaluate(() => {
        const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(
                '[class*="logo" i], [class*="brand" i], header img, header svg[aria-label]',
            ),
        );
        const candidate =
            candidates.find((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);

                return (
                    rect.width >= 8 &&
                    rect.height >= 8 &&
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    Number.parseFloat(style.opacity || "1") > 0.05
                );
            }) ?? candidates[0];

        if (!candidate) {
            return {
                found: false,
                visible: true,
                contrast: undefined,
            };
        }

        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        const visible =
            rect.width >= 8 &&
            rect.height >= 8 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number.parseFloat(style.opacity || "1") > 0.05;
        const image =
            candidate instanceof HTMLImageElement
                ? candidate
                : candidate.querySelector("img");

        if (image instanceof HTMLImageElement) {
            return {
                found: true,
                visible:
                    visible &&
                    image.complete &&
                    image.naturalWidth > 0 &&
                    image.naturalHeight > 0,
                contrast: undefined,
            };
        }

        const parseColor = (value: string) => {
            const match = value.match(
                /rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/iu,
            );

            return match
                ? {
                      red: Number(match[1]),
                      green: Number(match[2]),
                      blue: Number(match[3]),
                      alpha: match[4] === undefined ? 1 : Number(match[4]),
                  }
                : undefined;
        };
        const foreground = parseColor(style.color);
        let background:
            | ReturnType<typeof parseColor>
            | undefined;
        let ancestor: Element | null = candidate;

        while (ancestor && !background) {
            const parsed = parseColor(getComputedStyle(ancestor).backgroundColor);

            if (parsed && parsed.alpha > 0.05) {
                background = parsed;
            }
            ancestor = ancestor.parentElement;
        }

        background ??= { red: 255, green: 255, blue: 255, alpha: 1 };
        const hasVisibleGradientText =
            (style.webkitTextFillColor === "transparent" ||
                style.webkitTextFillColor === "rgba(0, 0, 0, 0)") &&
            style.backgroundImage !== "none";
        const luminance = (color: NonNullable<typeof foreground>) => {
            const channel = (value: number) => {
                const normalized = value / 255;

                return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            };

            return (
                0.2126 * channel(color.red) +
                0.7152 * channel(color.green) +
                0.0722 * channel(color.blue)
            );
        };
        const foregroundLuminance = foreground
            ? luminance(foreground)
            : undefined;
        const backgroundLuminance = luminance(background);
        const contrast = hasVisibleGradientText
            ? undefined
            : foregroundLuminance === undefined
              ? 0
              : (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
                (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

        return {
            found: true,
            visible,
            contrast,
        };
    });
    const brandPassed =
        !brandEvidence.found ||
        (brandEvidence.visible &&
            (brandEvidence.contrast === undefined ||
                brandEvidence.contrast >= 2.5));
    checks.push({
        name: "brand mark remains visible",
        passed: brandPassed,
        ...(brandPassed
            ? {}
            : {
                  message:
                      brandEvidence.contrast !== undefined &&
                      brandEvidence.contrast < 2.5
                          ? `The visible logo/brand text has only ${brandEvidence.contrast.toFixed(2)}:1 contrast against its background.`
                          : "A logo/brand element exists but is hidden, empty, transparent, or failed to load.",
              }),
    });

    signal?.throwIfAborted();
    const textContrastEvidence = await page.evaluate(() => {
        type ParsedColor = {
            red: number;
            green: number;
            blue: number;
            alpha: number;
        };
        const parseColor = (value: string): ParsedColor | undefined => {
            const match = value.match(
                /rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/iu,
            );

            return match
                ? {
                      red: Number(match[1]),
                      green: Number(match[2]),
                      blue: Number(match[3]),
                      alpha: match[4] === undefined ? 1 : Number(match[4]),
                  }
                : undefined;
        };
        const parseGradientColors = (value: string): ParsedColor[] =>
            [...value.matchAll(/rgba?\([^)]+\)/giu)]
                .map((match) => parseColor(match[0] ?? ""))
                .filter(
                    (color): color is ParsedColor =>
                        color !== undefined && color.alpha > 0.35,
                );
        const luminance = (color: ParsedColor) => {
            const channel = (value: number) => {
                const normalized = value / 255;

                return normalized <= 0.04045
                    ? normalized / 12.92
                    : ((normalized + 0.055) / 1.055) ** 2.4;
            };

            return (
                0.2126 * channel(color.red) +
                0.7152 * channel(color.green) +
                0.0722 * channel(color.blue)
            );
        };
        const contrastRatio = (foreground: ParsedColor, background: ParsedColor) => {
            const foregroundLuminance = luminance(foreground);
            const backgroundLuminance = luminance(background);

            return (
                (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
                (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
            );
        };
        const isVisible = (element: HTMLElement): boolean => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number.parseFloat(style.opacity || "1") > 0.05 &&
                rect.width >= 3 &&
                rect.height >= 3
            );
        };
        const backgroundCandidatesFor = (element: HTMLElement): ParsedColor[] => {
            const candidates: ParsedColor[] = [];
            let ancestor: Element | null = element;

            while (ancestor) {
                const style = getComputedStyle(ancestor);
                const backgroundColor = parseColor(style.backgroundColor);

                if (backgroundColor && backgroundColor.alpha > 0.05) {
                    candidates.push(backgroundColor);
                    break;
                }

                const gradientColors = parseGradientColors(style.backgroundImage);

                if (gradientColors.length > 0) {
                    candidates.push(...gradientColors);
                    break;
                }

                ancestor = ancestor.parentElement;
            }

            return candidates.length > 0
                ? candidates
                : [{ red: 255, green: 255, blue: 255, alpha: 1 }];
        };
        const directVisibleTextFor = (element: HTMLElement): string =>
            Array.from(element.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? "")
                .join(" ")
                .replace(/\s+/gu, " ")
                .trim();
        const elements = Array.from(
            document.querySelectorAll<HTMLElement>(
                'body :is(h1,h2,h3,h4,p,li,td,th,a,button,span,strong,small,label,[class*="pill" i],[class*="tag" i],[class*="chip" i],[class*="hud" i])',
            ),
        )
            .filter(isVisible)
            .filter((element) => {
                const text = directVisibleTextFor(element);

                return text.length >= 1 && text.length <= 220;
            })
            .slice(0, 140);
        const offenders = elements.flatMap((element) => {
            const style = getComputedStyle(element);

            if (
                (style.webkitTextFillColor === "transparent" ||
                    style.webkitTextFillColor === "rgba(0, 0, 0, 0)") &&
                style.backgroundImage !== "none"
            ) {
                return [];
            }

            const foreground = parseColor(style.color);

            if (!foreground || foreground.alpha <= 0.35) {
                return [];
            }

            const backgrounds = backgroundCandidatesFor(element);
            const contrast = Math.min(
                ...backgrounds.map((background) =>
                    contrastRatio(foreground, background),
                ),
            );
            const fontSize = Number.parseFloat(style.fontSize);
            const fontWeight = Number.parseFloat(style.fontWeight);
            const largeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
            const threshold = largeText ? 3 : 4.5;

            if (contrast >= threshold) {
                return [];
            }

            return [
                {
                    text: directVisibleTextFor(element).slice(0, 48),
                    contrast,
                    threshold,
                },
            ];
        });

        return {
            checked: elements.length,
            offenders: offenders.slice(0, 6),
        };
    });
    const textContrastPassed = textContrastEvidence.offenders.length === 0;
    checks.push({
        name: "visible text has sufficient contrast",
        passed: textContrastPassed,
        ...(textContrastPassed
            ? {}
            : {
                  message: `Low-contrast visible text detected: ${textContrastEvidence.offenders
                      .map(
                          (offender) =>
                              `"${offender.text}" ${offender.contrast.toFixed(2)}:1 (needs ${offender.threshold}:1)`,
                      )
                      .join("; ")}.`,
              }),
    });

    signal?.throwIfAborted();
    const previousViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(50);
    const mobileEvidence = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: Math.max(
            document.documentElement.scrollWidth,
            document.body?.scrollWidth ?? 0,
        ),
    }));

    if (previousViewport) {
        await page.setViewportSize(previousViewport);
    }
    const mobileFits =
        mobileEvidence.scrollWidth <= mobileEvidence.clientWidth + 2;
    checks.push({
        name: "fits a mobile viewport",
        passed: mobileFits,
        ...(mobileFits
            ? {}
            : {
                  message: `The page is ${mobileEvidence.scrollWidth - mobileEvidence.clientWidth}px wider than a 390px mobile viewport.`,
              }),
    });

    return checks;
}

type NavigationSnapshot = {
    url: string;
    mainText: string;
    headingText: string;
    bodyText: string;
    contentBlockCount: number;
};

type NavigationCandidate = {
    index: number;
    fingerprint: string;
    label: string;
    priority: number;
    routePriority: number;
    routeTarget?: string;
    urlChangeSufficient: boolean;
};

const MAX_INDEPENDENT_ROUTE_TARGETS = 6;

const INTERNAL_NAVIGATION_SELECTOR = [
    "a[href]",
    "nav button",
    '[role="navigation"] button',
    'button[role="link"]',
    '[role="tab"]',
    '[role="link"]:not(a)',
    "header button",
    '[class*="nav" i] button',
    '[class*="menu" i] button',
    "button[data-route]",
    "button[data-target]",
    "button[aria-controls]",
].join(", ");

export function isNavigationBrowserGoal(goal: string | undefined): boolean {
    const normalizedGoal = (goal ?? "").toLowerCase();

    return (
        /导航|跳转|路由|链接|锚点|页面切换|切换页面|多页面|多页|子页面|详情页|介绍界面/u.test(
            normalizedGoal,
        ) ||
        /\b(?:navigation|navigate|routing|route|routes|jump\s+to|internal\s+links?|multi-page|multiple\s+pages|page\s+switching|switch(?:ing)?\s+(?:between\s+)?pages?)\b/iu.test(
            normalizedGoal,
        ) ||
        /\b(?:open|visit|go\s+to|link\s+to|switch\s+to)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}(?:pages?|screens?|sections?)\b/iu.test(
            normalizedGoal,
        ) ||
        /\b(?:links?|buttons?|tabs?)\b.{0,40}\b(?:navigate|open|jump|switch|route|link)\b/iu.test(
            normalizedGoal,
        ) ||
        /(?:按钮|栏目|选项卡).{0,20}(?:打开|进入|跳到|跳转到|切换到).{0,20}(?:页面|界面|栏目|部分)/u.test(
            normalizedGoal,
        )
    );
}

function isSamePageSectionNavigationGoal(
    normalizedGoal: string,
): boolean {
    return /同页|页内|页面内|锚点|区域|部分|版块|\b(?:same-page|in-page|on-page|anchors?|sections?)\b/iu.test(
        normalizedGoal,
    );
}

export function isIndependentPageNavigationGoal(
    goal: string | undefined,
): boolean {
    const normalizedGoal = (goal ?? "").toLowerCase();

    if (isSamePageSectionNavigationGoal(normalizedGoal)) {
        return false;
    }

    return (
        /独立页面|页面跳转|跳转到.{0,20}页面|(?:页面|界面).{0,20}(?:跳转|切换)|(?:跳转|切换).{0,20}(?:页面|界面)|路由|页面切换|切换页面|多页面|多页|子页面|详情页|进入.{0,20}页面|打开.{0,20}页面/u.test(
            normalizedGoal,
        ) ||
        /\b(?:routing|routes?|multi-page|multiple\s+pages|separate\s+pages|independent\s+pages|page\s+navigation|navigate\s+between\s+pages|switch(?:ing)?\s+(?:between\s+)?pages?)\b/iu.test(
            normalizedGoal,
        ) ||
        /\b(?:open|visit|go\s+to|navigate\s+to)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}pages?\b/iu.test(
            normalizedGoal,
        )
    );
}

async function listNavigationCandidates(
    page: Page,
): Promise<NavigationCandidate[]> {
    const candidates = await page
        .locator(INTERNAL_NAVIGATION_SELECTOR)
        .evaluateAll((elements) => {
            const currentUrl = new URL(window.location.href);

            return elements.flatMap((element, index) => {
                const htmlElement = element as HTMLElement;
                const tagName = element.tagName.toLowerCase();
                const role = element.getAttribute("role")?.toLowerCase() ?? "";
                const label = (
                    htmlElement.innerText ||
                    element.getAttribute("aria-label") ||
                    element.getAttribute("title") ||
                    element.getAttribute("data-route") ||
                    element.getAttribute("data-target") ||
                    role ||
                    tagName
                )
                    .replace(/\s+/gu, " ")
                    .trim()
                    .slice(0, 120);
                const ariaCurrent = element
                    .getAttribute("aria-current")
                    ?.toLowerCase();
                const ariaSelected = element
                    .getAttribute("aria-selected")
                    ?.toLowerCase();
                const ariaDisabled = element
                    .getAttribute("aria-disabled")
                    ?.toLowerCase();

                if (
                    element.hasAttribute("disabled") ||
                    ariaDisabled === "true" ||
                    (ariaCurrent !== undefined && ariaCurrent !== "false") ||
                    ariaSelected === "true"
                ) {
                    return [];
                }

                let rawHref = "";
                let routePriority = 1;
                let routeTarget: string | undefined;
                let urlChangeSufficient = true;
                const priority = element.closest(
                    'nav, [role="navigation"]',
                )
                    ? 0
                    : element.closest(
                            'header, [class*="nav" i], [class*="menu" i]',
                        )
                      ? 1
                      : 2;

                if (tagName === "a") {
                    rawHref = element.getAttribute("href")?.trim() ?? "";

                    if (
                        rawHref.length === 0 ||
                        rawHref === "#" ||
                        element.hasAttribute("download") ||
                        !["", "_self"].includes(
                            element.getAttribute("target")?.toLowerCase() ?? "",
                        )
                    ) {
                        return [];
                    }

                    const isHashTarget = rawHref.startsWith("#");

                    if (isHashTarget) {
                        if (rawHref === currentUrl.hash) {
                            return [];
                        }

                        const rawFragment = rawHref.slice(1);
                        let decodedFragment = rawFragment;

                        try {
                            decodedFragment = decodeURIComponent(rawFragment);
                        } catch {
                            // Keep the raw fragment when it is not valid URI
                            // encoding. The click may still drive an SPA route.
                        }

                        urlChangeSufficient =
                            rawHref.startsWith("#/") ||
                            rawHref.startsWith("#!") ||
                            document.getElementById(decodedFragment) !== null ||
                            document.getElementsByName(decodedFragment).length > 0;
                        routePriority =
                            rawHref.startsWith("#/") || rawHref.startsWith("#!")
                                ? 0
                                : 3;
                        routeTarget = new URL(rawHref, currentUrl).href;
                    } else {
                        let targetUrl: URL;

                        try {
                            targetUrl = new URL(rawHref, currentUrl);
                        } catch {
                            return [];
                        }

                        const isSameOriginHttpTarget =
                            ["http:", "https:"].includes(targetUrl.protocol) &&
                            targetUrl.origin === currentUrl.origin;
                        const isSameDocumentProtocolTarget =
                            targetUrl.protocol === currentUrl.protocol &&
                            targetUrl.origin === currentUrl.origin;

                        if (
                            !isSameOriginHttpTarget &&
                            !isSameDocumentProtocolTarget
                        ) {
                            return [];
                        }

                        if (
                            targetUrl.pathname === currentUrl.pathname &&
                            targetUrl.search === currentUrl.search &&
                            targetUrl.hash === currentUrl.hash
                        ) {
                            return [];
                        }

                        routePriority =
                            targetUrl.pathname !== currentUrl.pathname ||
                            targetUrl.search !== currentUrl.search
                                ? 0
                                : 3;
                        routeTarget = targetUrl.href;
                    }
                } else if (tagName === "button") {
                    const explicitType = element
                        .getAttribute("type")
                        ?.toLowerCase();

                    if (
                        explicitType === "submit" ||
                        (explicitType === undefined &&
                            element.closest("form") !== null)
                    ) {
                        return [];
                    }

                    const explicitRouteTarget =
                        element.getAttribute("data-route")?.trim() ||
                        element.getAttribute("data-target")?.trim();
                    routePriority = explicitRouteTarget ? 0 : 1;

                    if (explicitRouteTarget) {
                        try {
                            routeTarget = new URL(
                                explicitRouteTarget,
                                currentUrl,
                            ).href;
                        } catch {
                            routeTarget = explicitRouteTarget;
                        }
                    }
                }

                return [
                    {
                        index,
                        fingerprint: [
                            tagName,
                            role,
                            rawHref,
                            label,
                            element.getAttribute("aria-controls") ?? "",
                            element.getAttribute("data-route") ?? "",
                            element.getAttribute("data-target") ?? "",
                        ].join("|"),
                        label: label || rawHref || "unlabelled navigation control",
                        priority,
                        routePriority,
                        ...(routeTarget ? { routeTarget } : {}),
                        urlChangeSufficient,
                    },
                ];
            });
        });

    return candidates.sort(
        (left, right) =>
            left.priority - right.priority || left.index - right.index,
    );
}

async function readNavigationSnapshot(page: Page): Promise<NavigationSnapshot> {
    return await page.evaluate(() => {
        const root = document.querySelector("#root");
        const explicitMain = document.querySelector('main, [role="main"]');
        let contentRoot = explicitMain ?? root;
        let contentRootIsClone = false;

        if (!explicitMain && root) {
            const rootClone = root.cloneNode(true) as HTMLElement;

            rootClone
                .querySelectorAll('nav, [role="navigation"], header, footer')
                .forEach((element) => element.remove());
            contentRoot = rootClone;
            contentRootIsClone = true;
        }

        const normalizeText = (text: string | null | undefined): string =>
            (text ?? "").replace(/\s+/gu, " ").trim().slice(0, 20_000);
        const headings = [
            ...(contentRoot?.querySelectorAll(
                'h1, h2, [role="heading"]',
            ) ?? []),
        ];
        const heading =
            headings.find((element) => {
                if (contentRootIsClone || !(element instanceof HTMLElement)) {
                    return true;
                }

                const style = window.getComputedStyle(element);

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    element.getClientRects().length > 0
                );
            }) ?? headings[0];
        const mainText =
            !contentRootIsClone && contentRoot instanceof HTMLElement
                ? contentRoot.innerText
                : contentRoot?.textContent;
        const headingText =
            !contentRootIsClone && heading instanceof HTMLElement
                ? heading.innerText
                : heading?.textContent;
        const bodyClone = contentRoot?.cloneNode(true) as
            | HTMLElement
            | undefined;

        bodyClone
            ?.querySelectorAll(
                'h1, h2, h3, h4, h5, h6, [role="heading"], nav, [role="navigation"], header, footer, script, style',
            )
            .forEach((element) => element.remove());
        const mediaDescriptionText = bodyClone
            ? Array.from(
                  bodyClone.querySelectorAll(
                      "img[alt], svg[aria-label], video[aria-label], canvas[aria-label]",
                  ),
              )
                  .map(
                      (element) =>
                          element.getAttribute("alt") ??
                          element.getAttribute("aria-label") ??
                          "",
                  )
                  .join(" ")
            : "";
        const blockElements = contentRoot
            ? Array.from(
                  contentRoot.querySelectorAll(
                      "p, li, blockquote, article, section, figure, table, dl, [class*='card' i], [class*='feature' i]",
                  ),
              )
            : [];
        const contentBlockCount = blockElements.filter((element) => {
            if (!contentRootIsClone && element instanceof HTMLElement) {
                const style = window.getComputedStyle(element);

                if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    element.getClientRects().length === 0
                ) {
                    return false;
                }
            }

            return (
                normalizeText(element.textContent).length >= 8 ||
                element.querySelector("img, svg, video, canvas") !== null
            );
        }).length;

        return {
            url: window.location.href,
            mainText: normalizeText(mainText),
            headingText: normalizeText(headingText),
            bodyText: normalizeText(
                `${bodyClone?.textContent ?? ""} ${mediaDescriptionText}`,
            ),
            contentBlockCount,
        };
    });
}

function isSubstantiveRouteSnapshot(snapshot: NavigationSnapshot): boolean {
    if (listPlaceholderContent(snapshot.mainText).length > 0) {
        return false;
    }

    const effectiveBodyLength = effectiveContentLength(snapshot.bodyText);

    return (
        effectiveBodyLength >= 16 &&
        (snapshot.contentBlockCount > 0 || effectiveBodyLength >= 40)
    );
}

function normalizeRouteBody(text: string): string {
    return text
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}\s]+/gu, "")
        .slice(0, 20_000);
}

function routeSnapshotsReuseMainContent(
    left: NavigationSnapshot,
    right: NavigationSnapshot,
): boolean {
    const leftBody = normalizeRouteBody(left.bodyText);
    const rightBody = normalizeRouteBody(right.bodyText);

    if (leftBody.length === 0 || rightBody.length === 0) {
        return false;
    }

    if (leftBody === rightBody) {
        return true;
    }

    const largestLength = Math.max(leftBody.length, rightBody.length);
    const minimumDistinctCharacters = Math.min(
        24,
        Math.max(6, Math.floor(largestLength * 0.15)),
    );

    return (
        countChangedTextCharacters(leftBody, rightBody) <
        minimumDistinctCharacters
    );
}

function hasNavigationUrlChanged(
    before: NavigationSnapshot,
    after: NavigationSnapshot,
): boolean {
    try {
        const beforeUrl = new URL(before.url);
        const afterUrl = new URL(after.url);

        return (
            beforeUrl.pathname !== afterUrl.pathname ||
            beforeUrl.hash !== afterUrl.hash
        );
    } catch {
        return before.url !== after.url;
    }
}

function countChangedTextCharacters(before: string, after: string): number {
    let prefixLength = 0;

    while (
        prefixLength < before.length &&
        prefixLength < after.length &&
        before[prefixLength] === after[prefixLength]
    ) {
        prefixLength += 1;
    }

    let suffixLength = 0;

    while (
        suffixLength < before.length - prefixLength &&
        suffixLength < after.length - prefixLength &&
        before[before.length - suffixLength - 1] ===
            after[after.length - suffixLength - 1]
    ) {
        suffixLength += 1;
    }

    return (
        before.length - prefixLength - suffixLength +
        (after.length - prefixLength - suffixLength)
    );
}

function hasMeaningfulNavigationContentChange(
    before: NavigationSnapshot,
    after: NavigationSnapshot,
): boolean {
    if (
        before.headingText !== after.headingText &&
        (before.headingText.length > 0 || after.headingText.length > 0)
    ) {
        return true;
    }

    if (before.mainText === after.mainText) {
        return false;
    }

    const largestTextLength = Math.max(
        before.mainText.length,
        after.mainText.length,
    );
    const minimumChangedCharacters = Math.min(
        40,
        Math.max(4, Math.floor(largestTextLength * 0.02)),
    );

    return (
        countChangedTextCharacters(before.mainText, after.mainText) >=
        minimumChangedCharacters
    );
}

type IndependentRouteAttempt = {
    passed: boolean;
    before: NavigationSnapshot;
    after: NavigationSnapshot;
};

function navigationUrlKey(url: string): string {
    try {
        const parsed = new URL(url);

        return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return url;
    }
}

function hasEquivalentRouteView(
    expected: NavigationSnapshot,
    actual: NavigationSnapshot,
): boolean {
    if (navigationUrlKey(expected.url) !== navigationUrlKey(actual.url)) {
        return false;
    }

    if (expected.headingText.length > 0) {
        return expected.headingText === actual.headingText;
    }

    return (
        expected.mainText.length > 0 && expected.mainText === actual.mainText
    );
}

function candidateReachedDeclaredTarget(
    candidate: NavigationCandidate,
    snapshot: NavigationSnapshot,
): boolean {
    return (
        candidate.routeTarget !== undefined &&
        navigationUrlKey(candidate.routeTarget) ===
            navigationUrlKey(snapshot.url)
    );
}

async function waitForNavigationSnapshot(input: {
    page: Page;
    predicate: (snapshot: NavigationSnapshot) => boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<NavigationSnapshot | undefined> {
    const deadline = Date.now() + Math.max(100, input.timeoutMs);
    let latest: NavigationSnapshot | undefined;

    while (Date.now() <= deadline) {
        input.signal?.throwIfAborted();

        try {
            latest = await readNavigationSnapshot(input.page);

            if (input.predicate(latest)) {
                return latest;
            }
        } catch {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }

        const remaining = deadline - Date.now();

        if (remaining <= 0) {
            break;
        }

        await input.page.waitForTimeout(Math.min(50, remaining));
    }

    return latest;
}

async function restoreNavigationBaseline(input: {
    page: Page;
    baseline: NavigationSnapshot;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<NavigationSnapshot | undefined> {
    input.signal?.throwIfAborted();

    try {
        await input.page.goto(input.baseline.url, {
            waitUntil: "domcontentloaded",
            timeout: Math.max(500, Math.min(input.timeoutMs, 3_000)),
        });
    } catch {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }
    }

    return await waitForNavigationSnapshot({
        page: input.page,
        predicate: (snapshot) =>
            hasEquivalentRouteView(input.baseline, snapshot),
        timeoutMs: Math.max(250, Math.min(input.timeoutMs, 1_000)),
        ...(input.signal ? { signal: input.signal } : {}),
    });
}

async function activateIndependentRoute(input: {
    page: Page;
    candidate: NavigationCandidate;
    before: NavigationSnapshot;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<IndependentRouteAttempt> {
    const deadline =
        Date.now() + Math.max(1_000, Math.min(input.timeoutMs, 2_500));
    const locator = input.page
        .locator(INTERNAL_NAVIGATION_SELECTOR)
        .nth(input.candidate.index);
    let after = input.before;

    try {
        if (!(await locator.isVisible())) {
            return {
                passed: false,
                before: input.before,
                after,
            };
        }

        const remainingBeforeClick = deadline - Date.now();

        if (remainingBeforeClick <= 0) {
            return {
                passed: false,
                before: input.before,
                after,
            };
        }

        try {
            await locator.click({
                timeout: Math.max(
                    100,
                    Math.min(1_000, remainingBeforeClick),
                ),
            });
        } catch {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }

        const navigationPassed = (snapshot: NavigationSnapshot): boolean =>
            candidateReachedDeclaredTarget(input.candidate, snapshot) &&
            hasNavigationUrlChanged(input.before, snapshot) &&
            hasMeaningfulNavigationContentChange(input.before, snapshot);

        // Inspect even when click() threw: a native route action may already
        // have fired while Playwright was waiting for the action to settle.
        try {
            after = await readNavigationSnapshot(input.page);

            if (navigationPassed(after)) {
                return {
                    passed: true,
                    before: input.before,
                    after,
                };
            }
        } catch {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }

        const observed = await waitForNavigationSnapshot({
            page: input.page,
            predicate: navigationPassed,
            timeoutMs: Math.max(
                100,
                Math.min(1_000, deadline - Date.now()),
            ),
            ...(input.signal ? { signal: input.signal } : {}),
        });

        if (observed) {
            after = observed;
        }

        return {
            passed: navigationPassed(after),
            before: input.before,
            after,
        };
    } catch {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }

        return {
            passed: false,
            before: input.before,
            after,
        };
    }
}

async function verifyBackForwardNavigation(input: {
    page: Page;
    label: string;
    baseline: NavigationSnapshot;
    target: NavigationSnapshot;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<BrowserCheck> {
    const historyTimeoutMs = Math.max(
        500,
        Math.min(input.timeoutMs, 2_000),
    );
    let backPassed = false;
    let forwardPassed = false;

    try {
        input.signal?.throwIfAborted();
        await input.page.goBack({ timeout: historyTimeoutMs });
        const backSnapshot = await waitForNavigationSnapshot({
            page: input.page,
            predicate: (snapshot) =>
                hasEquivalentRouteView(input.baseline, snapshot),
            timeoutMs: Math.min(historyTimeoutMs, 1_000),
            ...(input.signal ? { signal: input.signal } : {}),
        });
        backPassed = Boolean(
            backSnapshot &&
                hasEquivalentRouteView(input.baseline, backSnapshot),
        );

        await input.page.goForward({ timeout: historyTimeoutMs });
        const forwardSnapshot = await waitForNavigationSnapshot({
            page: input.page,
            predicate: (snapshot) =>
                hasEquivalentRouteView(input.target, snapshot),
            timeoutMs: Math.min(historyTimeoutMs, 1_000),
            ...(input.signal ? { signal: input.signal } : {}),
        });
        forwardPassed = Boolean(
            forwardSnapshot &&
                hasEquivalentRouteView(input.target, forwardSnapshot),
        );
    } catch {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }
    }

    const passed = backPassed && forwardPassed;

    return {
        name: "browser Back/Forward works",
        passed,
        message: passed
            ? `Back restored the starting route and Forward restored "${input.label}".`
            : `Back/Forward did not restore both the starting route and "${input.label}".`,
    };
}

function supportsDirectDeepLink(url: string): boolean {
    try {
        return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
        return false;
    }
}

async function verifyDirectDeepLink(input: {
    page: Page;
    label: string;
    target: NavigationSnapshot;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<BrowserCheck> {
    const reloadTimeoutMs = Math.max(500, Math.min(input.timeoutMs, 3_000));
    let passed = false;

    try {
        input.signal?.throwIfAborted();
        await input.page.goto(input.target.url, {
            waitUntil: "domcontentloaded",
            timeout: reloadTimeoutMs,
        });
        const reloadedSnapshot = await waitForNavigationSnapshot({
            page: input.page,
            predicate: (snapshot) =>
                hasEquivalentRouteView(input.target, snapshot),
            timeoutMs: Math.min(reloadTimeoutMs, 1_000),
            ...(input.signal ? { signal: input.signal } : {}),
        });
        passed = Boolean(
            reloadedSnapshot &&
                hasEquivalentRouteView(input.target, reloadedSnapshot),
        );
    } catch {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }
    }

    return {
        name: "direct deep-link reload works",
        passed,
        message: passed
            ? `Directly reloaded "${input.label}" and retained its route content.`
            : `Directly reloading "${input.label}" did not retain its route content.`,
    };
}

async function evaluateIndependentPageNavigation(input: {
    page: Page;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<BrowserCheck[]> {
    const baseline = await readNavigationSnapshot(input.page);
    const discoveredCandidates = (await listNavigationCandidates(input.page))
        .filter(
            (candidate) =>
                candidate.routePriority === 0 &&
                candidate.urlChangeSufficient &&
                candidate.routeTarget !== undefined,
        )
        .filter(
            (candidate, index, candidates) =>
                candidates.findIndex(
                    (other) => other.routeTarget === candidate.routeTarget,
                ) === index,
        );
    const candidates = discoveredCandidates.slice(
        0,
        MAX_INDEPENDENT_ROUTE_TARGETS,
    );

    if (candidates.length === 0) {
        return [
            {
                name: "internal navigation works",
                passed: false,
                message:
                    'No distinct usable independent route target was found. External links, submit buttons, current targets, and href="#" placeholders do not count.',
            },
        ];
    }

    const brokenLabels: string[] = [];
    const workingLabels: string[] = [];
    const routeContentIssues: string[] = [];
    const inspectedRouteViews: Array<{
        label: string;
        snapshot: NavigationSnapshot;
    }> = [{ label: "starting page", snapshot: baseline }];

    if (!isSubstantiveRouteSnapshot(baseline)) {
        const placeholders = listPlaceholderContent(baseline.mainText);
        routeContentIssues.push(
            placeholders.length > 0
                ? `starting page contains placeholder text (${placeholders.join(", ")})`
                : "starting page has too little main content beyond its heading",
        );
    }
    let historyCheck: BrowserCheck | undefined;
    let deepLinkCheck: BrowserCheck | undefined;

    for (const discoveredCandidate of candidates) {
        input.signal?.throwIfAborted();
        const restoredBaseline = await restoreNavigationBaseline({
            page: input.page,
            baseline,
            timeoutMs: input.timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
        });

        if (
            !restoredBaseline ||
            !hasEquivalentRouteView(baseline, restoredBaseline)
        ) {
            brokenLabels.push(discoveredCandidate.label);
            continue;
        }

        const liveCandidate = (await listNavigationCandidates(input.page)).find(
            (candidate) =>
                candidate.routeTarget === discoveredCandidate.routeTarget,
        );

        if (!liveCandidate) {
            brokenLabels.push(discoveredCandidate.label);
            continue;
        }

        const attempt = await activateIndependentRoute({
            page: input.page,
            candidate: liveCandidate,
            before: restoredBaseline,
            timeoutMs: input.timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
        });

        if (!attempt.passed) {
            brokenLabels.push(discoveredCandidate.label);
            continue;
        }

        workingLabels.push(discoveredCandidate.label);
        const placeholders = listPlaceholderContent(attempt.after.mainText);

        if (!isSubstantiveRouteSnapshot(attempt.after)) {
            routeContentIssues.push(
                placeholders.length > 0
                    ? `${discoveredCandidate.label} contains placeholder text (${placeholders.join(", ")})`
                    : `${discoveredCandidate.label} has too little main content beyond its heading`,
            );
        } else {
            const reusedView = inspectedRouteViews.find(({ snapshot }) =>
                routeSnapshotsReuseMainContent(snapshot, attempt.after),
            );

            if (reusedView) {
                routeContentIssues.push(
                    `${discoveredCandidate.label} reuses essentially the same main content as ${reusedView.label}`,
                );
            }
        }
        inspectedRouteViews.push({
            label: discoveredCandidate.label,
            snapshot: attempt.after,
        });

        if (!historyCheck) {
            historyCheck = await verifyBackForwardNavigation({
                page: input.page,
                label: discoveredCandidate.label,
                baseline,
                target: attempt.after,
                timeoutMs: input.timeoutMs,
                ...(input.signal ? { signal: input.signal } : {}),
            });

            if (supportsDirectDeepLink(attempt.after.url)) {
                deepLinkCheck = await verifyDirectDeepLink({
                    page: input.page,
                    label: discoveredCandidate.label,
                    target: attempt.after,
                    timeoutMs: input.timeoutMs,
                    ...(input.signal ? { signal: input.signal } : {}),
                });
            }
        }
    }

    const allSelectedTargetsPassed =
        brokenLabels.length === 0 && workingLabels.length === candidates.length;
    const capSuffix =
        discoveredCandidates.length > candidates.length
            ? ` Checked the first ${candidates.length} of ${discoveredCandidates.length} discovered targets (safe cap ${MAX_INDEPENDENT_ROUTE_TARGETS}).`
            : "";
    const routeCheck: BrowserCheck = {
        name: "internal navigation works",
        passed: allSelectedTargetsPassed,
        message: allSelectedTargetsPassed
            ? `Verified ${workingLabels.length} distinct independent route target(s): ${workingLabels.join(", ")}.${capSuffix}`
            : `Broken independent route target(s): ${brokenLabels.join(", ")}. Verified ${workingLabels.length} of ${candidates.length}; each route must change both the URL path/hash and the main page content.${capSuffix}`,
    };
    const routeContentPassed =
        allSelectedTargetsPassed && routeContentIssues.length === 0;
    const routeContentCheck: BrowserCheck = {
        name: "independent routes have substantive unique content",
        passed: routeContentPassed,
        message: routeContentPassed
            ? `Verified substantive, distinct main content for the starting page and ${workingLabels.length} independent route target(s).`
            : routeContentIssues.length > 0
              ? `Incomplete or repeated route content: ${routeContentIssues.join("; ")}.`
              : "One or more independent routes could not be inspected for substantive, distinct main content.",
    };

    return [
        routeCheck,
        routeContentCheck,
        ...(historyCheck ? [historyCheck] : []),
        ...(deepLinkCheck ? [deepLinkCheck] : []),
    ];
}

async function evaluateInternalNavigation(input: {
    page: Page;
    timeoutMs: number;
    requireIndependentPageChange: boolean;
    signal?: AbortSignal;
}): Promise<BrowserCheck[]> {
    if (input.requireIndependentPageChange) {
        return await evaluateIndependentPageNavigation({
            page: input.page,
            timeoutMs: input.timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
        });
    }

    const deadline = Date.now() + Math.min(input.timeoutMs, 5_000);
    const attemptedFingerprints = new Set<string>();
    const attemptedLabels: string[] = [];
    let foundCandidate = false;

    while (Date.now() < deadline && attemptedFingerprints.size < 8) {
        input.signal?.throwIfAborted();

        const candidates = await listNavigationCandidates(input.page);
        const candidate = candidates.find(
            (item) => !attemptedFingerprints.has(item.fingerprint),
        );

        if (!candidate) {
            break;
        }

        foundCandidate = true;
        attemptedFingerprints.add(candidate.fingerprint);
        attemptedLabels.push(candidate.label);

        const locator = input.page
            .locator(INTERNAL_NAVIGATION_SELECTOR)
            .nth(candidate.index);

        if (!(await locator.isVisible())) {
            continue;
        }

        const before = await readNavigationSnapshot(input.page);
        const remainingBeforeClick = deadline - Date.now();

        if (remainingBeforeClick <= 0) {
            break;
        }

        try {
            await locator.click({
                timeout: Math.max(100, Math.min(1_000, remainingBeforeClick)),
            });
        } catch {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }

        let after = before;

        // A click can dispatch successfully and update a hash before
        // Playwright times out while waiting for the action to settle. Always
        // inspect once after the click attempt, including its error path and
        // even when the nominal deadline has been consumed. Otherwise a
        // working route can be reported as a failure without observing the
        // URL/content change that the click already triggered.
        try {
            after = await readNavigationSnapshot(input.page);
            const immediateUrlChanged = hasNavigationUrlChanged(before, after);
            const immediateContentChanged =
                hasMeaningfulNavigationContentChange(before, after);
            const immediateUsableUrlChanged =
                immediateUrlChanged && candidate.urlChangeSufficient;
            const immediateNavigationPassed =
                input.requireIndependentPageChange
                    ? immediateUsableUrlChanged && immediateContentChanged
                    : immediateUsableUrlChanged || immediateContentChanged;

            if (immediateNavigationPassed) {
                const observation = input.requireIndependentPageChange
                    ? "a path or hash change plus a meaningful main-content change"
                    : immediateUsableUrlChanged
                      ? "a path or hash change"
                      : "a meaningful main-content change";

                return [
                    {
                        name: "internal navigation works",
                        passed: true,
                        message: `Activated "${candidate.label}" and observed ${observation}.`,
                    },
                ];
            }
        } catch {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }

        const candidateObservationDeadline = Math.min(
            deadline,
            Date.now() + 1_000,
        );

        while (Date.now() < candidateObservationDeadline) {
            input.signal?.throwIfAborted();
            await input.page.waitForTimeout(
                Math.min(
                    100,
                    Math.max(1, candidateObservationDeadline - Date.now()),
                ),
            );

            try {
                after = await readNavigationSnapshot(input.page);
            } catch {
                if (input.signal?.aborted) {
                    input.signal.throwIfAborted();
                }

                continue;
            }

            const urlChanged = hasNavigationUrlChanged(before, after);
            const contentChanged = hasMeaningfulNavigationContentChange(
                before,
                after,
            );
            const usableUrlChanged =
                urlChanged && candidate.urlChangeSufficient;
            const navigationPassed = input.requireIndependentPageChange
                ? usableUrlChanged && contentChanged
                : usableUrlChanged || contentChanged;

            if (navigationPassed) {
                const observation = input.requireIndependentPageChange
                    ? "a path or hash change plus a meaningful main-content change"
                    : usableUrlChanged
                      ? "a path or hash change"
                      : "a meaningful main-content change";

                return [
                    {
                        name: "internal navigation works",
                        passed: true,
                        message: `Activated "${candidate.label}" and observed ${observation}.`,
                    },
                ];
            }

        }
    }

    return [
        {
            name: "internal navigation works",
            passed: false,
            message: foundCandidate
                ? `Internal controls were found (${attemptedLabels.slice(0, 5).join(", ")}), but none changed the URL path/hash or main page content.`
                : 'No usable internal navigation control was found. External links, submit buttons, current targets, and href="#" placeholders do not count.',
        },
    ];
}

export type BrowserEvaluateInput = {
    url: string;
    goal?: string;
    probes?: BrowserProbe[];
    timeoutMs?: number;
    artifactDirectory?: string;
    signal?: AbortSignal;
};

export interface BrowserEvaluator {
    evaluate(input: BrowserEvaluateInput): Promise<BrowserEvalResult>;
}

export class FakeBrowserEvaluator implements BrowserEvaluator {
    constructor(private readonly result: BrowserEvalResult) {}

    async evaluate(): Promise<BrowserEvalResult> {
        return this.result;
    }
}

const MAX_BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const MIN_BROWSER_LAUNCH_TIMEOUT_MS = 5_000;
const MAX_BROWSER_CLOSE_TIMEOUT_MS = 5_000;

function resolveBrowserLifecycleTimeout(
    requestedTimeoutMs: number,
    maximumTimeoutMs: number,
): number {
    if (!Number.isFinite(requestedTimeoutMs)) {
        return maximumTimeoutMs;
    }

    return Math.max(1, Math.min(requestedTimeoutMs, maximumTimeoutMs));
}

function resolveBrowserLaunchTimeout(requestedTimeoutMs: number): number {
    if (!Number.isFinite(requestedTimeoutMs)) {
        return MAX_BROWSER_LAUNCH_TIMEOUT_MS;
    }

    // Very small page-operation timeouts (for example, a 300ms root check)
    // are not realistic Chromium process-start budgets. Keep launch separate
    // from those page settings while retaining a hard 15-second ceiling.
    return Math.min(
        MAX_BROWSER_LAUNCH_TIMEOUT_MS,
        Math.max(MIN_BROWSER_LAUNCH_TIMEOUT_MS, requestedTimeoutMs),
    );
}

async function closeBrowserWithinTimeout(
    browser: Browser,
    timeoutMs: number,
): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const close = Promise.resolve()
        .then(async () => browser.close())
        .catch(() => undefined);
    const deadline = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
    });

    try {
        await Promise.race([close, deadline]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

async function launchBrowserWithinTimeout(input: {
    launch: () => Promise<Browser>;
    launchTimeoutMs: number;
    closeTimeoutMs: number;
    signal?: AbortSignal;
}): Promise<Browser> {
    input.signal?.throwIfAborted();
    const launch = Promise.resolve().then(input.launch);
    let accepted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectOnAbort: (() => void) | undefined;
    const lifecycleDeadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            const error = new Error(
                `Browser launch timed out after ${input.launchTimeoutMs}ms.`,
            );
            error.name = "TimeoutError";
            reject(error);
        }, input.launchTimeoutMs);

        if (input.signal) {
            rejectOnAbort = () => {
                try {
                    input.signal?.throwIfAborted();
                } catch (error) {
                    reject(error);
                }
            };
            input.signal.addEventListener("abort", rejectOnAbort, {
                once: true,
            });

            if (input.signal.aborted) {
                rejectOnAbort();
            }
        }
    });

    try {
        const browser = await Promise.race([launch, lifecycleDeadline]);
        accepted = true;
        return browser;
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
        if (rejectOnAbort) {
            input.signal?.removeEventListener("abort", rejectOnAbort);
        }

        if (!accepted) {
            void launch.then(
                async (browser) =>
                    closeBrowserWithinTimeout(
                        browser,
                        input.closeTimeoutMs,
                    ),
                () => undefined,
            );
        }
    }
}

export class PlaywrightBrowserEvaluator implements BrowserEvaluator {
    constructor(
        private readonly launchBrowser: () => Promise<Browser> = () =>
            chromium.launch({
                headless: true,
            }),
    ) {}

    async evaluate(input: BrowserEvaluateInput): Promise<BrowserEvalResult> {
        input.signal?.throwIfAborted();
        const timeoutMs = input.timeoutMs ?? 10_000;
        const launchTimeoutMs = resolveBrowserLaunchTimeout(timeoutMs);
        const closeTimeoutMs = resolveBrowserLifecycleTimeout(
            timeoutMs,
            MAX_BROWSER_CLOSE_TIMEOUT_MS,
        );
        const browser = await launchBrowserWithinTimeout({
            launch: this.launchBrowser,
            launchTimeoutMs,
            closeTimeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
        });
        let browserClose: Promise<void> | undefined;
        const closeBrowser = (): Promise<void> => {
            browserClose ??= closeBrowserWithinTimeout(
                browser,
                closeTimeoutMs,
            );

            return browserClose;
        };
        const closeOnAbort = () => {
            void closeBrowser();
        };
        input.signal?.addEventListener("abort", closeOnAbort, { once: true });
        if (input.signal?.aborted) {
            closeOnAbort();
            input.signal.throwIfAborted();
        }
        const checks: BrowserCheck[] = [];
        const evidence: BrowserEvalEvidence[] = [];
        const runtimeErrors = new Set<string>();
        let visualReport: MultiViewportVisualReport | undefined;
        let rootEvidence:
            | Omit<BrowserRuntimeEvidence, "runtimeErrors">
            | undefined;

        try {
            let page: Page;

            try {
                page = await browser.newPage();
            } catch (error) {
                if (input.signal?.aborted) {
                    input.signal.throwIfAborted();
                }

                throw error;
            }

            page.setDefaultTimeout(timeoutMs);
            page.setDefaultNavigationTimeout(timeoutMs);
            page.on("console", (message) => {
                if (message.type() === "error") {
                    const location = message.location();
                    const locationText = location.url
                        ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})`
                        : "";
                    runtimeErrors.add(
                        `console.error${locationText}: ${message.text() || "No message was provided."}`,
                    );
                }
            });
            page.on("pageerror", (error) => {
                const stack = error.stack ? ` Stack: ${error.stack}` : "";
                runtimeErrors.add(
                    `Uncaught page error: ${error.message || String(error)}${stack}`,
                );
            });
            page.on("crash", () => {
                runtimeErrors.add("The browser page crashed.");
            });

            await page.goto(input.url, {
                waitUntil: "domcontentloaded",
                timeout: timeoutMs,
            });

            checks.push({
                name: "page loads",
                passed: true,
            });

            try {
                await page.waitForFunction(
                    () => {
                        const root = document.querySelector("#root");

                        return Boolean(
                            root &&
                                (root.children.length > 0 ||
                                    (root.textContent ?? "").trim().length > 0),
                        );
                    },
                    undefined,
                    {
                        timeout: Math.min(timeoutMs, 2_000),
                    },
                );
            } catch {
                // An empty or missing root is reported as a dedicated check
                // below. Do not turn the expected wait timeout into a generic
                // browser-evaluation failure.
            }

            const bodyText = (await page.locator("body").innerText({
                timeout: timeoutMs,
            })).trim();

            checks.push({
                name: "has visible content",
                passed: bodyText.length > 0,
                ...(bodyText.length === 0
                    ? { message: "The page body did not contain visible text." }
                    : {}),
            });

            // Inspect the initial page before task or navigation interactions
            // mutate it. This keeps homepage completeness and styling checks
            // anchored to what the user first sees.
            checks.push(
                ...(await createVisualPageQualityChecks(
                    page,
                    input.goal,
                    input.signal,
                )),
            );
            if (isVisualPageQualityGoal(input.goal)) {
                visualReport = await collectMultiViewportVisualReport({
                    page,
                    ...(input.goal ? { goal: input.goal } : {}),
                    ...(input.artifactDirectory
                        ? { artifactDirectory: input.artifactDirectory }
                        : {}),
                    ...(input.signal ? { signal: input.signal } : {}),
                });
                checks.push(
                    ...visualReport.viewports.flatMap((viewport) =>
                        viewport.checks.map((check) => ({ ...check })),
                    ),
                );
            }
            const focusedEvidence = await collectFocusedBrowserEvidence(
                page,
                input.goal,
            );
            checks.push(...focusedEvidence.checks);
            evidence.push(...focusedEvidence.evidence);

            if (input.probes && input.probes.length > 0) {
                const probeEvidence = await evaluateBrowserProbes(
                    page,
                    input.url,
                    input.probes,
                );
                checks.push(...probeEvidence.checks);
                evidence.push(...probeEvidence.evidence);
            }

            if (isTaskAppGoal(input.goal)) {
                const inputLocator = page.locator("input, textarea").first();
                const buttonLocator = page.locator("button").first();
                const hasInput = (await inputLocator.count()) > 0;
                const hasButton = (await buttonLocator.count()) > 0;

                checks.push({
                    name: "has task input",
                    passed: hasInput,
                    ...(hasInput
                        ? {}
                        : { message: "No input or textarea was found." }),
                });
                checks.push({
                    name: "has action button",
                    passed: hasButton,
                    ...(hasButton ? {} : { message: "No button was found." }),
                });

                if (hasInput && hasButton) {
                    const taskText = "AppForge browser check task";

                    await inputLocator.fill(taskText, {
                        timeout: timeoutMs,
                    });
                    await buttonLocator.click({
                        timeout: timeoutMs,
                    });

                    const renderedTaskCount = await page
                        .getByText(taskText, {
                            exact: false,
                        })
                        .count();

                    checks.push({
                        name: "adds a task item",
                        passed: renderedTaskCount > 0,
                        ...(renderedTaskCount > 0
                            ? {}
                            : {
                                  message:
                                      "The task text was not rendered after clicking the button.",
                              }),
                    });
                }
            }

            if (isNavigationBrowserGoal(input.goal)) {
                checks.push(
                    ...(await evaluateInternalNavigation({
                        page,
                        timeoutMs,
                        requireIndependentPageChange:
                            isIndependentPageNavigationGoal(input.goal),
                        ...(input.signal ? { signal: input.signal } : {}),
                    })),
                );
            }

            // Give React effects and promise continuations one short turn to
            // report errors that occur immediately after the first render or
            // the interaction checks above.
            await page.waitForTimeout(100);

            rootEvidence = await page.evaluate(() => {
                const root = document.querySelector("#root");
                const hasUsableBox = (element: Element): boolean => {
                    const htmlElement = element as HTMLElement;
                    const style = window.getComputedStyle(htmlElement);

                    if (
                        style.display === "none" ||
                        style.visibility === "hidden" ||
                        Number.parseFloat(style.opacity || "1") < 0.05
                    ) {
                        return false;
                    }

                    const box = htmlElement.getBoundingClientRect();

                    return box.width >= 24 && box.height >= 24;
                };
                const visibleMainContent = root
                    ? [
                          ...root.querySelectorAll(
                              "main, section, article, h1",
                          ),
                          ...Array.from(root.children),
                      ].some(hasUsableBox)
                    : false;

                return {
                    rootExists: root !== null,
                    rootHasContent: Boolean(
                        root &&
                            (root.children.length > 0 ||
                                (root.textContent ?? "").trim().length > 0),
                    ),
                    rootHasVisibleMainContent: visibleMainContent,
                };
            });
        } catch (error) {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
            checks.push({
                name: "browser evaluation completed",
                passed: false,
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown browser evaluation error.",
            });
        } finally {
            input.signal?.removeEventListener("abort", closeOnAbort);
            await closeBrowser();
        }

        if (rootEvidence) {
            checks.push(
                ...createBrowserRuntimeChecks({
                    ...rootEvidence,
                    runtimeErrors: [...runtimeErrors],
                }),
            );
        } else {
            const runtimeErrorChecks = createBrowserRuntimeChecks({
                rootExists: false,
                rootHasContent: false,
                rootHasVisibleMainContent: false,
                runtimeErrors: [...runtimeErrors],
            });

            checks.push(
                runtimeErrorChecks.find(
                    (check) => check.name === "has no runtime errors",
                ) ?? {
                    name: "has no runtime errors",
                    passed: true,
                },
            );
        }

        return {
            passed: checks.every((check) => check.passed),
            checks,
            ...(evidence.length > 0 ? { evidence } : {}),
            ...(visualReport ? { visualReport } : {}),
        };
    }
}

const ELEMENT_SNAPSHOT_STYLE_PROPERTIES = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "gap",
    "color",
    "backgroundColor",
    "borderRadius",
    "transform",
    "gridTemplateColumns",
    "flexDirection",
];

function normalizeColor(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/iu);

    if (!hex) {
        return normalized.replace(/\s+/gu, " ");
    }

    const raw = hex[1] ?? "";
    const full =
        raw.length === 3
            ? raw
                  .split("")
                  .map((character) => `${character}${character}`)
                  .join("")
            : raw;

    return `rgb(${Number.parseInt(full.slice(0, 2), 16)}, ${Number.parseInt(full.slice(2, 4), 16)}, ${Number.parseInt(full.slice(4, 6), 16)})`;
}

function probeValueMatches(input: {
    expected: BrowserProbe["expected"];
    actual: string | number | boolean | undefined;
    tolerance?: number;
    property?: string;
}): boolean {
    if (input.expected === undefined) {
        return input.actual !== undefined;
    }

    if (typeof input.expected === "number") {
        const actualNumber =
            typeof input.actual === "number"
                ? input.actual
                : Number.parseFloat(String(input.actual ?? ""));

        return (
            Number.isFinite(actualNumber) &&
            Math.abs(actualNumber - input.expected) <=
                (input.tolerance ?? 0)
        );
    }

    if (typeof input.expected === "boolean") {
        return input.actual === input.expected;
    }

    const expected = /color/iu.test(input.property ?? "")
        ? normalizeColor(input.expected)
        : String(input.expected).trim().toLowerCase();
    const actual = /color/iu.test(input.property ?? "")
        ? normalizeColor(String(input.actual ?? ""))
        : String(input.actual ?? "").trim().toLowerCase();

    return actual === expected || (actual ?? "").includes(expected ?? "");
}

async function captureElementSnapshot(
    page: Page,
    probe: BrowserProbe,
): Promise<ElementSnapshot> {
    const matches = page.locator(probe.selector);
    const matchCount = await matches.count();

    if (matchCount === 0) {
        return {
            route: probe.route ?? "/",
            selector: probe.selector,
            viewport: probe.viewport,
            exists: false,
            visible: false,
            computedStyles: {},
        };
    }

    let locator = matches.first();

    for (let index = 0; index < matchCount; index += 1) {
        const candidate = matches.nth(index);

        if (await candidate.isVisible().catch(() => false)) {
            locator = candidate;
            break;
        }
    }

    const visible = await locator.isVisible();
    const box = await locator.boundingBox();
    const text = await locator.innerText().catch(() => undefined);
    const computedStyles = await locator.evaluate((element, properties) => {
        const style = window.getComputedStyle(element);

        return Object.fromEntries(
            properties.map((property) => [
                property,
                String(
                    style.getPropertyValue(property) ||
                        style[property as keyof CSSStyleDeclaration] ||
                        "",
                ),
            ]),
        );
    }, ELEMENT_SNAPSHOT_STYLE_PROPERTIES);

    return {
        route: probe.route ?? "/",
        selector: probe.selector,
        viewport: probe.viewport,
        exists: true,
        visible,
        ...(text !== undefined ? { text } : {}),
        ...(box
            ? {
                  boundingBox: {
                      x: box.x,
                      y: box.y,
                      width: box.width,
                      height: box.height,
                  },
              }
            : {}),
        computedStyles,
    };
}

async function evaluateSingleBrowserProbe(
    page: Page,
    probe: BrowserProbe,
): Promise<{ check: BrowserCheck; evidence: BrowserEvalEvidence }> {
    await page.setViewportSize(probe.viewport);
    const afterElement = await captureElementSnapshot(page, probe);
    let actual: string | number | boolean | undefined;

    if (probe.measurement === "element_count") {
        actual = await page.locator(probe.selector).count();
    } else if (probe.measurement === "visibility") {
        actual =
            afterElement.exists &&
            afterElement.visible &&
            afterElement.computedStyles.display !== "none" &&
            afterElement.computedStyles.visibility !== "hidden" &&
            afterElement.computedStyles.opacity !== "0";
    } else if (probe.measurement === "text") {
        actual = afterElement.text ?? "";
    } else if (probe.measurement === "attribute") {
        actual = await page
            .locator(probe.selector)
            .first()
            .getAttribute(probe.property ?? "")
            .then((value) => value ?? "")
            .catch(() => "");
    } else if (probe.measurement === "bounding_box") {
        const box = afterElement.boundingBox;
        actual = box
            ? Number(box[probe.property as keyof typeof box] ?? Number.NaN)
            : undefined;
    } else {
        actual =
            afterElement.computedStyles[probe.property ?? ""] ??
            afterElement.computedStyles[
                (probe.property ?? "").replace(
                    /-([a-z])/gu,
                    (_, letter: string) => letter.toUpperCase(),
                )
            ];
    }

    const passed = probeValueMatches({
        expected: probe.expected,
        actual,
        ...(probe.tolerance !== undefined
            ? { tolerance: probe.tolerance }
            : {}),
        ...(probe.property ? { property: probe.property } : {}),
    });

    return {
        check: {
            name: `browser probe ${probe.requirementId}: ${probe.selector} ${probe.measurement}${probe.property ? `.${probe.property}` : ""}`,
            passed,
            ...(passed
                ? {}
                : {
                      message: `Expected ${String(probe.expected)}, got ${String(actual)}.`,
                  }),
        },
        evidence: {
            source:
                probe.measurement === "computed_style"
                    ? "computed_style"
                    : "browser",
            requirementId: probe.requirementId,
            selector: probe.selector,
            ...(probe.property ? { property: probe.property } : {}),
            ...(probe.expected !== undefined
                ? { expected: String(probe.expected) }
                : {}),
            actual: String(actual),
            afterElement,
        },
    };
}

async function evaluateBrowserProbes(
    page: Page,
    baseUrl: string,
    probes: BrowserProbe[],
): Promise<{ checks: BrowserCheck[]; evidence: BrowserEvalEvidence[] }> {
    const checks: BrowserCheck[] = [];
    const evidence: BrowserEvalEvidence[] = [];

    for (const probe of probes) {
        if (probe.route) {
            await page.goto(new URL(probe.route, baseUrl).toString(), {
                waitUntil: "domcontentloaded",
            });
        }

        const result = await evaluateSingleBrowserProbe(page, probe);
        checks.push(result.check);
        evidence.push(result.evidence);
    }

    return { checks, evidence };
}

async function collectFocusedBrowserEvidence(
    page: Page,
    goal: string | undefined,
): Promise<{ checks: BrowserCheck[]; evidence: BrowserEvalEvidence[] }> {
    const normalizedGoal = goal ?? "";
    const checks: BrowserCheck[] = [];
    const evidence: BrowserEvalEvidence[] = [];
    const pxMatch = normalizedGoal.match(/(\d+(?:\.\d+)?)\s*px/iu);
    const expectedPx = pxMatch ? Number(pxMatch[1]) : undefined;
    const wantsSidebar =
        /\bsidebar\b|left\s+side|left\s+rail|宸︿晶|渚ц竟/iu.test(
            normalizedGoal,
        );
    const wantsHero = /\bhero\b|棣栧睆|澶村浘/iu.test(normalizedGoal);
    const wantsButton = /\bbutton\b|鎸夐挳/iu.test(normalizedGoal);
    const wantsColor =
        /\b(?:color|background|blue|gray|grey|dark)\b|棰滆壊|鑳屾櫙|钃濊壊|鐏拌壊/iu.test(
            normalizedGoal,
        );
    const wantsVisibility =
        /\b(?:hide|show|visible|visibility)\b|闅愯棌|鏄剧ず|鍙/iu.test(
            normalizedGoal,
        );
    const wantsResponsive =
        /\b(?:mobile|desktop|responsive|single column|one column)\b|鎵嬫満|妗岄潰|鍗曞垪|鍝嶅簲/iu.test(
            normalizedGoal,
        );
    const selector = wantsSidebar
        ? "aside, .sidebar, .app-sidebar, [class*='sidebar']"
        : wantsHero
          ? ".hero, .page-hero, [class*='hero']"
          : wantsButton
            ? "button, .button, [role='button']"
            : wantsResponsive
              ? "main, .app, #root > *"
              : "";

    if (selector.length === 0 && !wantsColor && !wantsVisibility) {
        return { checks, evidence };
    }

    const targetSelector = selector || "body";
    const locator = page.locator(targetSelector).first();
    const count = await locator.count();

    checks.push({
        name: `focused evidence target exists: ${targetSelector}`,
        passed: count > 0,
        ...(count > 0
            ? {}
            : { message: `No element matched ${targetSelector}.` }),
    });

    if (count === 0) {
        evidence.push({
            source: "browser",
            selector: targetSelector,
            property: "exists",
            expected: "true",
            actual: "false",
        });
        return { checks, evidence };
    }

    const box = await locator.boundingBox();
    const computed = await locator.evaluate((element) => {
        const style = window.getComputedStyle(element);

        return {
            width: style.width,
            height: style.height,
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            backgroundColor: style.backgroundColor,
            color: style.color,
            marginLeft: style.marginLeft,
            transform: style.transform,
        };
    });
    const visible = await locator.isVisible();

    evidence.push({
        source: "browser",
        selector: targetSelector,
        property: "visible",
        expected: wantsVisibility ? "requested visibility state" : "true",
        actual: String(visible),
    });

    if (box) {
        evidence.push({
            source: "browser",
            selector: targetSelector,
            property: "boundingBox",
            actual: `x=${Math.round(box.x)}, y=${Math.round(box.y)}, width=${Math.round(box.width)}, height=${Math.round(box.height)}`,
        });
    }

    if (expectedPx !== undefined && (wantsSidebar || /width|瀹藉害/iu.test(normalizedGoal))) {
        const actualWidth = box?.width ?? Number.parseFloat(computed.width);
        const passed = Number.isFinite(actualWidth)
            ? Math.abs(actualWidth - expectedPx) <= 2
            : false;

        checks.push({
            name: `computed width is ${expectedPx}px`,
            passed,
            ...(passed
                ? {}
                : {
                      message: `Expected ${expectedPx}px, got ${Number.isFinite(actualWidth) ? `${actualWidth.toFixed(2)}px` : computed.width}.`,
                  }),
        });
        evidence.push({
            source: "computed_style",
            selector: targetSelector,
            property: "width",
            expected: `${expectedPx}px`,
            actual: Number.isFinite(actualWidth)
                ? `${actualWidth.toFixed(2)}px`
                : computed.width,
        });
    }

    if (wantsColor || wantsHero) {
        evidence.push({
            source: "computed_style",
            selector: targetSelector,
            property: "background-color",
            expected: /not\s+blue|不是蓝色|不要蓝色/iu.test(normalizedGoal)
                ? "not blue"
                : /dark\s+gray|dark\s+grey|深灰/iu.test(normalizedGoal)
                  ? "dark gray"
                  : "requested color",
            actual: computed.backgroundColor,
        });
        evidence.push({
            source: "computed_style",
            selector: targetSelector,
            property: "color",
            actual: computed.color,
        });
    }

    if (wantsResponsive) {
        const viewport = page.viewportSize();
        evidence.push({
            source: "browser",
            selector: targetSelector,
            property: "viewport",
            actual: viewport ? `${viewport.width}x${viewport.height}` : "unknown",
        });
    }

    return { checks, evidence };
}

function isTaskAppGoal(goal: string | undefined): boolean {
    const normalizedGoal = (goal ?? "task").toLowerCase();

    return (
        normalizedGoal.includes("task") ||
        normalizedGoal.includes("todo") ||
        normalizedGoal.includes("to-do") ||
        normalizedGoal.includes("list") ||
        normalizedGoal.includes("任务") ||
        normalizedGoal.includes("待办") ||
        normalizedGoal.includes("清单")
    );
}

function isContentPageGoal(goal: string | undefined): boolean {
    const normalizedGoal = (goal ?? "").toLowerCase();

    return (
        normalizedGoal.includes("introduction") ||
        normalizedGoal.includes("introduce") ||
        normalizedGoal.includes("about") ||
        normalizedGoal.includes("page") ||
        normalizedGoal.includes("介绍") ||
        normalizedGoal.includes("页面")
    );
}

function createLanguageChecks(input: EvaluateReactAppInput): EvalCheck[] {
    if (!containsChinese(input.goal)) {
        return [];
    }

    return [
        {
            name: "matches requested language",
            passed: containsChinese(input.source),
        },
    ];
}

function shouldUseTaskAppChecks(input: EvaluateReactAppInput): boolean {
    if (isTaskAppGoal(input.goal)) {
        return true;
    }

    if (isContentPageGoal(input.goal)) {
        return false;
    }

    if (
        (input.source.includes("<h1") || input.source.includes("<h2")) &&
        input.source.includes("<p")
    ) {
        return false;
    }

    return true;
}

export function evaluateReactApp(
    input: EvaluateReactAppInput,
): ReactAppEvalResult {
    const checks: EvalCheck[] = [
        {
            name: "has readable text",
            passed: !containsLikelyMojibake(input.source),
        },
        ...createLanguageChecks(input),
        ...(shouldUseTaskAppChecks(input)
            ? [
                  {
                      name: "has input",
                      passed: input.source.includes("<input"),
                  },
                  {
                      name: "has button",
                      passed: input.source.includes("<button"),
                  },
                  {
                      name: "has task rendering",
                      passed:
                          input.source.includes(".map(") ||
                          input.source.includes("map(( "),
                  },
              ]
            : [
                  {
                      name: "has heading",
                      passed:
                          input.source.includes("<h1") ||
                          input.source.includes("<h2"),
                  },
                  {
                      name: "has descriptive paragraphs",
                      passed: input.source.includes("<p"),
                  },
                  {
                      name: "has enough page content",
                      passed: input.source.length >= 200,
                  },
              ]),
    ];

    return evaluateChecks(checks);
}
export function summarizeBrowserEval(
    result: BrowserEvalResult,
): string {
    const passedChecks = result.checks.filter((check) => check.passed).length;

    return `${passedChecks}/${result.checks.length} browser checks passed`;
}
