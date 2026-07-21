import { describe, expect, it } from "vitest";

import type { DesignPlan } from "@appforge/protocol";

import { deriveStableLayoutFamily } from "./layout-family-policy.js";
import type { StablePageContent } from "./stable-page-content.js";
import { createStableCssSource } from "./stable-page-renderer.js";

function content(
  applicationType: StablePageContent["applicationType"],
  title: string,
  variant: StablePageContent["templateVariant"],
): StablePageContent {
  return {
    version: 1,
    applicationType,
    templateVariant: variant,
    theme: { palette: "monochrome", fontPair: "system-modern", density: "comfortable" },
    brand: {
      name: title,
      kicker: "Kicker",
      title,
      summary: `${title} information and operations`,
      primaryAction: "Start",
      secondaryAction: "Read",
      statusLabel: "Live",
    },
    hero: {
      imagePrompt: title,
      imageAlt: title,
      stats: [{ label: "Status", value: "OK" }],
    },
    sections: [
      {
        id: "metrics",
        kind: "metrics",
        eyebrow: "Metrics",
        title: `${title} metrics`,
        description: title,
        items: [{ title: "Primary metric", meta: "Now", description: title, value: "42", status: "READY" }],
      },
      {
        id: "story",
        kind: "story",
        eyebrow: "Story",
        title: `${title} story`,
        description: title,
        items: [{ title: "Context", meta: "01", description: title, value: "", status: "" }],
      },
      {
        id: "timeline",
        kind: "timeline",
        eyebrow: "Timeline",
        title: `${title} timeline`,
        description: title,
        items: [{ title: "Step", meta: "Now", description: title, value: "", status: "ACTIVE" }],
      },
      {
        id: "gallery",
        kind: "gallery",
        eyebrow: "Gallery",
        title: `${title} gallery`,
        description: title,
        items: [{ title: "Frame", meta: "01", description: title, value: "", status: "" }],
      },
    ],
    footer: { statement: title, links: ["Home"] },
  };
}

describe("V9.3 residual layout-cluster separation", () => {
  it("separates tactical and orbital game intent even under one cinematic template variant", () => {
    const tactical = deriveStableLayoutFamily(content("game", "Tactical Operation Command", "cinematic-stage"));
    const orbital = deriveStableLayoutFamily(content("game", "Space Expedition Mission", "cinematic-stage"));

    expect(tactical.family).toBe("tactical-map");
    expect(orbital.family).toBe("orbital-expedition");
    expect(tactical.primaryPrimitive).not.toBe(orbital.primaryPrimitive);
  });

  it("separates database products from design-system catalogs", () => {
    const database = deriveStableLayoutFamily(content("product", "Cloud Database Query Platform", "product-narrative"));
    const designSystem = deriveStableLayoutFamily(content("product", "Design System Component Library", "product-narrative"));

    expect(database.family).toBe("data-product-map");
    expect(designSystem.family).toBe("design-system-catalog");
    expect(database.primaryPrimitive).not.toBe(designSystem.primaryPrimitive);
  });

  it("separates coffee provenance from outdoor field commerce", () => {
    const coffee = deriveStableLayoutFamily(content("commerce", "Coffee Roast Origin Journal", "brand-story"));
    const outdoor = deriveStableLayoutFamily(content("commerce", "Outdoor Hiking Field Collection", "brand-story"));

    expect(coffee.family).toBe("origin-journal");
    expect(outdoor.family).toBe("field-catalog");
    expect(coffee.primaryPrimitive).not.toBe(outdoor.primaryPrimitive);
  });

  it("keeps designer, photographer and engineer portfolios in different families", () => {
    const families = [
      deriveStableLayoutFamily(content("portfolio", "Product Designer Case Study", "case-study")).family,
      deriveStableLayoutFamily(content("portfolio", "Photographer Visual Portfolio", "case-study")).family,
      deriveStableLayoutFamily(content("portfolio", "Software Engineer Resume Experience", "resume-story")).family,
    ];

    expect(new Set(families).size).toBe(3);
  });

  it("separates infrastructure and clinical dashboard reading orders", () => {
    const infrastructure = deriveStableLayoutFamily(content("dashboard", "Infrastructure Server CPU Monitor", "sidebar-console"));
    const clinical = deriveStableLayoutFamily(content("dashboard", "Clinical Patient Incident Triage", "report-board"));

    expect(infrastructure.family).toBe("infrastructure-topology");
    expect(clinical.family).toBe("incident-command");
    expect(infrastructure.primaryPrimitive).toBe("map-list-hybrid");
    expect(clinical.primaryPrimitive).toBe("workflow-lane");
  });

  it("separates research institutions from public-service portals", () => {
    const research = deriveStableLayoutFamily(content("institution", "Laboratory Research Institute", "research-report"));
    const publicHealth = deriveStableLayoutFamily(content("institution", "Public Health Citizen Service", "institution-portal"));

    expect(research.family).toBe("research-institute");
    expect(publicHealth.family).toBe("public-service-portal");
    expect(research.primaryPrimitive).not.toBe(publicHealth.primaryPrimitive);
  });

  it("lets an explicit DesignPlan primitive override the fallback primitive", () => {
    const designPlan = {
      visualDNA: {
        composition: "asymmetric media break",
        heroPattern: "split editorial hero",
        navigationPattern: "minimal navigation",
        surfaceStrategy: "open",
        sectionRhythm: ["story", "timeline"],
        uniqueMotifs: ["media cut"],
      },
    } as unknown as DesignPlan;

    const layout = deriveStableLayoutFamily(
      content("product", "General Product Platform", "product-narrative"),
      designPlan,
    );

    expect(layout.primaryPrimitive).toBe("asymmetric-media-break");
    expect(layout.heroMode).toBe("split");
    expect(layout.navigationMode).toBe("minimal");
  });

  it("emits the V9.3 family-specific silhouette CSS", () => {
    const css = createStableCssSource(content("game", "Space Expedition Mission", "cinematic-stage"));

    expect(css).toContain("APPFORGE_PHASE4_LAYOUT_FAMILIES_V9_3");
    expect(css).toContain(".layout-family--orbital-expedition");
    expect(css).toContain(".layout-family--design-system-catalog");
    expect(css).toContain(".layout-family--incident-command");
  });
});
