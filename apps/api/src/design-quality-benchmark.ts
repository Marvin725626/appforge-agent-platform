import { OpenAICompatibleProvider, type ModelProvider } from "@appforge/agent-core";
import { DesignPlanSchema, type DesignPlan } from "@appforge/protocol";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
    DESIGN_BENCHMARK_PROMPTS,
    type DesignBenchmarkPrompt,
} from "./design-benchmark-prompts.js";
import {
    evaluateDesignQuality,
    type DesignQualityReport,
} from "./design-quality-evaluator.js";
import {
    evaluateAntiTemplate,
    type AntiTemplateReport,
} from "./anti-template-evaluator.js";
import { BenchmarkScreenshotSession } from "./benchmark-screenshot-renderer.js";
import {
    createCrossTemplateSimilarityReport,
    createSimilarityMatrixCsv,
    createStaticSimilarityFingerprints,
    formatCrossTemplateSimilarityMarkdown,
    type CrossTemplateSimilarityCaseInput,
} from "./cross-template-similarity.js";
import { generateStablePageContent, type StablePageContent } from "./stable-page-content.js";
import {
    createStableAppSource,
    createStableCssSource,
} from "./stable-page-renderer.js";

export type DesignBenchmarkCaseResult = {
    id: string;
    applicationType: DesignBenchmarkPrompt["applicationType"];
    prompt: string;
    durationMs: number;
    contentSource: "ai" | "fallback";
    warnings: string[];
    quality: DesignQualityReport;
    antiTemplate: AntiTemplateReport;
};

export type DesignBenchmarkReport = {
    version: 2;
    generatedAt: string;
    mode: "fallback" | "ai";
    thresholds: {
        minimumCaseScore: number;
        minimumPassRate: number;
        minimumAverageScore: number;
    };
    summary: {
        total: number;
        passed: number;
        failed: number;
        passRate: number;
        averageScore: number;
        gatePassed: boolean;
        uniqueTemplates: string[];
        uniquePalettes: string[];
        uniqueFontPairs: string[];
        antiTemplate: {
            averageScore: number;
            passCases: string[];
            warningCases: string[];
            severeCases: string[];
            highCardCases: string[];
            largeRadiusCases: string[];
            homogeneousGridCases: string[];
            highDomRepetitionCases: string[];
            softGatePassed: boolean;
        };
    };
    byType: Record<
        DesignBenchmarkPrompt["applicationType"],
        {
            total: number;
            passed: number;
            averageScore: number;
            templateVariants: string[];
        }
    >;
    cases: DesignBenchmarkCaseResult[];
};

export type DesignBenchmarkGeneratedArtifact = {
    id: string;
    applicationType: DesignBenchmarkPrompt["applicationType"];
    prompt: string;
    designPlan: DesignPlan;
    content: StablePageContent;
    appSource: string;
    cssSource: string;
    quality: DesignQualityReport;
    antiTemplate: AntiTemplateReport;
};

export type RunDesignQualityBenchmarkOptions = {
    mode?: "fallback" | "ai";
    limit?: number;
    promptIds?: string[];
    minimumCaseScore?: number;
    minimumPassRate?: number;
    minimumAverageScore?: number;
    model?: ModelProvider;
    onCaseGenerated?: (
        artifact: DesignBenchmarkGeneratedArtifact,
    ) => void | Promise<void>;
};

const TYPE_MOTIFS: Record<DesignBenchmarkPrompt["applicationType"], string[]> = {
    game: ["HUD 状态读数", "轨道时间线", "地图点位", "装备矩阵"],
    dashboard: ["高密度指标带", "状态语义", "明细表格", "处置流程"],
    product: ["产品工作流", "能力矩阵", "监控证据", "开发者集成"],
    commerce: ["商品陈列", "规格矩阵", "品牌叙事", "购买入口"],
    editorial: ["长文导语", "关键数据", "人物引语", "事件脉络"],
    institution: ["机构使命", "重点项目", "影响数据", "参与入口"],
    portfolio: ["项目画廊", "案例过程", "能力矩阵", "经历时间线"],
    custom: ["主题舞台", "信息轨道", "行动节点", "完整页脚"],
};

