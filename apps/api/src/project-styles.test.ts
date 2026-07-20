import type { DesignPlan } from "@appforge/protocol";
import { describe, expect, it } from "vitest";

import { createFallbackDesignPlan } from "./design-plan-utils.js";
import {
    deriveLayoutPrimitives,
    formatDesignPlanMetadataStyles,
    formatProjectStyles,
} from "./project-styles.js";

function basePlan(): DesignPlan {
    return createFallbackDesignPlan({
        goal: "Create a focused website",
        plannerOutput: {
            summary: "Create a focused website",
            steps: [
                {
                    id: "step-1",
                    title: "Generate",
                    description: "Generate the site",
                    acceptanceCriteria: ["The site follows the design plan"],
                },
            ],
        },
        routes: [{ path: "/", purpose: "Home page" }],
    });
}

function planWith(
    applicationType: DesignPlan["applicationType"],
    visualDNA: Partial<DesignPlan["visualDNA"]>,
): DesignPlan {
    const plan = basePlan();
    return {
        ...plan,
        applicationType,
        visualDNA: {
            ...plan.visualDNA,
            ...visualDNA,
        },
    };
}

function stylesFor(plan: DesignPlan): string {
    return formatProjectStyles({
        designPlan: plan,
        pages: [{ id: "home", path: "/", label: "Home" }],
    });
}

describe("project DesignPlan layout primitives", () => {
    it("formats deterministic DesignPlan metadata markers independently of generated layout CSS", () => {
        const plan = planWith("game", {
            composition: "cinematic tactical stage",
            surfaceStrategy: "mixed",
            sectionRhythm: ["hero stage", "HUD strip"],
            uniqueMotifs: ["tactical rail"],
        });
        const metadata = formatDesignPlanMetadataStyles(plan);

        expect(metadata).toContain("appforge-design-plan-metadata:start");
        expect(metadata).toContain("--project-composition: \"cinematic tactical stage\"");
        expect(metadata).toContain("--surface-strategy: mixed");
        expect(metadata).toContain("--section-rhythm: \"hero stage / HUD strip\"");
        expect(metadata).toContain("--unique-motifs: \"tactical rail\"");
    });

    it("selects editorial primitives for an open city culture plan without legacy genre or card grid skeleton", () => {
        const plan = planWith("editorial", {
            composition: "modern city magazine with editorial rhythm",
            surfaceStrategy: "open",
            heroPattern: "typography-led editorial cover",
            sectionRhythm: ["story band", "timeline", "media break"],
            mediaStrategy: "large editorial image breaks",
            forbiddenPatterns: ["three equal cards", "SaaS hero"],
        });

        const primitives = deriveLayoutPrimitives(plan);
        const styles = stylesFor(plan);

        expect(primitives).toEqual(
            expect.arrayContaining([
                "typography-led-opening",
                "editorial-rail",
                "story-band",
                "timeline-flow",
                "media-break",
            ]),
        );
        expect(styles).toContain("--layout-primitives");
        expect(styles).toContain("typography-led-opening");
        expect(styles).toContain("editorial-rail");
        expect(styles).not.toContain("site-genre-editorial");
        expect(styles).not.toContain("page-card");
        expect(styles).not.toContain("page-grid");
        expect(styles).not.toContain("grid-template-columns: minmax(0, .95fr) minmax(18rem, 1.05fr)");
    });

    it("selects workflow and data primitives for Agent SaaS differently from the city plan", () => {
        const city = planWith("editorial", {
            composition: "modern city magazine with editorial rhythm",
            surfaceStrategy: "open",
            heroPattern: "typography-led editorial cover",
            sectionRhythm: ["story band", "timeline", "media break"],
            mediaStrategy: "editorial image breaks",
        });
        const saas = planWith("product", {
            composition: "Agent Runtime debugging platform workflow",
            surfaceStrategy: "mixed",
            heroPattern: "asymmetric product console opening",
            sectionRhythm: ["workflow lane", "trace flow", "data region"],
            mediaStrategy: "product screenshots and traces",
            uniqueMotifs: ["trace flow", "runtime stage", "diagnostic lane"],
        });

        const cityPrimitives = deriveLayoutPrimitives(city);
        const saasPrimitives = deriveLayoutPrimitives(saas);

        expect(saasPrimitives).toEqual(
            expect.arrayContaining(["workflow-lane", "data-region"]),
        );
        expect(saasPrimitives).not.toEqual(cityPrimitives);
        expect(stylesFor(saas)).toContain("workflow-lane");
    });

    it("selects cinematic game primitives without SaaS feature-card blueprint classes", () => {
        const plan = planWith("game", {
            composition: "cinematic tactical game topic with HUD match surface",
            surfaceStrategy: "mixed",
            heroPattern: "full bleed cinematic stage",
            sectionRhythm: ["match HUD", "media break", "tactical lane"],
            shapeLanguage: "angular tactical cuts",
            mediaStrategy: "cinematic key art and HUD overlays",
            uniqueMotifs: ["match HUD", "arena split", "loadout strip"],
            forbiddenPatterns: ["SaaS feature-card blueprint"],
        });

        const primitives = deriveLayoutPrimitives(plan);
        const styles = stylesFor(plan);

        expect(primitives).toEqual(
            expect.arrayContaining([
                "full-bleed-stage",
                "asymmetric-split",
                "media-break",
            ]),
        );
        expect(styles).toContain("full-bleed-stage");
        expect(styles).not.toContain("feature-card");
        expect(styles).not.toContain("page-copy");
    });

    it("selects dense operations primitives for contained dashboards without story-band as a primary layout", () => {
        const plan = planWith("dashboard", {
            composition: "high density operations dashboard",
            density: "high",
            surfaceStrategy: "contained",
            heroPattern: "compact command header",
            sectionRhythm: ["dense operations shell", "data region", "workflow lane"],
            mediaStrategy: "charts, tables, and status feeds",
            uniqueMotifs: ["operations region", "alert queue", "data grid"],
        });

        const primitives = deriveLayoutPrimitives(plan);
        const styles = stylesFor(plan);

        expect(primitives).toEqual(
            expect.arrayContaining([
                "dense-operations-shell",
                "data-region",
            ]),
        );
        expect(primitives).not.toContain("story-band");
        expect(styles).toContain("dense-operations-shell");
        expect(styles).toContain("--surface-fill: color-mix");
    });

    it("lets surfaceStrategy change generated surfaces and excludes forbidden primitive conflicts", () => {
        const open = planWith("editorial", {
            composition: "open editorial rail",
            surfaceStrategy: "open",
            heroPattern: "typography-led editorial cover",
            sectionRhythm: ["story band", "timeline"],
            forbiddenPatterns: ["timeline"],
        });
        const contained = planWith("editorial", {
            ...open.visualDNA,
            surfaceStrategy: "contained",
            forbiddenPatterns: [],
        });

        expect(deriveLayoutPrimitives(open)).not.toContain("timeline-flow");
        expect(stylesFor(open)).toContain("--surface-fill: transparent");
        expect(stylesFor(contained)).toContain("--surface-fill: color-mix");
        expect(stylesFor(open)).not.toEqual(stylesFor(contained));
    });
});
