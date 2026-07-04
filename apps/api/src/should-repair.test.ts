import { describe, expect, it } from "vitest";

import { shouldRepair } from "./should-repair.js";
import type { ReactAppAgentReview } from "./review-react-app-agent.js";

function createReview(accepted: boolean): ReactAppAgentReview {
    return {
        accepted,
        reason: accepted
            ? "Agent finished and install/build/eval passed."
            : "Rejected because eval failed.",
        checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: accepted,
        },
    };
}

describe("shouldRepair", () => {
    it("does not repair when the review is accepted", () => {
        expect(
            shouldRepair({
                review: createReview(true),
                repairAttempt: 0,
                maxRepairAttempts: 1,
            }),
        ).toBe(false);
    });

    it("repairs when the review is rejected and attempts remain", () => {
        expect(
            shouldRepair({
                review: createReview(false),
                repairAttempt: 0,
                maxRepairAttempts: 1,
            }),
        ).toBe(true);
    });

    it("does not repair when max attempts have been reached", () => {
        expect(
            shouldRepair({
                review: createReview(false),
                repairAttempt: 1,
                maxRepairAttempts: 1,
            }),
        ).toBe(false);
    });
});