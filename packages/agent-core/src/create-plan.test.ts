import { describe, expect, it } from "vitest";

import { createPlan } from "./create-plan.js";
import { FakeModelProvider } from "./fake-model-provider.js";

describe("createPlan", () => {
    it("returns the plan from the provider", async () => {
        const provider = new FakeModelProvider({
            content: "1. Create UI\n2. Add task state",
        });

        const plan = await createPlan(
            provider,
            "Create a task application",
        );

        expect(plan).toBe("1. Create UI\n2. Add task state");
    });

    it("sends system instructions and the user goal", async () => {
        const provider = new FakeModelProvider({
            content: "A plan",
        });

        await createPlan(provider, "Create a task application");

        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0]?.messages).toEqual([
            {
                role: "system",
                content:
                    "You are a coding agent. Create a short implementation plan.",
            },
            {
                role: "user",
                content: "Create a task application",
            },
        ]);
    });
});