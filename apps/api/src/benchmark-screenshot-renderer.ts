import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";

import {
    createScreenshotFingerprint,
    type RuntimeVisualFingerprint,
    type ScreenshotFingerprint,
    type TokenFingerprint,
} from "./cross-template-similarity.js";

export type BenchmarkScreenshotCapture = {
    screenshotPath?: string;
    fingerprint?: ScreenshotFingerprint;
    runtime?: RuntimeVisualFingerprint;
    error?: string;
};

export type BenchmarkScreenshotSessionOptions = {
    outputDirectory: string;
    viewport?: {
        width: number;
        height: number;
    };
    timeoutMs?: number;
};

function sanitizeCaseId(id: string): string {
    return id.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 120);
}

function addRuntimeToken(
    target: TokenFingerprint,
    token: string,
    weight = 1,
): void {
    if (!token || !Number.isFinite(weight) || weight <= 0) {
        return;
    }
    target[token] = (target[token] ?? 0) + weight;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}


export const WAIT_FOR_BENCHMARK_FONTS_EXPRESSION = String.raw`
(async () => {
    if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
    }
})()
`;

export const COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION = String.raw`
(() => {
    const structureTokens = {};
    const styleTokens = {};
    const add = (target, token, weight = 1) => {
        if (!token) {
            return;
        }
        target[token] = (target[token] || 0) + weight;
    };
    const root = document.querySelector('#root');
    if (!root) {
        return { structureTokens, styleTokens };
    }
    const selector = [
        'header',
        'nav',
        'main',
        'aside',
        'section',
        'article',
        'table',
        'ol',
        'ul',
        'footer',
        "[class*='hero']",
        "[class*='grid']",
        "[class*='rail']",
        "[class*='dashboard']",
        "[class*='timeline']",
        "[class*='gallery']",
    ].join(',');
    const elements = [
        root,
        ...Array.from(root.querySelectorAll(selector)),
    ].slice(0, 320);
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const bucket = (value, maximum) =>
        Math.max(0, Math.min(7, Math.floor((value / maximum) * 8)));
    const radiusBucket = (value) => {
        const numeric = Number.parseFloat(value || '0');
        if (!Number.isFinite(numeric) || numeric <= 1) {
            return 'square';
        }
        if (numeric <= 6) {
            return 'small';
        }
        if (numeric <= 14) {
            return 'medium';
        }
        return 'large';
    };
    const fontBucket = (value) => {
        const numeric = Number.parseFloat(value || '0');
        if (numeric < 12) {
            return 'tiny';
        }
        if (numeric < 16) {
            return 'small';
        }
        if (numeric < 26) {
            return 'body';
        }
        return 'display';
    };

    for (const element of elements) {
        const style = window.getComputedStyle(element);
        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number.parseFloat(style.opacity || '1') < 0.05
        ) {
            continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
            continue;
        }
        const tag = element.tagName.toLowerCase();
        let depth = 0;
        let parent = element.parentElement;
        while (parent && parent !== root && depth < 8) {
            depth += 1;
            parent = parent.parentElement;
        }
        add(structureTokens, 'tag:' + tag, 1);
        add(structureTokens, 'depth:' + tag + ':' + Math.min(depth, 5), 1);
        add(
            structureTokens,
            'geometry:' + tag + ':' +
                bucket(rect.left, viewportWidth) + ':' +
                bucket(rect.top, viewportHeight) + ':' +
                bucket(rect.width, viewportWidth) + ':' +
                bucket(rect.height, viewportHeight),
            tag === 'section' || tag === 'main' || tag === 'aside' ? 2 : 1,
        );
        for (const className of Array.from(element.classList).slice(0, 5)) {
            if (/^[A-Za-z][A-Za-z0-9_-]{1,48}$/.test(className)) {
                add(structureTokens, 'class:' + className, 0.5);
            }
        }
        const columnCount =
            style.display === 'grid' && style.gridTemplateColumns !== 'none'
                ? style.gridTemplateColumns.split(/\s+/).filter(Boolean).length
                : 0;
        add(styleTokens, 'display:' + tag + ':' + style.display, 1);
        add(styleTokens, 'position:' + tag + ':' + style.position, 0.5);
        add(styleTokens, 'radius:' + tag + ':' + radiusBucket(style.borderRadius), 0.5);
        add(styleTokens, 'font:' + tag + ':' + fontBucket(style.fontSize), 0.25);
        if (columnCount > 0) {
            add(styleTokens, 'grid-columns:' + tag + ':' + Math.min(columnCount, 6), 2);
        }
        if (style.borderTopStyle !== 'none') {
            add(styleTokens, 'border:' + tag, 0.5);
        }
        if (style.boxShadow !== 'none') {
            add(styleTokens, 'shadow:' + tag, 0.5);
        }
    }

    return { structureTokens, styleTokens };
})()
`;

export class BenchmarkScreenshotSession {
    readonly viewport: { width: number; height: number };

    private readonly outputDirectory: string;
    private readonly screenshotsDirectory: string;
    private readonly renderCacheDirectory: string;
    private readonly timeoutMs: number;
    private browser: Browser | undefined;
    private launchAttempted = false;
    private launchError: string | undefined;

