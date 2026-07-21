import { describe, expect, it } from "vitest";
import type { StablePageContent } from "./stable-page-content.js";
import { createStableAppSource, createStableCssSource } from "./stable-page-renderer.js";

const content: StablePageContent = {
  version: 1,
  applicationType: "custom",
  templateVariant: "adaptive-story",
  theme: { palette: "monochrome", fontPair: "system-modern", density: "comfortable" },
  brand: { name: "Industry Expo", kicker: "Live venue", title: "Industry Expo Venue Map", summary: "Expo halls, routes and exhibitor operations.", primaryAction: "Open map", secondaryAction: "View schedule", statusLabel: "OPEN" },
  hero: { imagePrompt: "expo", imageAlt: "expo", stats: [{ label: "Halls", value: "04" }, { label: "Booths", value: "120" }, { label: "Status", value: "OPEN" }] },
  sections: ["map", "data-table", "metrics", "timeline"].map((kind, index) => ({
    id: `section-${index + 1}`,
    kind: kind as StablePageContent["sections"][number]["kind"],
    eyebrow: `Section ${index + 1}`,
    title: `Section ${index + 1}`,
    description: "Structured information",
    items: [0, 1].map((item) => ({ title: `Item ${item}`, meta: "Meta", description: "Description", value: "42", status: "READY" })),
  })),
  footer: { statement: "Expo", links: ["Home", "Map"] },
};

describe("stable DesignPlan layout-family renderer", () => {
  it("emits a layout-family contract and removes application-type locked layout functions", () => {
    const source = createStableAppSource(content, { heroAlt: "expo" });
    expect(source).toContain("data-appforge-layout-family");
    expect(source).toContain("function DesignDrivenLayout");
    expect(source).toContain("function DashboardAdaptiveLayout");
    expect(source).not.toContain("function GameLayout");
  });

  it("emits structural primitive CSS", () => {
    const css = createStableCssSource(content);
    expect(css).toContain("--layout-family");
    expect(css).toContain("APPFORGE_PHASE4_LAYOUT_FAMILIES_V9");
    expect(css).toContain(".layout-editorial-rail");
    expect(css).toContain(".map-list-frame");
  });
});
