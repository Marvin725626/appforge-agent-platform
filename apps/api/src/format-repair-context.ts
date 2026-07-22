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
    const isNoWorkspaceChangeFailure =
        input.review.reason.includes("Coding Agent did not change the workspace") ||
        input.review.reason.includes("without a file or image change") ||
        input.review.reason.includes("no file or image changed");

    return [
        "Repair request:",
        "Reviewer rejected the result.",
        "You must revise the current workspace to satisfy every reviewer issue below.",
        "Do not replace the app with an unrelated starter. Keep existing working features and make the smallest coherent fix.",
        isNoWorkspaceChangeFailure
            ? "No-change recovery constraints: the previous Coding Agent attempt produced zero user-visible file or image changes. Before returning finish, inspect the current source, choose the smallest target file(s), and perform at least one real edit_file, write_file, append_file, or get_image action that changes the workspace and directly addresses the newest user request."
            : "",
        isNoWorkspaceChangeFailure
            ? "Do not repeat a plan, explanation, or finish-only response. If an exact oldText edit is risky, re-read the file and use a narrower replacement from the current contents."
            : "",
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