    constructor(options: BenchmarkScreenshotSessionOptions) {
        this.outputDirectory = path.resolve(options.outputDirectory);
        this.screenshotsDirectory = path.join(
            this.outputDirectory,
            "screenshots",
        );
        this.renderCacheDirectory = path.join(
            this.outputDirectory,
            ".similarity-render-cache",
        );
        this.viewport = options.viewport ?? { width: 1280, height: 800 };
        this.timeoutMs = options.timeoutMs ?? 20_000;
    }

    private async ensureBrowser(): Promise<Browser> {
        if (this.browser) {
            return this.browser;
        }
        if (this.launchAttempted && this.launchError) {
            throw new Error(this.launchError);
        }
        this.launchAttempted = true;
        try {
            this.browser = await chromium.launch({ headless: true });
            return this.browser;
        } catch (error) {
            this.launchError = normalizeError(error);
            throw error;
        }
    }

    async capture(input: {
        id: string;
        appSource: string;
        cssSource: string;
    }): Promise<BenchmarkScreenshotCapture> {
        const caseId = sanitizeCaseId(input.id);
        const caseDirectory = path.join(this.renderCacheDirectory, caseId);
        const sourceDirectory = path.join(caseDirectory, "src");
        const bundlePath = path.join(caseDirectory, "bundle.js");
        const cssBundlePath = path.join(caseDirectory, "bundle.css");
        const htmlPath = path.join(caseDirectory, "index.html");
        const screenshotPath = path.join(
            this.screenshotsDirectory,
            `${caseId}-${this.viewport.width}x${this.viewport.height}.png`,
        );

        try {
            await mkdir(sourceDirectory, { recursive: true });
            await mkdir(this.screenshotsDirectory, { recursive: true });
            await Promise.all([
                writeFile(
                    path.join(sourceDirectory, "App.tsx"),
                    input.appSource,
                    "utf8",
                ),
                writeFile(
                    path.join(sourceDirectory, "App.css"),
                    input.cssSource,
                    "utf8",
                ),
                writeFile(
                    path.join(sourceDirectory, "entry.tsx"),
                    `import { createRoot } from "react-dom/client";\nimport "./App.css";\nimport { App } from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`,
                    "utf8",
                ),
            ]);

            await build({
                absWorkingDir: caseDirectory,
                entryPoints: [path.join(sourceDirectory, "entry.tsx")],
                outfile: bundlePath,
                bundle: true,
                platform: "browser",
                format: "iife",
                target: "es2022",
                jsx: "automatic",
                logLevel: "silent",
                nodePaths: [
                    path.resolve(process.cwd(), "node_modules"),
                    path.resolve(process.cwd(), "../../node_modules"),
                ],
                sourcemap: false,
                metafile: false,
            });

            await writeFile(
                htmlPath,
                `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n<title>${caseId}</title>\n<link rel="stylesheet" href="./${path.basename(cssBundlePath)}" />\n</head>\n<body>\n<div id="root"></div>\n<script src="./${path.basename(bundlePath)}"></script>\n</body>\n</html>\n`,
                "utf8",
            );

            const browser = await this.ensureBrowser();
            const page = await browser.newPage({ viewport: this.viewport });
            try {
                page.setDefaultTimeout(this.timeoutMs);
                page.setDefaultNavigationTimeout(this.timeoutMs);
                await page.goto(pathToFileURL(htmlPath).href, {
                    waitUntil: "load",
                    timeout: this.timeoutMs,
                });
                await page.waitForSelector("#root > *", {
                    state: "visible",
                    timeout: this.timeoutMs,
                });
                await page.evaluate(
                    WAIT_FOR_BENCHMARK_FONTS_EXPRESSION,
                );
                await page.waitForTimeout(120);

                const pngBuffer = await page.screenshot({
                    path: screenshotPath,
                    type: "png",
                    fullPage: false,
                    animations: "disabled",
                });
                const runtime = await page.evaluate<RuntimeVisualFingerprint>(
                    COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION,
                );

                const normalizedRuntime: RuntimeVisualFingerprint = {
                    structureTokens: {},
                    styleTokens: {},
                };
                for (const [token, weight] of Object.entries(
                    runtime.structureTokens,
                )) {
                    addRuntimeToken(
                        normalizedRuntime.structureTokens,
                        token,
                        weight,
                    );
                }
                for (const [token, weight] of Object.entries(
                    runtime.styleTokens,
                )) {
                    addRuntimeToken(
                        normalizedRuntime.styleTokens,
                        token,
                        weight,
                    );
                }

                return {
                    screenshotPath,
                    fingerprint: createScreenshotFingerprint(pngBuffer),
                    runtime: normalizedRuntime,
                };
            } finally {
                await page.close().catch(() => undefined);
            }
        } catch (error) {
            return { error: normalizeError(error) };
        }
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close().catch(() => undefined);
            this.browser = undefined;
        }
        await rm(this.renderCacheDirectory, {
            recursive: true,
            force: true,
        }).catch(() => undefined);
    }
}
