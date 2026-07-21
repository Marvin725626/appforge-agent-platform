import { describe, expect, it } from "vitest";

import type { DesignPlan } from "@appforge/protocol";

import { deriveStableLayoutFamily } from "./layout-family-policy.js";
import type { StablePageContent } from "./stable-page-content.js";

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
      summary: title,
      primaryAction: "Start",
      secondaryAction: "Read",
      statusLabel: "Live",
    },
    hero: { imagePrompt: title, imageAlt: title, stats: [{ label: "Status", value: "OK" }] },
    sections: [
      { id: "metrics", kind: "metrics", eyebrow: "Metrics", title: `${title} metrics`, description: title, items: [] },
      { id: "timeline", kind: "timeline", eyebrow: "Timeline", title: `${title} timeline`, description: title, items: [] },
      { id: "gallery", kind: "gallery", eyebrow: "Gallery", title: `${title} gallery`, description: title, items: [] },
    ],
    footer: { statement: title, links: ["Home"] },
  };
}

describe("V9.4.2.1 routing-contract compatibility hotfix", () => {
  it("accepts a partial DesignPlan without assuming unrelated nested objects exist", () => {
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

    expect(() => deriveStableLayoutFamily(
      content("product", "General Product Platform", "product-narrative"),
      designPlan,
    )).not.toThrow();

    const layout = deriveStableLayoutFamily(
      content("product", "General Product Platform", "product-narrative"),
      designPlan,
    );
    expect(layout.primaryPrimitive).toBe("asymmetric-media-break");
    expect(layout.heroMode).toBe("split");
    expect(layout.navigationMode).toBe("minimal");
  });

  it("keeps operations and infrastructure as separate dashboard contracts", () => {
    const operations = deriveStableLayoutFamily(content("dashboard", "Operations Work Queue Console", "sidebar-console"));
    const infrastructure = deriveStableLayoutFamily(content("dashboard", "Infrastructure Server Topology Monitor", "sidebar-console"));

    expect(operations.family).toBe("operations-console");
    expect(operations.primaryPrimitive).toBe("data-region");
    expect(infrastructure.family).toBe("infrastructure-topology");
    expect(infrastructure.primaryPrimitive).toBe("map-list-hybrid");
  });
});
