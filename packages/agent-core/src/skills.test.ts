import { describe, expect, it } from "vitest";

import {
    formatSkillInstructions,
    reactViteAppSkill,
} from "./skills.js";

describe("reactViteAppSkill", () => {
    it("describes the React/Vite app generation skill", () => {
        expect(reactViteAppSkill.id).toBe("react-vite-app");
        expect(reactViteAppSkill.instructions).toContain(
            "Return only valid JSON actions.",
        );
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