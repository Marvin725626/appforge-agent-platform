import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    collectMultiViewportVisualReport,
    createVisualViewportChecks,
    isMultiViewportVisualCheckName,
    type VisualViewportEvidence,
    type VisualViewportSpec,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    );
});

const viewport: VisualViewportSpec = {
    id: "mobile",
    width: 375,
    height: 812,
};

function createPassingEvidence(): VisualViewportEvidence {
    return {
        metrics: {
            pageOverflowPx: 0,
            criticalOverlapCount: 0,
            clippedElementCount: 0,
            lowContrastCount: 0,
            contrastSampleCount: 20,
            undersizedControlCount: 0,
            controlCount: 4,
            tinyTextCount: 0,
            textSampleCount: 20,
            minimumFontSizePx: 12,
        },
        overlapIssues: [],
        clippedIssues: [],
        contrastIssues: [],
        controlIssues: [],
        textIssues: [],
    };
}

describe("multi-viewport visual quality checks", () => {
    it("passes a responsive viewport with readable, unclipped content", () => {
        const checks = createVisualViewportChecks(
            viewport,
            createPassingEvidence(),
        );

        expect(checks).toHaveLength(6);
        expect(checks.every((check) => check.passed)).toBe(true);
        expect(
            checks.every((check) =>
                isMultiViewportVisualCheckName(check.name),
            ),
        ).toBe(true);
    });

    it("reports overflow, overlap, clipping, contrast, target, and tiny-text failures", () => {
        const evidence = createPassingEvidence();
        evidence.metrics = {
            ...evidence.metrics,
            pageOverflowPx: 48,
            criticalOverlapCount: 1,
            clippedElementCount: 1,
            lowContrastCount: 8,
            undersizedControlCount: 3,
            tinyTextCount: 7,
        };
        evidence.overlapIssues = [
            { selector: "h1 ↔ nav", message: "80% overlap" },
        ];
        evidence.clippedIssues = [
            { selector: "button.primary", message: "right edge clipped" },
        ];
        evidence.contrastIssues = [
            { selector: "p.muted", message: "contrast 2.1:1" },
        ];
        evidence.controlIssues = [
            { selector: "button.icon", message: "24x24px target" },
        ];
        evidence.textIssues = [
            { selector: "small.meta", message: "font-size 9px" },
        ];

        const checks = createVisualViewportChecks(viewport, evidence);

        expect(checks.every((check) => !check.passed)).toBe(true);
        expect(checks[0]?.message).toContain("48px wider");
        expect(checks[1]?.message).toContain("h1 ↔ nav");
        expect(checks[3]?.message).toContain("WCAG");
    });

    it("evaluates four viewports and writes screenshot artifacts", async () => {
        const artifactDirectory = await mkdtemp(
            path.join(os.tmpdir(), "appforge-visual-eval-"),
        );
        temporaryDirectories.push(artifactDirectory);
        const setViewportSize = vi.fn(async () => undefined);
        const screenshot = vi.fn(async (options: { path: string }) => {
            await writeFile(options.path, "png");
        });
        const fakePage = {
            setViewportSize,
            waitForTimeout: vi.fn(async () => undefined),
            evaluate: vi.fn(async () => createPassingEvidence()),
            screenshot,
        } as unknown as Page;

        const report = await collectMultiViewportVisualReport({
            page: fakePage,
            artifactDirectory,
        });

        expect(report.passed).toBe(true);
        expect(report.viewports).toHaveLength(4);
        expect(setViewportSize).toHaveBeenCalledTimes(4);
        expect(screenshot).toHaveBeenCalledTimes(4);
        for (const viewportResult of report.viewports) {
            expect(viewportResult.screenshotPath).toBeTruthy();
            await expect(
                access(viewportResult.screenshotPath ?? ""),
            ).resolves.toBeUndefined();
        }
    });
});
