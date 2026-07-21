import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createCrossTemplateSimilarityReport } from "./cross-template-similarity.js";

const rendererSourceUrl = new URL("./stable-page-renderer.ts", import.meta.url);
const screenshotRendererSourceUrl = new URL(
    "./benchmark-screenshot-renderer.ts",
    import.meta.url,
);

describe("V9.4.1 runtime layout tracing", () => {
    it("emits runtime family, primitive and renderer attributes on the generated app root", async () => {
        const source = await readFile(rendererSourceUrl, "utf8");
        expect(source).toContain("APPFORGE_PHASE4_RUNTIME_LAYOUT_TRACE_V9_4_1");
        expect(source).toContain("data-appforge-layout-family={page.layout.family}");
        expect(source).toContain("data-appforge-layout-primitive={page.layout.primaryPrimitive}");
        expect(source).toContain("data-appforge-renderer={resolveAppforgeRendererName()}");
        expect(source).toContain("function resolveAppforgeRendererName()");
    });

    it("collects the runtime trace from the rendered browser DOM", async () => {
        const source = await readFile(screenshotRendererSourceUrl, "utf8");
        expect(source).toContain("data-appforge-layout-family");
        expect(source).toContain("data-appforge-layout-primitive");
        expect(source).toContain("data-appforge-renderer");
        expect(source).toContain("rootStructureSignature");
        expect(source).toContain("...(normalizedTrace ? { trace: normalizedTrace } : {})");
    });

    it("propagates the runtime trace into similarity report cases", () => {
        const report = createCrossTemplateSimilarityReport([
            {
                id: "case-a",
                applicationType: "dashboard",
                templateVariant: "sidebar-console",
                structureTokens: { a: 1 },
                styleTokens: { b: 1 },
                runtimeTrace: {
                    layoutFamily: "operations-console",
                    layoutPrimitive: "data-region",
                    renderer: "DashboardAdaptiveLayout:table",
                    rootStructureSignature: "div.stable-app>main.dashboard-variant",
                },
            },
            {
                id: "case-b",
                applicationType: "dashboard",
                templateVariant: "report-board",
                structureTokens: { c: 1 },
                styleTokens: { d: 1 },
                runtimeTrace: {
                    layoutFamily: "incident-command",
                    layoutPrimitive: "workflow-lane",
                    renderer: "DashboardAdaptiveLayout:table",
                    rootStructureSignature: "div.stable-app>main.dashboard-variant",
                },
            },
        ]);

        expect(report.cases[0]).toMatchObject({
            layoutFamily: "operations-console",
            layoutPrimitive: "data-region",
            renderer: "DashboardAdaptiveLayout:table",
            rootStructureSignature: "div.stable-app>main.dashboard-variant",
        });
    });
});