function createBenchmarkDesignPlan(prompt: DesignBenchmarkPrompt): DesignPlan {
    return DesignPlanSchema.parse({
        version: 1,
        applicationType: prompt.applicationType,
        designIntent: {
            audience: "该场景的真实目标用户",
            primaryGoal: prompt.prompt,
            emotionalTone: ["可信", "清晰", "有节奏"],
            brandTraits: ["专业", "具体", "可执行"],
        },
        informationArchitecture: {
            routes: [
                {
                    path: "/",
                    purpose: `${prompt.applicationType} 单页首页`,
                    primaryContent: prompt.requiredConcepts,
                    primaryActions: ["查看核心内容", "继续行动"],
                },
            ],
        },
        visualDNA: {
            composition: `${prompt.applicationType} 类型的分层单页构图，首屏建立主视觉，内容区按任务路径推进。`,
            density: prompt.density,
            surfaceStrategy: prompt.surfaceStrategy,
            navigationPattern: "紧凑锚点导航",
            heroPattern: "带明确标题、摘要、关键读数和主行动入口的首屏",
            sectionRhythm: prompt.requiredConcepts.map(
                (concept, index) => `${index + 1}. ${concept}内容区`,
            ),
            typographyCharacter: "清晰标题层级与可扫描正文",
            shapeLanguage: prompt.surfaceStrategy === "contained" ? "紧凑边框与分层面板" : "开放内容带与明确分隔",
            mediaStrategy: "一张主题主视觉，失败时使用稳定 CSS 视觉兜底",
            uniqueMotifs: TYPE_MOTIFS[prompt.applicationType],
            forbiddenPatterns: ["lorem ipsum 占位文案", "所有区块完全相同", "低对比文字"],
        },
        designTokens: {
            colorRoles: {
                background: "深色或中性背景",
                surface: "区分内容层级的表面",
                foreground: "高对比正文",
                mutedForeground: "可读辅助文字",
                accent: "单一强调色",
                accentForeground: "强调色上的高对比文字",
            },
            radiusScale: [0, 4, 8, 12],
            spacingScale: [4, 8, 12, 16, 24, 32, 48],
        },
        acceptanceCriteria: [
            {
                id: "DESIGN-1",
                instruction: `页面必须覆盖：${prompt.requiredConcepts.join("、")}。`,
                verification: "检查对应内容区、条目与行动入口是否真实存在。",
            },
            {
                id: "DESIGN-2",
                instruction: "页面必须响应式、可构建并具备键盘焦点样式。",
                verification: "检查媒体查询、focus-visible 与 reduced-motion。",
            },
        ],
    });
}

