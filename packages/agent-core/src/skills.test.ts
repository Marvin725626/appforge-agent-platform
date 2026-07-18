import { describe, expect, it } from "vitest";

import {
    formatSkillInstructions,
    reactViteAppSkill,
    visualDesignSkill,
} from "./skills.js";

describe("reactViteAppSkill", () => {
    it("describes the React/Vite app generation skill", () => {
        expect(reactViteAppSkill.id).toBe("react-vite-app");
        expect(reactViteAppSkill.instructions).toContain(
            "Return only valid JSON actions.",
        );
        const prompt = reactViteAppSkill.instructions.join(" ");
        expect(prompt).toContain("complete polished page by default");
        expect(prompt).toContain("at least three distinct meaningful content sections");
        expect(prompt).toContain("Dashboards, portals, and embedded tools");
        expect(prompt).toContain("summary header or overview");
        expect(prompt).toContain("at least three meaningful functional modules");
        expect(prompt).toContain("do not force a marketing hero or marketing footer");
        expect(prompt).toContain("never lorem ipsum");
        expect(prompt).toContain("information architecture and route map");
        expect(prompt).toContain("small coherent CSS design-token system");
        expect(prompt).toContain("solid-color surface fallback");
        expect(prompt).toContain("at least 44px interaction targets");
        expect(prompt).toContain("prefers-reduced-motion");
        expect(prompt).toContain("do not invent optional decorative assets");
        expect(prompt).toContain("active navigation state");
        expect(prompt).toContain("direct deep-link loading");
        expect(prompt).toContain("substantial route-specific content");
        expect(prompt).toContain("smallest coherent change");
        expect(prompt).toContain("Before returning finish, self-check");
        expect(prompt).toContain("product-appropriate complete-page or app-shell structure");
        expect(prompt).toContain("existence of src/App.tsx alone is not completion");
    });
});

describe("formatSkillInstructions", () => {
    it("formats a skill as prompt instructions", () => {
        const result = formatSkillInstructions({
            id: "test-skill",
            name: "Test Skill",
            description: "Use this skill in tests.",
            instructions: [
                "Do the first thing.",
                "Do the second thing.",
            ],
        });

        expect(result).toBe(
            [
                "Skill: Test Skill",
                "Use this skill in tests.",
                "",
                "Instructions:",
                "- Do the first thing.",
                "- Do the second thing.",
            ].join("\n"),
        );
    });
});

describe("visualDesignSkill", () => {
    it("describes anti-template visual design rules", () => {
        expect(visualDesignSkill.id).toBe("visual-design-system");
        const prompt = visualDesignSkill.instructions.join(" ");
        expect(prompt).toContain("subject's visual identity");
        expect(prompt).toContain("same block/card template");
        expect(prompt).toContain("For games and esports");
        expect(prompt).toContain("Avoid stacks of isolated rounded boxes");
        expect(prompt).toContain("headings must fit their container");
        expect(prompt).toContain("official or existing brand assets");
    });
});
