import type {
    BrowserEvalResult,
    ReactAppEvalResult,
} from "@appforge/harness";
import type { ReactAppAgentReview } from "./review-react-app-agent.js";

export type RepairCommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

export type FormatRepairContextInput = {
    build: RepairCommandResult;
    typecheck?: RepairCommandResult;
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
        input.typecheck
            ? `Typecheck exit code: ${input.typecheck.exitCode}`
            : "",
        input.typecheck && input.typecheck.exitCode !== 0
            ? "Typecheck repair constraints: fix the exact compiler diagnostics with the smallest source edit. Do not regenerate images, rewrite unrelated files, or redesign the page. Prefer one edit_file action in the reported TypeScript source or its directly imported local data module."
            : "",
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
            ? `Relevant source near compiler error:\n${input.sourceExcerpt}`
            : "",
        input.typecheck && input.typecheck.exitCode !== 0
            ? `Typecheck diagnostics:\n${[
                  input.typecheck.stderr.trim(),
                  input.typecheck.stdout.trim(),
              ]
                  .filter((part) => part.length > 0)
                  .join("\n")}`
            : "",
        input.build.stderr.length > 0
            ? `Build stderr:\n${input.build.stderr}`
            : input.build.exitCode !== 0 && input.build.stdout.length > 0
              ? `Build stdout:\n${input.build.stdout}`
              : "",
    ]
        .filter((line) => line.length > 0)
        .join("\n");
}
