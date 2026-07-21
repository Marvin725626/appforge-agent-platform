import { describe, expect, it } from "vitest";
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
    brand: { name: title, kicker: "Kicker", title, summary: title, primaryAction: "Start", secondaryAction: "Read", statusLabel: "Live" },
    hero: { imagePrompt: title, imageAlt: title, stats: [{ label: "Status", value: "OK" }] },
    sections: [
      { id: "metrics", kind: "metrics", eyebrow: "Metrics", title: `${title} metrics`, description: title, items: [] },
      { id: "story", kind: "story", eyebrow: "Story", title: `${title} story`, description: title, items: [] },
      { id: "timeline", kind: "timeline", eyebrow: "Timeline", title: `${title} timeline`, description: title, items: [] },
    ],
    footer: { statement: title, links: ["Home"] },
  };
}

describe("deriveStableLayoutFamily", () => {
  it("splits custom requirements into different layout families", () => {
    const families = [
      deriveStableLayoutFamily(content("custom", "Music Festival Event", "adaptive-story")).family,
      deriveStableLayoutFamily(content("custom", "Industry Expo Venue Map", "adaptive-story")).family,
      deriveStableLayoutFamily(content("custom", "Talent Recruitment Campaign", "adaptive-story")).family,
    ];
    expect(new Set(families).size).toBe(3);
  });

  it("selects semantic dashboard families instead of one fixed scaffold", () => {
    expect(deriveStableLayoutFamily(content("dashboard", "Infrastructure Operations Monitor", "sidebar-console")).family).toBe("operations-console");
    expect(deriveStableLayoutFamily(content("dashboard", "Clinical Incident Alert Command", "report-board")).family).toBe("incident-command");
    expect(deriveStableLayoutFamily(content("dashboard", "Growth Trend Analytics", "report-board")).family).toBe("trend-command");
  });

  it("returns a reusable primitive plan", () => {
    const plan = deriveStableLayoutFamily(content("portfolio", "Photographer Visual Portfolio", "case-study"));
    expect(plan.primitives.length).toBeGreaterThan(1);
    expect(plan.sectionOrder.length).toBeGreaterThan(2);
    expect(plan.family).toBe("gallery-portfolio");
  });
});
