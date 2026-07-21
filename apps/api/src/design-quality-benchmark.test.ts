import { describe, expect, it } from "vitest";

import {
    createAntiTemplateBenchmarkReport,
    formatAntiTemplateBenchmarkMarkdown,
    formatDesignBenchmarkMarkdown,
    runDesignQualityBenchmark,
} from "./design-quality-benchmark.js";
import {
    getStableTemplateVariants,
    selectFallbackTemplateVariant,
} from "./stable-page-content.js";

describe("design quality benchmark", () => {
    it("runs the 24-case offline benchmark without model calls", async () => {
        const generatedCaseIds: string[] = [];
        const report = await runDesignQualityBenchmark({
            mode: "fallback",
            onCaseGenerated: (artifact) => {
                generatedCaseIds.push(artifact.id);
                expect(artifact.appSource).toContain("export function App");
                expect(artifact.cssSource).toContain("--project-composition");
            },
        });

        expect(report.summary.total).toBe(24);
        expect(generatedCaseIds).toHaveLength(24);
        expect(report.summary.passRate).toBeGreaterThanOrEqual(0.95);
        expect(report.summary.averageScore).toBeGreaterThanOrEqual(82);
        expect(report.summary.gatePassed).toBe(true);
        expect(report.summary.uniqueTemplates.length).toBeGreaterThanOrEqual(8);
        expect(report.cases.every((result) => result.contentSource === "fallback")).toBe(true);
        expect(report.cases.every((result) => result.antiTemplate.score >= 0)).toBe(true);
        expect(report.summary.antiTemplate.averageScore).toBeGreaterThanOrEqual(75);
        expect(report.summary.antiTemplate.severeCases).toEqual([]);
        expect(formatDesignBenchmarkMarkdown(report)).toContain("AppForge Design Quality Benchmark");
        const antiTemplateReport = createAntiTemplateBenchmarkReport(report);
        expect(antiTemplateReport.cases).toHaveLength(24);
        expect(formatAntiTemplateBenchmarkMarkdown(antiTemplateReport)).toContain(
            "AppForge Anti-Template Static Benchmark",
        );
    });

    it("selects deterministic and type-compatible fallback variants", () => {
        const goal = "创建一个高密度运营后台，包含指标、状态、表格和流程";
        const first = selectFallbackTemplateVariant(goal, "dashboard");
        const second = selectFallbackTemplateVariant(goal, "dashboard");

        expect(second).toBe(first);
        expect(getStableTemplateVariants("dashboard")).toContain(first);
        expect(selectFallbackTemplateVariant(goal, "product")).not.toBe("adaptive-story");
    });
});
