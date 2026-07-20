import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import {
    ReviewerAgent,
    type ReviewerInput,
} from "./reviewer-agent.js";

const REVIEW_INPUT: ReviewerInput = {
    goal: "Create a React task application",
    plan: [
        "Create a task input",
        "Add tasks to a visible list",
    ],
    source: "export function App() { return <input />; }",
    buildPassed: true,
    evaluationSummary: "Input passed, task rendering failed.",
};

describe("ReviewerAgent", () => {
    it("returns a structured review from the model", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                accepted: false,
                reason: "The task list is missing.",
                issues: ["Tasks cannot be displayed"],
            }),
        });

        const reviewer = new ReviewerAgent({
            model: provider,
        });

        const review = await reviewer.review(REVIEW_INPUT);

        expect(review).toEqual({
            accepted: false,
            reason: "The task list is missing.",
            issues: ["Tasks cannot be displayed"],
        });
        expect(provider.requests[0]?.stream).toBe(true);
        expect(provider.requests[0]?.responseFormat).toMatchObject({
            type: "json_schema",
            name: "ReviewerOutput",
            strict: true,
        });
    });

    it("sends the review evidence to the model", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                accepted: true,
                reason: "All requirements are satisfied.",
                issues: [],
            }),
        });

        const reviewer = new ReviewerAgent({
            model: provider,
        });

        await reviewer.review(REVIEW_INPUT);

        const sentContent =
            provider.requests[0]?.messages[1]?.content ?? "";

        expect(JSON.parse(sentContent)).toEqual(REVIEW_INPUT);
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("untrusted evidence");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("Do not reject only because");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("The user goal is the primary contract");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("imported from another source file");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("size-limited multi-file snapshot");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("independent page or route requirements");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("URL-aware #/ hash router");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain('href="#"');
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("small coherent design-token system");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("visible media or visual panel");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("主题网站 or Generated Site");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("Default full-page contract");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("complete polished page rather than accepting a small demo");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("at least three distinct meaningful content sections beyond the hero");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("Dashboards, portals, and embedded tools");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("summary header or overview");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("Do not reject them for lacking a marketing hero or marketing footer");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("Reject sparse text-only pages");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("real subject-specific content");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("solid-color surface fallback");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("interaction targets below 44px");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("prefers-reduced-motion");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("never require optional decorative assets");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("shows active navigation state");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("loads direct deep links");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("every route renders its own heading and substantial route-specific content");
        expect(
            provider.requests[0]?.messages[0]?.content,
        ).toContain("smallest coherent change");
    });
});