function createModelFromEnvironment(): ModelProvider {
    const baseUrl = process.env.APPFORGE_LLM_BASE_URL;
    const apiKey = process.env.APPFORGE_LLM_API_KEY;
    const model = process.env.APPFORGE_LLM_MODEL;
    if (!baseUrl || !apiKey || !model) {
        throw new Error(
            "AI benchmark mode requires APPFORGE_LLM_BASE_URL, APPFORGE_LLM_API_KEY, and APPFORGE_LLM_MODEL.",
        );
    }

    return new OpenAICompatibleProvider({
        baseUrl,
        apiKey,
        model,
        timeoutMs: Number(process.env.APPFORGE_LLM_TIMEOUT_MS ?? 180_000),
        maxRetries: Number(process.env.APPFORGE_LLM_MAX_RETRIES ?? 0),
        stream: process.env.APPFORGE_LLM_STREAM?.toLowerCase() !== "false",
    });
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

export async function runDesignQualityBenchmark(
    options: RunDesignQualityBenchmarkOptions = {},
): Promise<DesignBenchmarkReport> {
    const mode = options.mode ?? "fallback";
    const minimumCaseScore = options.minimumCaseScore ?? 75;
    const minimumPassRate = options.minimumPassRate ?? 0.95;
    const minimumAverageScore = options.minimumAverageScore ?? 82;
    const promptIdSet = new Set(options.promptIds ?? []);
    const selectedPrompts = DESIGN_BENCHMARK_PROMPTS.filter(
        (prompt) => promptIdSet.size === 0 || promptIdSet.has(prompt.id),
    ).slice(0, options.limit ?? DESIGN_BENCHMARK_PROMPTS.length);
    const model = mode === "ai" ? (options.model ?? createModelFromEnvironment()) : undefined;
    const cases: DesignBenchmarkCaseResult[] = [];

    for (const benchmarkPrompt of selectedPrompts) {
        const startedAt = Date.now();
        const designPlan = createBenchmarkDesignPlan(benchmarkPrompt);
        const generated = await generateStablePageContent({
            goal: benchmarkPrompt.prompt,
            designPlan,
            ...(model ? { model } : {}),
        });
        const appSource = createStableAppSource(generated.content, {
            heroAlt: generated.content.hero.imageAlt,
        });
        const cssSource = createStableCssSource(generated.content, designPlan);
        const quality = evaluateDesignQuality({
            goal: benchmarkPrompt.prompt,
            expectedApplicationType: benchmarkPrompt.applicationType,
            requiredConcepts: benchmarkPrompt.requiredConcepts,
            expectedSectionKinds: benchmarkPrompt.expectedSectionKinds,
            designPlan,
            content: generated.content,
            appSource,
            cssSource,
            threshold: minimumCaseScore,
        });

        const antiTemplate = evaluateAntiTemplate({
            applicationType: benchmarkPrompt.applicationType,
            content: generated.content,
            appSource,
            cssSource,
        });

        if (options.onCaseGenerated) {
            await options.onCaseGenerated({
                id: benchmarkPrompt.id,
                applicationType: benchmarkPrompt.applicationType,
                prompt: benchmarkPrompt.prompt,
                designPlan,
                content: generated.content,
                appSource,
                cssSource,
                quality,
                antiTemplate,
            });
        }

        cases.push({
            id: benchmarkPrompt.id,
            applicationType: benchmarkPrompt.applicationType,
            prompt: benchmarkPrompt.prompt,
            durationMs: Date.now() - startedAt,
            contentSource: generated.source,
            warnings: generated.warnings,
            quality,
            antiTemplate,
        });
    }

    const passed = cases.filter((result) => result.quality.passed).length;
    const passRate = cases.length === 0 ? 0 : passed / cases.length;
    const averageScore = round(average(cases.map((result) => result.quality.score)));
    const antiTemplateAverageScore = round(
        average(cases.map((result) => result.antiTemplate.score)),
    );
    const antiTemplatePassCases = cases
        .filter((result) => result.antiTemplate.level === "pass")
        .map((result) => result.id);
    const antiTemplateWarningCases = cases
        .filter((result) => result.antiTemplate.level === "warning")
        .map((result) => result.id);
    const antiTemplateSevereCases = cases
        .filter((result) => result.antiTemplate.level === "severe")
        .map((result) => result.id);
    const highCardCases = cases
        .filter((result) =>
            result.antiTemplate.metrics.cardContainerRatio >=
            result.antiTemplate.thresholds.cardContainerRatio.warning,
        )
        .map((result) => result.id);
    const largeRadiusCases = cases
        .filter((result) =>
            result.antiTemplate.metrics.largeRadiusContainerRatio >=
            result.antiTemplate.thresholds.largeRadiusContainerRatio.warning,
        )
        .map((result) => result.id);
    const homogeneousGridCases = cases
        .filter((result) =>
            result.antiTemplate.metrics.homogeneousThreeColumnGridCount >=
            result.antiTemplate.thresholds.homogeneousThreeColumnGridCount.warning,
        )
        .map((result) => result.id);
    const highDomRepetitionCases = cases
        .filter((result) =>
            result.antiTemplate.metrics.repeatedDomPatternRatio >=
            result.antiTemplate.thresholds.repeatedDomPatternRatio.warning,
        )
        .map((result) => result.id);

    const applicationTypes = [
        "editorial",
        "institution",
        "dashboard",
        "commerce",
        "product",
        "portfolio",
        "game",
        "custom",
    ] as const;
    const byType = Object.fromEntries(
        applicationTypes.map((applicationType) => {
            const typeCases = cases.filter((result) => result.applicationType === applicationType);
            return [
                applicationType,
                {
                    total: typeCases.length,
                    passed: typeCases.filter((result) => result.quality.passed).length,
                    averageScore: round(average(typeCases.map((result) => result.quality.score))),
                    templateVariants: [
                        ...new Set(typeCases.map((result) => result.quality.metadata.templateVariant)),
                    ].sort(),
                },
            ];
        }),
    ) as DesignBenchmarkReport["byType"];

    return {
        version: 2,
        generatedAt: new Date().toISOString(),
        mode,
        thresholds: {
            minimumCaseScore,
            minimumPassRate,
            minimumAverageScore,
        },
        summary: {
            total: cases.length,
            passed,
            failed: cases.length - passed,
            passRate: round(passRate),
            averageScore,
            gatePassed:
                cases.length > 0 &&
                passRate >= minimumPassRate &&
                averageScore >= minimumAverageScore,
            uniqueTemplates: [
                ...new Set(cases.map((result) => result.quality.metadata.templateVariant)),
            ].sort(),
            uniquePalettes: [
                ...new Set(cases.map((result) => result.quality.metadata.palette)),
            ].sort(),
            uniqueFontPairs: [
                ...new Set(cases.map((result) => result.quality.metadata.fontPair)),
            ].sort(),
            antiTemplate: {
                averageScore: antiTemplateAverageScore,
                passCases: antiTemplatePassCases,
                warningCases: antiTemplateWarningCases,
                severeCases: antiTemplateSevereCases,
                highCardCases,
                largeRadiusCases,
                homogeneousGridCases,
                highDomRepetitionCases,
                softGatePassed:
                    cases.length > 0 &&
                    antiTemplateSevereCases.length === 0 &&
                    antiTemplateAverageScore >= 75,
            },
        },
        byType,
        cases,
    };
}

export function formatDesignBenchmarkMarkdown(report: DesignBenchmarkReport): string {
    const lines = [
        "# AppForge Design Quality Benchmark",
        "",
        `- Generated: ${report.generatedAt}`,
        `- Mode: ${report.mode}`,
        `- Gate: ${report.summary.gatePassed ? "PASS" : "FAIL"}`,
        `- Cases: ${report.summary.passed}/${report.summary.total} passed`,
        `- Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`,
        `- Average score: ${report.summary.averageScore}/100`,
        `- Templates observed: ${report.summary.uniqueTemplates.join(", ")}`,
        `- Anti-template soft gate: ${report.summary.antiTemplate.softGatePassed ? "PASS" : "WARN"}`,
        `- Anti-template average: ${report.summary.antiTemplate.averageScore}/100`,
        "",
        "## Results by application type",
        "",
        "| Type | Passed | Average | Variants |",
        "|---|---:|---:|---|",
        ...Object.entries(report.byType).map(
            ([applicationType, result]) =>
                `| ${applicationType} | ${result.passed}/${result.total} | ${result.averageScore} | ${result.templateVariants.join(", ") || "-"} |`,
        ),
        "",
        "## Anti-template summary",
        "",
        `- Pass cases: ${report.summary.antiTemplate.passCases.length}`,
        `- Warning cases: ${report.summary.antiTemplate.warningCases.join(", ") || "-"}`,
        `- Severe cases: ${report.summary.antiTemplate.severeCases.join(", ") || "-"}`,
        `- High card ratio: ${report.summary.antiTemplate.highCardCases.join(", ") || "-"}`,
        `- Large radius ratio: ${report.summary.antiTemplate.largeRadiusCases.join(", ") || "-"}`,
        `- Homogeneous three-column grids: ${report.summary.antiTemplate.homogeneousGridCases.join(", ") || "-"}`,
        `- High DOM repetition: ${report.summary.antiTemplate.highDomRepetitionCases.join(", ") || "-"}`,
        "",
        "## Case details",
        "",
        "| Prompt | Type | Source | Score | Anti-template | Result | Main findings |",
        "|---|---|---|---:|---:|---|---|",
        ...report.cases.map((result) => {
            const findings = result.quality.findings
                .filter((finding) => finding.severity !== "info")
                .slice(0, 3)
                .map((finding) => finding.message.replace(/\|/gu, "/"))
                .join(" ");
            return `| ${result.id} | ${result.applicationType} | ${result.contentSource} | ${result.quality.score} | ${result.antiTemplate.score} (${result.antiTemplate.level}) | ${result.quality.passed ? "PASS" : "FAIL"} | ${findings || "-"} |`;
        }),
        "",
    ];
    return lines.join("\n");
}

export type AntiTemplateBenchmarkReport = {
    version: 1;
    generatedAt: string;
    mode: "fallback" | "ai";
    summary: DesignBenchmarkReport["summary"]["antiTemplate"];
    cases: Array<{
        id: string;
        applicationType: DesignBenchmarkPrompt["applicationType"];
        templateVariant: string;
        antiTemplate: AntiTemplateReport;
    }>;
};

export function createAntiTemplateBenchmarkReport(
    report: DesignBenchmarkReport,
): AntiTemplateBenchmarkReport {
    return {
        version: 1,
        generatedAt: report.generatedAt,
        mode: report.mode,
        summary: report.summary.antiTemplate,
        cases: report.cases.map((result) => ({
            id: result.id,
            applicationType: result.applicationType,
            templateVariant: result.quality.metadata.templateVariant,
            antiTemplate: result.antiTemplate,
        })),
    };
}

export function formatAntiTemplateBenchmarkMarkdown(
    report: AntiTemplateBenchmarkReport,
): string {
    return [
        "# AppForge Anti-Template Static Benchmark",
        "",
        `- Generated: ${report.generatedAt}`,
        `- Mode: ${report.mode}`,
        `- Soft gate: ${report.summary.softGatePassed ? "PASS" : "WARN"}`,
        `- Average score: ${report.summary.averageScore}/100`,
        `- Warning cases: ${report.summary.warningCases.join(", ") || "-"}`,
        `- Severe cases: ${report.summary.severeCases.join(", ") || "-"}`,
        "",
        "## Case metrics",
        "",
        "| Case | Type | Template | Score | Level | Card ratio | Large radius | 3-col grids | DOM repetition |",
        "|---|---|---|---:|---|---:|---:|---:|---:|",
        ...report.cases.map((result) => {
            const metrics = result.antiTemplate.metrics;
            return `| ${result.id} | ${result.applicationType} | ${result.templateVariant} | ${result.antiTemplate.score} | ${result.antiTemplate.level} | ${(metrics.cardContainerRatio * 100).toFixed(1)}% | ${(metrics.largeRadiusContainerRatio * 100).toFixed(1)}% | ${metrics.homogeneousThreeColumnGridCount} | ${(metrics.repeatedDomPatternRatio * 100).toFixed(1)}% |`;
        }),
        "",
        "## Findings",
        "",
        ...report.cases.flatMap((result) =>
            result.antiTemplate.findings.length === 0
                ? []
                : [
                    `### ${result.id}`,
                    "",
                    ...result.antiTemplate.findings.map(
                        (finding) => `- **${finding.severity.toUpperCase()}** ${finding.message}`,
                    ),
                    "",
                ],
        ),
    ].join("\n");
}

function parseCliArguments(argv: string[]): {
    mode: "fallback" | "ai";
    limit?: number;
    outputDirectory: string;
    strict: boolean;
    captureScreenshots: boolean;
} {
    let mode: "fallback" | "ai" = "fallback";
    let limit: number | undefined;
    let outputDirectory = path.resolve(process.cwd(), "../../artifacts/design-benchmark");
    let strict = false;
    let captureScreenshots = true;

    for (const argument of argv) {
        if (argument === "--ai") {
            mode = "ai";
        } else if (argument === "--strict") {
            strict = true;
        } else if (argument === "--skip-screenshots") {
            captureScreenshots = false;
        } else if (argument.startsWith("--limit=")) {
            const parsed = Number(argument.slice("--limit=".length));
            if (Number.isFinite(parsed) && parsed > 0) {
                limit = Math.floor(parsed);
            }
        } else if (argument.startsWith("--output=")) {
            outputDirectory = path.resolve(argument.slice("--output=".length));
        }
    }

    return {
        mode,
        ...(limit ? { limit } : {}),
        outputDirectory,
        strict,
        captureScreenshots,
    };
}

async function main(): Promise<void> {
    const args = parseCliArguments(process.argv.slice(2));
    await mkdir(args.outputDirectory, { recursive: true });
    const similarityInputs: CrossTemplateSimilarityCaseInput[] = [];
    const screenshotSession = args.captureScreenshots
        ? new BenchmarkScreenshotSession({
            outputDirectory: args.outputDirectory,
            viewport: { width: 1280, height: 800 },
        })
        : undefined;

    let report: DesignBenchmarkReport;
    try {
        report = await runDesignQualityBenchmark({
            mode: args.mode,
            ...(args.limit ? { limit: args.limit } : {}),
            onCaseGenerated: async (artifact) => {
                const capture = screenshotSession
                    ? await screenshotSession.capture({
                        id: artifact.id,
                        appSource: artifact.appSource,
                        cssSource: artifact.cssSource,
                    })
                    : {};
                const fingerprints = createStaticSimilarityFingerprints({
                    content: artifact.content,
                    appSource: artifact.appSource,
                    cssSource: artifact.cssSource,
                    ...(capture.runtime ? { runtime: capture.runtime } : {}),
                });
                similarityInputs.push({
                    id: artifact.id,
                    applicationType: artifact.applicationType,
                    templateVariant: artifact.quality.metadata.templateVariant,
                    structureTokens: fingerprints.structureTokens,
                    styleTokens: fingerprints.styleTokens,
                    ...(capture.fingerprint
                        ? { screenshotFingerprint: capture.fingerprint }
                        : {}),
                    ...(capture.screenshotPath
                        ? {
                            screenshotPath: path.relative(
                                args.outputDirectory,
                                capture.screenshotPath,
                            ).replace(/\\/gu, "/"),
                        }
                        : {}),
                    ...(capture.error ? { screenshotError: capture.error } : {}),
                });
            },
        });
    } finally {
        await screenshotSession?.close();
    }

    const antiTemplateReport = createAntiTemplateBenchmarkReport(report);
    const similarityReport = createCrossTemplateSimilarityReport(
        similarityInputs,
        {
            viewport: { width: 1280, height: 800 },
            screenshotRequested: args.captureScreenshots,
        },
    );
    await Promise.all([
        writeFile(
            path.join(args.outputDirectory, "design-quality-report.json"),
            `${JSON.stringify(report, null, 2)}\n`,
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "design-quality-report.md"),
            formatDesignBenchmarkMarkdown(report),
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "anti-template-report.json"),
            `${JSON.stringify(antiTemplateReport, null, 2)}\n`,
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "anti-template-report.md"),
            formatAntiTemplateBenchmarkMarkdown(antiTemplateReport),
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "visual-similarity-report.json"),
            `${JSON.stringify(similarityReport, null, 2)}\n`,
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "visual-similarity-report.md"),
            formatCrossTemplateSimilarityMarkdown(similarityReport),
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "similarity-matrix.csv"),
            createSimilarityMatrixCsv(similarityReport),
            "utf8",
        ),
        writeFile(
            path.join(args.outputDirectory, "template-clusters.json"),
            `${JSON.stringify({
                generatedAt: similarityReport.generatedAt,
                threshold: similarityReport.thresholds.clusterScore,
                clusters: similarityReport.clusters,
            }, null, 2)}\n`,
            "utf8",
        ),
    ]);

    console.log(
        `Design benchmark ${report.summary.gatePassed ? "PASS" : "FAIL"}: ` +
            `${report.summary.passed}/${report.summary.total} passed, ` +
            `average ${report.summary.averageScore}/100.`,
    );
    console.log(
        `Similarity benchmark: ${similarityReport.summary.totalPairs} pairs, ` +
            `${similarityReport.summary.severeCrossTypePairs} severe cross-type pairs, ` +
            `${similarityReport.screenshotCapture.capturedCases.length}/${similarityReport.summary.totalCases} screenshots.`,
    );
    console.log(`Reports written to ${args.outputDirectory}`);

    if (args.strict && !report.summary.gatePassed) {
        process.exitCode = 1;
    }
}

const isCliEntry = process.argv[1]
    ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
    : false;

if (isCliEntry) {
    await main();
}
