import { describe, expect, it } from "vitest";

import {
    compareScreenshotFingerprints,
    createCrossTemplateSimilarityReport,
    createScreenshotFingerprint,
    createSimilarityMatrixCsv,
    formatCrossTemplateSimilarityMarkdown,
    weightedJaccard,
    type CrossTemplateSimilarityCaseInput,
    type ScreenshotFingerprint,
} from "./cross-template-similarity.js";

function screenshot(values: number[]): ScreenshotFingerprint {
    return {
        gridWidth: 2,
        gridHeight: 2,
        luminance: values,
        edges: values.map((value, index) =>
            Math.abs(value - (values[index + 1] ?? value)),
        ),
    };
}

function caseInput(
    id: string,
    applicationType: CrossTemplateSimilarityCaseInput["applicationType"],
    structureToken: string,
    styleToken: string,
    screenshotValues: number[],
): CrossTemplateSimilarityCaseInput {
    return {
        id,
        applicationType,
        templateVariant: `${applicationType}-variant`,
        structureTokens: {
            shared: 2,
            [structureToken]: 4,
        },
        styleTokens: {
            shared: 1,
            [styleToken]: 3,
        },
        screenshotFingerprint: screenshot(screenshotValues),
        screenshotPath: `screenshots/${id}.png`,
    };
}

describe("cross-template similarity", () => {
    it("compares weighted tokens and screenshot fingerprints deterministically", () => {
        expect(weightedJaccard({ a: 2, b: 1 }, { a: 1, c: 1 })).toBeCloseTo(0.25);
        const first = screenshot([0.1, 0.3, 0.7, 0.9]);
        const same = screenshot([0.1, 0.3, 0.7, 0.9]);
        const different = screenshot([0.9, 0.7, 0.3, 0.1]);

        expect(compareScreenshotFingerprints(first, same)).toBe(1);
        expect(compareScreenshotFingerprints(first, different)).toBeLessThan(0.9);
    });

    it("decodes a PNG screenshot into a stable low-resolution fingerprint", () => {
        const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
        );
        const fingerprint = createScreenshotFingerprint(png, 2, 2);

        expect(fingerprint.gridWidth).toBe(2);
        expect(fingerprint.gridHeight).toBe(2);
        expect(fingerprint.luminance).toHaveLength(4);
        expect(fingerprint.edges).toHaveLength(4);
    });

    it("finds nearest neighbours, cross-type pairs, and repetition clusters", () => {
        const inputs = [
            caseInput("dashboard-a", "dashboard", "metrics", "contained", [0.1, 0.2, 0.8, 0.9]),
            caseInput("dashboard-b", "dashboard", "metrics", "contained", [0.1, 0.2, 0.8, 0.9]),
            caseInput("editorial-a", "editorial", "story", "open", [0.8, 0.7, 0.2, 0.1]),
        ];
        const report = createCrossTemplateSimilarityReport(inputs, {
            screenshotRequested: true,
            thresholds: {
                clusterScore: 70,
            },
        });

        expect(report.summary.totalPairs).toBe(3);
        expect(report.screenshotCapture.capturedCases).toHaveLength(3);
        expect(report.cases.find((item) => item.id === "dashboard-a")?.mostSimilarCase).toBe(
            "dashboard-b",
        );
        expect(report.pairs[0]?.repetitionScore).toBeGreaterThanOrEqual(95);
        expect(report.clusters.some((cluster) => cluster.members.includes("dashboard-a"))).toBe(true);
        expect(formatCrossTemplateSimilarityMarkdown(report)).toContain(
            "Cross-Template Similarity Benchmark",
        );
        expect(createSimilarityMatrixCsv(report)).toContain("dashboard-a");
    });

    it("keeps screenshot unavailability as a soft diagnostic", () => {
        const report = createCrossTemplateSimilarityReport([
            {
                id: "one",
                applicationType: "custom",
                templateVariant: "one",
                structureTokens: { a: 1 },
                styleTokens: { x: 1 },
                screenshotError: "browser unavailable",
            },
            {
                id: "two",
                applicationType: "product",
                templateVariant: "two",
                structureTokens: { b: 1 },
                styleTokens: { y: 1 },
                screenshotError: "browser unavailable",
            },
        ], {
            screenshotRequested: true,
        });

        expect(report.screenshotCapture.available).toBe(false);
        expect(report.screenshotCapture.failedCases).toHaveLength(2);
        expect(report.pairs[0]?.screenshotSimilarity).toBeNull();
    });
});
