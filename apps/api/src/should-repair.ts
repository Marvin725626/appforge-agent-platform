import {
    decideReviewDisposition,
    type ReactAppAgentReview,
} from "./review-react-app-agent.js";

export type ShouldRepairInput = {
    review:ReactAppAgentReview;
    repairAttempt:number;
    maxRepairAttempts:number;
    attemptMadeProgress?: boolean;
    attemptStopReason?:
        | "finish"
        | "finish_after_max_steps"
        | "action_failed"
        | "model_error"
        | "max_steps_reached";
}

export function  shouldRepair(input:ShouldRepairInput):boolean{
    // Do not repeat a request that failed before it changed the workspace.
    // When the model timed out after successful file/image actions, however,
    // one bounded repair is a continuation from that draft rather than a full
    // restart. This lets staged complex pages finish without entering an
    // unproductive retry loop.
    if (
        input.attemptStopReason === "model_error" &&
        !input.attemptMadeProgress
    ) {
        return false;
    }

    return decideReviewDisposition(input) === "auto_repair";
}
