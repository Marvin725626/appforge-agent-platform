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
    sourceExcerpt?: string;
};

export function formatRepairContext(
    input:FormatRepairContextInput,
):string{
    return [
        "Repair request:",
        "Reviewer rejected the result.",
        "You must revise the current workspace to satisfy every reviewer issue below.",
        "Do not replace the app with an unrelated starter. Keep existing working features and make the smallest coherent fix.",
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
        "Reviewer issues to fix:",
        `- ${input.review.reason}`,
        input.sourceExcerpt && input.sourceExcerpt.length > 0
            ? `Relevant source near build error:\n${input.sourceExcerpt}`
            : "",
        input.build.stderr.length > 0
            ? `Build stderr:\n${input.build.stderr}`
            : "",
    ]
        .filter((line) => line.length > 0)
        .join("\n");
}
