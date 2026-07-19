import {
    DesignPlanSchema,
    type DesignPlan,
} from "@appforge/protocol";

import type { ModelProvider } from "./model-provider.js";
import { completeStructuredOutput } from "./complete-structured-output.js";

export type DesignPlannerInput = {
    goal: string;
    currentRequirements: string[];
    pagePlan: string;
    topicEvidence?: string;
    forbiddenPatterns: string[];
    historicalContext?: string;
};

export type DesignPlannerAgentOptions = {
    model: ModelProvider;
};

export class DesignPlannerAgent {
    constructor(private readonly options: DesignPlannerAgentOptions) {}

    async createDesignPlan(input: DesignPlannerInput): Promise<DesignPlan> {
        return completeStructuredOutput({
            model: this.options.model,
            request: {
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are AppForge's Design Planner.",
                            "Return exactly one JSON object and no markdown.",
                            "The object must satisfy the DesignPlan v1 schema.",
                            "Use this shape:",
                            '{"version":1,"applicationType":"editorial|institution|dashboard|commerce|product|portfolio|game|custom","designIntent":{"audience":"...","primaryGoal":"...","emotionalTone":["..."],"brandTraits":["..."]},"informationArchitecture":{"routes":[{"path":"/","purpose":"...","primaryContent":["..."],"primaryActions":["..."]}]},"visualDNA":{"composition":"...","density":"low|medium|high","surfaceStrategy":"open|mixed|contained","navigationPattern":"...","heroPattern":"...","sectionRhythm":["..."],"typographyCharacter":"...","shapeLanguage":"...","mediaStrategy":"...","uniqueMotifs":["..."],"forbiddenPatterns":["..."]},"designTokens":{"colorRoles":{"background":"#...","surface":"#...","foreground":"#...","mutedForeground":"#...","accent":"#...","accentForeground":"#..."},"radiusScale":[0,4,8],"spacingScale":[4,8,16]},"acceptanceCriteria":[{"id":"DESIGN-1","instruction":"...","verification":"..."}]}',
                            "DesignPlan expresses design decisions, not CSS class names, complete CSS, or fixed component templates.",
                            "Never choose a complete layout only from six fixed templates. Generate a subject-specific composition, surface strategy, rhythm, motifs, and forbidden patterns from the user's goal and evidence.",
                            "Current user requirements outrank historical goals and general design guidelines.",
                            "If the user forbids a pattern such as cards, rounded cards, SaaS style, blue background, or generic grids, preserve it in visualDNA.forbiddenPatterns and acceptanceCriteria.",
                            "For city/culture/editorial goals, prefer magazine rhythm, map/list hybrids, routes, timelines, local texture, and open or mixed surfaces unless the user asks otherwise.",
                            "For game/esports goals, prefer cinematic composition, angular shape language, HUD-like motifs, tactical rails, and forbid generic SaaS feature cards.",
                            "For dashboards, plan density, operational navigation, metrics, status, tables, charts, filters, and contained data regions.",
                            "For SaaS/product, plan workflow surfaces, product screens, feature strips, proof rows, and conversion areas without forcing every section into cards.",
                            "Use accessible color roles with readable foreground/background pairs.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content: JSON.stringify(input, null, 2),
                    },
                ],
            },
            parse: (text) =>
                DesignPlanSchema.parse(JSON.parse(text) as unknown),
            outputName: "DesignPlan",
        });
    }
}
