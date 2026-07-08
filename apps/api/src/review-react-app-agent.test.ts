import { describe, expect, it } from "vitest";

import { reviewReactAppAgentResult } from "./review-react-app-agent.js";

describe("reviewReactAppAgentResult", () => {
    it("accepts a finished agent result with successful install, build, and eval", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: true,
            },
            install: {
                exitCode: 0,
            },
            build: {
                exitCode: 0,
            },
            eval: {
                passed: true,
            },
        });

        expect(review).toEqual({
            accepted: true,
            reason: "Agent finished and install/build/eval passed.",
            checks: {
                agentFinished: true,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
            },
        });
    });

    it("rejects a result when build fails", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: true,
            },
            install: {
                exitCode: 0,
            },
            build: {
                exitCode: 1,
            },
            eval: {
                passed: true,
            },
        });

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe("Rejected because npm build failed.");
        expect(review.checks.buildPassed).toBe(false);
    });

    it("rejects a result when eval fails", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: true,
            },
            install: {
                exitCode: 0,
            },
            build: {
                exitCode: 0,
            },
            eval: {
                passed: false,
            },
        });

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe("Rejected because eval failed.");
        expect(review.checks.evalPassed).toBe(false);
    });

    it("rejects a result when browser eval fails", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: true,
            },
            install: {
                exitCode: 0,
            },
            build: {
                exitCode: 0,
            },
            eval: {
                passed: true,
            },
            browserEval: {
                passed: false,
            },
        });

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe("Rejected because browser eval failed.");
        expect(review.checks.browserPassed).toBe(false);
    });
});
