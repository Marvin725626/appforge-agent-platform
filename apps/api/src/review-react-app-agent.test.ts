import { describe, expect, it } from "vitest";

import {
    combineReactAppAgentReviews,
    decideReviewDisposition,
    normalizeStepLimitOnlyReview,
    reviewReactAppAgentResult,
} from "./review-react-app-agent.js";

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
            reason: "Agent finished and install/build/static eval passed.",
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

    it("rejects a quality-passing result when the agent omitted finish", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: false,
                stopReason: "max_steps_reached",
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

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe("Rejected because agent did not finish.");
        expect(review.checks.agentFinished).toBe(false);
    });

    it("accepts a progressed model-timeout result when deterministic validation passes", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: false,
                madeProgress: true,
                stopReason: "model_error",
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
                passed: true,
            },
        });

        expect(review.accepted).toBe(true);
        expect(review.checks.agentFinished).toBe(true);
        expect(review.reason).toContain("model timed out");
        expect(review.reason).toContain("static eval passed");
    });

    it("does not accept a model-timeout result that made no workspace progress", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: false,
                madeProgress: false,
                stopReason: "model_error",
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
                passed: true,
            },
        });

        expect(review.accepted).toBe(false);
        expect(review.checks.agentFinished).toBe(false);
    });

    it("accepts a late action failure when the changed draft passes static validation", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: false,
                madeProgress: true,
                stopReason: "action_failed",
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
                passed: true,
            },
        });

        expect(review.accepted).toBe(true);
        expect(review.checks.agentFinished).toBe(true);
        expect(review.reason).toContain("late action failure");
        expect(review.reason).toContain("static eval passed");
    });

    it("accepts an action failure without browser validation evidence when static validation passes", () => {
        const review = reviewReactAppAgentResult({
            agent: {
                finished: false,
                madeProgress: true,
                stopReason: "action_failed",
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

        expect(review.accepted).toBe(true);
        expect(review.checks.agentFinished).toBe(true);
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

    it("accepts browser eval failures as non-blocking warnings", () => {
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

        expect(review.accepted).toBe(true);
        expect(review.reason).toContain("Browser eval warning");
        expect(review.checks.browserPassed).toBe(false);
    });
});

describe("combineReactAppAgentReviews", () => {
    it("rejects a deterministic success when the LLM reviewer finds issues", () => {
        const deterministicReview = reviewReactAppAgentResult({
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

        const review = combineReactAppAgentReviews(deterministicReview, {
            accepted: false,
            reason: "The requested task list is missing.",
            issues: ["No task list is rendered"],
        });

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe(
            "LLM reviewer rejected: The requested task list is missing. Issues: No task list is rendered",
        );
    });

    it("accepts when the LLM reviewer only rejects a generated image extension mismatch", () => {
        const deterministicReview = reviewReactAppAgentResult({
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
                passed: true,
            },
        });

        const review = combineReactAppAgentReviews(deterministicReview, {
            accepted: false,
            reason:
                "Logo asset was saved as JPG instead of the PNG path requested in the implementation plan.",
            issues: [
                "Logo素材未按要求保存为PNG格式，实际生成的是JPG文件，保存路径为public/assets/tsinghua-logo-blue.jpg。",
                "代码中Logo引用路径为/assets/tsinghua-logo-blue.jpg，不符合计划要求的/assets/tsinghua-logo-blue.png。",
            ],
        });

        expect(review.accepted).toBe(true);
        expect(review.reason).toContain(
            "image file extension/media-type mismatch",
        );
    });

    it("still rejects image work when the LLM reviewer finds a missing image", () => {
        const deterministicReview = reviewReactAppAgentResult({
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

        const review = combineReactAppAgentReviews(deterministicReview, {
            accepted: false,
            reason: "The logo image is missing and not visible.",
            issues: ["No visible logo image is rendered"],
        });

        expect(review.accepted).toBe(false);
    });

    it("accepts when the LLM reviewer only rejects non-blocking browser contrast warnings", () => {
        const deterministicReview = reviewReactAppAgentResult({
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

        const review = combineReactAppAgentReviews(deterministicReview, {
            accepted: false,
            reason:
                "Browser contrast warning: Low-contrast visible text detected.",
            issues: ["Visible text needs 4.5:1 contrast"],
        });

        expect(review.accepted).toBe(true);
        expect(review.reason).toContain("non-blocking browser/contrast");
    });
});

describe("normalizeStepLimitOnlyReview", () => {
    it("keeps old missing-finish reviews rejected without full result evidence", () => {
        const review = normalizeStepLimitOnlyReview({
            accepted: false,
            reason: "Rejected because agent did not finish.",
            checks: {
                agentFinished: false,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
                browserPassed: true,
            },
        });

        expect(review.accepted).toBe(false);
        expect(review.reason).toBe("Rejected because agent did not finish.");
    });
});

describe("decideReviewDisposition", () => {
    it("accepts an accepted review", () => {
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

        expect(
            decideReviewDisposition({
                review,
                repairAttempt: 0,
                maxRepairAttempts: 1,
            }),
        ).toBe("accepted");
    });

    it("auto repairs quality failures while repair attempts remain", () => {
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

        expect(
            decideReviewDisposition({
                review,
                repairAttempt: 0,
                maxRepairAttempts: 1,
            }),
        ).toBe("auto_repair");
    });

    it("stops for human review when quality failures exhaust repair attempts", () => {
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

        expect(
            decideReviewDisposition({
                review,
                repairAttempt: 1,
                maxRepairAttempts: 1,
            }),
        ).toBe("human_review");
    });

    it("stops for human review when only the LLM reviewer rejects", () => {
        const deterministicReview = reviewReactAppAgentResult({
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
        const review = combineReactAppAgentReviews(deterministicReview, {
            accepted: false,
            reason: "The layout could be closer to the requested reference.",
            issues: ["Visual style mismatch"],
        });

        expect(
            decideReviewDisposition({
                review,
                repairAttempt: 0,
                maxRepairAttempts: 2,
            }),
        ).toBe("human_review");
    });
});
