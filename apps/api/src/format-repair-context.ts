import type {
    BrowserEvalResult,
    ReactAppEvalResult,
} from "@appforge/harness";
import type { ReactAppAgentReview } from "./review-react-app-agent.js";

export type FormatRepairContextInput = {
    build: {
        exitCode: number;
        stdout: string;
        stderr: string;
    };
    eval: ReactAppEvalResult;
    browserEval?: BrowserEvalResult;
    review: ReactAppAgentReview;
};

export function formatRepairContext(
    input:FormatRepairContextInput,
):string{
    return [
        "Repair request:",
        "Reviewer rejected the result.",
        `Build exit code: ${input.build.exitCode}`,
        `Eval passed: ${input.eval.passed ? "yes" : "no"}`,
        "Eval checks:",
        ...input.eval.checks.map(
            (check) =>
                `- ${check.name}: ${check.passed ? "passed" : "failed"}`,
        ),
        input.browserEval ? "Browser eval checks:" : "",
        ...(input.browserEval?.checks.map((check) =>
            [
                `- ${check.name}: ${check.passed ? "passed" : "failed"}`,
                check.message ? ` (${check.message})` : "",
            ].join(""),
        ) ?? []),
        `Reason: ${input.review.reason}`,
        input.build.stderr.length > 0
            ? `Build stderr:\n${input.build.stderr}`
            : "",
    ]
        .filter((line) => line.length > 0)
        .join("\n");
}
