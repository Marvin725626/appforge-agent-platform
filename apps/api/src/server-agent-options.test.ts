import type { PlannerOutput } from "@appforge/agent-core";
import { describe, expect, it } from "vitest";

import { createFallbackDesignPlan } from "./design-plan-utils.js";
import { createServerRunReactAppAgentOptions } from "./server-agent-options.js";

const PLANNER_OUTPUT: PlannerOutput = {
    summary: "Create a structured AppForge page.",
    steps: [
        {
            id: "plan",
            title: "Plan",
            description: "Plan the app.",
            acceptanceCriteria: ["A plan exists"],
        },
    ],
    pages: [
        {
            id: "home",
            path: "/",
            label: "Home",
            purpose: "Home page",
            acceptanceCriteria: ["Shows the topic"],
        },
    ],
};

describe("server agent options wrapper", () => {
    it("forwards DesignPlan from ExecuteRun input to runReactAppAgent options", () => {
        const designPlan = createFallbackDesignPlan({
            goal: "创建温州城市文化编辑页，不要卡片化",
            plannerOutput: PLANNER_OUTPUT,
            routes: PLANNER_OUTPUT.pages ?? [],
        });

        const options = createServerRunReactAppAgentOptions(
            {
                goal: "Create a page",
                currentRequest: "Shrink text",
                workspaceRoot: "E:/tmp/workspace",
                designPlan,
                resetWorkspace: false,
            },
            {
                templateRoot: "E:/tmp/template",
                baseUrl: "https://example.test/v1",
                apiKey: "test-key",
                model: "test-model",
                env: {
                    APPFORGE_PARALLEL_CODING: "false",
                    APPFORGE_LLM_STREAM: "false",
                },
            },
        );

        expect(options.designPlan).toEqual(designPlan);
        expect(options.currentRequest).toBe("Shrink text");
        expect(options.resetWorkspace).toBe(false);
        expect(options.parallelCoding).toBe(false);
        expect(options.llm.stream).toBe(false);
    });
});
