import type { ReactAppAgentReview } from "./review-react-app-agent.js";

export type ShouldRepairInput = {
    review:ReactAppAgentReview;
    repairAttempt:number;
    maxRepairAttempts:number;
}

export function  shouldRepair(input:ShouldRepairInput):boolean{
    return(
      !input.review.accepted&&
      input.repairAttempt < input.maxRepairAttempts
    );
}