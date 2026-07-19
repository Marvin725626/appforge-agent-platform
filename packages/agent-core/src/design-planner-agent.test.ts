import { describe, expect, it } from "vitest";

import { DesignPlannerAgent } from "./design-planner-agent.js";
import { FakeModelProvider } from "./fake-model-provider.js";

describe("DesignPlannerAgent", () => {
    it("uses strict schema structured output and parses a design plan", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                version: 1,
                applicationType: "game",
                designIntent: {
                    audience: "Players",
                    primaryGoal: "Teach match strategy",
                    emotionalTone: ["focused"],
                    brandTraits: ["tactical"],
                },
                informationArchitecture: {
                    routes: [
                        {
                            path: "/",
                            purpose: "Overview",
                            primaryContent: ["HUD brief"],
                            primaryActions: ["Read tactics"],
                        },
                    ],
                },
                visualDNA: {
                    composition: "cinematic tactical HUD",
                    density: "high",
                    surfaceStrategy: "mixed",
                    navigationPattern: "compact top HUD",
                    heroPattern: "angled stage",
                    sectionRhythm: ["brief", "map", "timeline"],
                    typographyCharacter: "condensed tactical",
                    shapeLanguage: "angular",
                    mediaStrategy: "wide key art",
                    uniqueMotifs: ["spike timer"],
                    forbiddenPatterns: ["generic three-card grid"],
                },
                designTokens: {
                    colorRoles: {
                        background: "#16090a",
                        surface: "#071018",
                        foreground: "#f8fbff",
                        mutedForeground: "#c8d0da",
                        accent: "#ff4655",
                        accentForeground: "#16090a",
                    },
                    radiusScale: [0, 4, 8],
                    spacingScale: [4, 8, 16],
                },
                acceptanceCriteria: [
                    {
                        id: "DESIGN-1",
                        instruction: "Avoid generic card grids",
                        verification: "No repeated three-card feature grid",
                    },
                ],
            }),
        });

        const agent = new DesignPlannerAgent({ model: provider });
        const plan = await agent.createDesignPlan({
            goal: "Create a Valorant strategy page",
            currentRequirements: ["Avoid card grids"],
            pagePlan: "home page",
            forbiddenPatterns: ["generic three-card grid"],
        });

        expect(plan.visualDNA.heroPattern).toBe("angled stage");
        expect(provider.requests[0]?.stream).toBe(false);
        expect(provider.requests[0]?.responseFormat).toMatchObject({
            type: "json_schema",
            name: "DesignPlan",
            strict: true,
        });
    });
});
