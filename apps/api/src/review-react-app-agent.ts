import type { ReviewerOutput } from "@appforge/agent-core";

export type ReactAppAgentReview = {
    accepted: boolean;
    reason: string;
    checks: {
        agentFinished: boolean;
        installPassed: boolean;
        buildPassed: boolean;
        typecheckPassed?: boolean;
        evalPassed: boolean;
        browserPassed?: boolean;
        browserVisualOnly?: boolean;
        antiTemplateLevel?: "pass" | "warning" | "severe";
        antiTemplateWarning?: boolean;
        antiTemplateBlocking?: boolean;
    };
};

export type ReviewDisposition = "accepted" | "auto_repair" | "human_review";

export function hasReviewQualityFailure(
    review: ReactAppAgentReview,
): boolean {
    return (
        !review.checks.agentFinished ||
        !review.checks.installPassed ||
        !review.checks.buildPassed ||
        review.checks.typecheckPassed === false ||
        !review.checks.evalPassed ||
        (review.checks.browserPassed === false &&
            review.checks.browserVisualOnly !== true) ||
        review.checks.antiTemplateBlocking === true
    );
}

export function decideReviewDisposition(input: {
    review: ReactAppAgentReview;
    repairAttempt: number;
    maxRepairAttempts: number;
}): ReviewDisposition {
    if (input.review.accepted) {
        return "accepted";
    }

    if (
        hasReviewQualityFailure(input.review) &&
        input.repairAttempt < input.maxRepairAttempts
    ) {
        return "auto_repair";
    }

    return "human_review";
}

export function combineReactAppAgentReviews(
    deterministicReview: ReactAppAgentReview,
    llmReview: ReviewerOutput,
): ReactAppAgentReview {
    if (!deterministicReview.accepted) {
        return deterministicReview;
    }

    if (!llmReview.accepted) {
        if (isImageFormatOnlyReviewRejection(llmReview)) {
            return {
                ...deterministicReview,
                accepted: true,
                reason:
                    "LLM reviewer only found an image file extension/media-type mismatch. The generated app passed install/build/eval, so the review was accepted because image assets are saved using their actual media type.",
            };
        }

        const issueDetails =
            llmReview.issues.length > 0
                ? ` Issues: ${llmReview.issues.join("; ")}`
                : "";

        return {
            ...deterministicReview,
            accepted: false,
            reason: `LLM reviewer rejected: ${llmReview.reason}${issueDetails}`,
        };
    }

    return deterministicReview;
}

function isBrowserEvalOnlyReviewRejection(
    llmReview: ReviewerOutput,
): boolean {
    const text = [
        llmReview.reason,
        ...llmReview.issues,
    ]
        .join(" ")
        .toLowerCase();

    const mentionsBrowserWarning =
        /browser|contrast|low[-\s]?contrast|visible text|wcag|4\.5|3:1|对比|看不清|看不见|不可见/u.test(
            text,
        );
    const mentionsFunctionalFailure =
        /missing|broken|not rendered|does not render|cannot run|build|compile|runtime|syntax|route|navigation|button|click|link|crash|empty|placeholder|缂哄け|鏃犳硶|缺失|损坏|崩溃|空白|占位|跳转|导航/u.test(
            text,
        );

    return mentionsBrowserWarning && !mentionsFunctionalFailure;
}

function isImageFormatOnlyReviewRejection(
    llmReview: ReviewerOutput,
): boolean {
    const text = [
        llmReview.reason,
        ...llmReview.issues,
    ]
        .join(" ")
        .toLowerCase();

    const mentionsImageAsset =
        /image|asset|logo|picture|图片|图像|素材|校徽|徽标|logo/u.test(text);
    const mentionsExtensionMismatch =
        /png/u.test(text) &&
        /jpe?g|jpg/u.test(text) &&
        /path|extension|format|media|路径|格式|扩展名|文件名/u.test(text);
    const mentionsFunctionalFailure =
        /missing|broken|not visible|cannot load|inaccessible|unrelated|缺失|无法加载|不可访问|不显示|无关|损坏/u.test(text);

    return (
        mentionsImageAsset &&
        mentionsExtensionMismatch &&
        !mentionsFunctionalFailure
    );
}

export function normalizeStepLimitOnlyReview(
    review: ReactAppAgentReview,
): ReactAppAgentReview {
    return review;
}

export type ReviewReactAppAgentInput = {
    agent: {
        finished: boolean;
        madeProgress?: boolean;
        stopReason?:
            | "finish"
            | "finish_after_max_steps"
            | "action_failed"
            | "model_error"
            | "max_steps_reached";
    };
    install: {
        exitCode: number;
        stdout?: string;
        stderr?: string;
    };
    build: {
        exitCode: number;
        stdout?: string;
        stderr?: string;
    };
    typecheck?: {
        exitCode: number;
        stdout?: string;
        stderr?: string;
    };
    eval:{
        passed:boolean;
    };
    browserEval?: {
        passed: boolean;
        checks?: Array<{
            name: string;
            passed: boolean;
            message?: string;
        }>;
    };
};

function isAdvisoryVisualBrowserCheckName(name: string): boolean {
    if (
        name.startsWith("visual quality:") &&
        (name.includes("has no page horizontal overflow") ||
            name.includes("has no critical element overlap") ||
            name.includes("keeps key content inside the viewport") ||
            name.includes("interactive controls have usable targets"))
    ) {
        return false;
    }

    return (
        name.startsWith("visual contract: dashboard ") ||
        name.startsWith("visual quality:")
    );
}

function hasOnlyAdvisoryVisualBrowserFailures(
    browserEval: ReviewReactAppAgentInput["browserEval"],
): boolean {
    if (browserEval?.passed !== false) {
        return false;
    }

    const failedChecks = browserEval.checks?.filter((check) => !check.passed) ?? [];

    return (
        failedChecks.length > 0 &&
        failedChecks.every((check) =>
            isAdvisoryVisualBrowserCheckName(check.name),
        )
    );
}

function formatBrowserEvalFailure(input: ReviewReactAppAgentInput): string {
    if (input.browserEval?.passed !== false) {
        return "";
    }

    const failedChecks =
        input.browserEval.checks
            ?.filter((check) => !check.passed)
            .slice(0, 3)
            .map((check) => {
                const message = check.message?.trim();

                return message && message.length > 0
                    ? `${check.name}: ${message}`
                    : check.name;
            }) ?? [];

    return failedChecks.length > 0
        ? `browser runtime validation failed (${failedChecks.join("; ")})`
        : "browser runtime validation failed";
}

function formatBrowserRuntimeFailureReason(
    input: ReviewReactAppAgentInput,
): string {
    const browserFailure = formatBrowserEvalFailure(input);

    if (browserFailure.length === 0) {
        return "";
    }

    const rootCheck = input.browserEval?.checks?.find(
        (check) => check.name === "application root renders",
    );
    const visibleCheck = input.browserEval?.checks?.find(
        (check) => check.name === "has visible main content",
    );
    const runtimeCheck = input.browserEval?.checks?.find(
        (check) => check.name === "has no runtime errors",
    );

    return [
        "页面构建成功，但浏览器运行验证失败。",
        browserFailure,
        rootCheck
            ? `root: ${rootCheck.passed ? "passed" : "failed"}${
                  rootCheck.message ? ` (${rootCheck.message})` : ""
              }`
            : "root: unavailable",
        visibleCheck
            ? `visible content: ${visibleCheck.passed ? "passed" : "failed"}${
                  visibleCheck.message ? ` (${visibleCheck.message})` : ""
              }`
            : "visible content: unavailable",
        runtimeCheck?.message
            ? `runtime console errors: ${runtimeCheck.message}`
            : "runtime console errors: none reported",
    ].join(" ");
}

function formatCommandFailureDetail(command: {
    stdout?: string;
    stderr?: string;
}): string {
    const detail = [command.stderr?.trim() ?? "", command.stdout?.trim() ?? ""]
        .filter((part) => part.length > 0)
        .join("\n")
        .replace(/\s+/gu, " ")
        .slice(0, 800)
        .trim();

    return detail.length > 0 ? ` (${detail})` : "";
}

export function reviewReactAppAgentResult(
    input: ReviewReactAppAgentInput,
): ReactAppAgentReview {
    const installPassed = input.install.exitCode === 0;
    const buildPassed = input.build.exitCode === 0;
    const typecheckPassed = input.typecheck
        ? input.typecheck.exitCode === 0
        : undefined;
    const evalPassed = input.eval.passed;
    const browserPassed = input.browserEval?.passed;
    const browserVisualOnly = hasOnlyAdvisoryVisualBrowserFailures(
        input.browserEval,
    );
    const deterministicallyCompletedAfterModelError =
        input.agent.stopReason === "model_error" &&
        input.agent.madeProgress === true &&
        installPassed &&
        buildPassed &&
        evalPassed;
    const deterministicallyCompletedAfterLateActionFailure =
        input.agent.stopReason === "action_failed" &&
        input.agent.madeProgress === true &&
        installPassed &&
        buildPassed &&
        evalPassed;
    const deterministicallyCompletedAfterValidatedProgress =
        input.agent.madeProgress === true &&
        installPassed &&
        buildPassed &&
        evalPassed &&
        (input.agent.stopReason === "action_failed" ||
            input.agent.stopReason === "max_steps_reached" ||
            input.agent.stopReason === "finish_after_max_steps");
    const checks: ReactAppAgentReview["checks"] = {
        agentFinished:
            input.agent.finished ||
            deterministicallyCompletedAfterModelError ||
            deterministicallyCompletedAfterLateActionFailure ||
            deterministicallyCompletedAfterValidatedProgress,
        installPassed,
        buildPassed,
        evalPassed,
    };

    if (typecheckPassed !== undefined) {
        checks.typecheckPassed = typecheckPassed;
    }

    if (browserPassed !== undefined) {
        checks.browserPassed = browserPassed;
    }
    if (browserVisualOnly) {
        checks.browserVisualOnly = true;
    }

    const qualityFailures = [
        checks.agentFinished ? "" : "agent did not finish",
        checks.installPassed
            ? ""
            : `npm install failed${formatCommandFailureDetail(input.install)}`,
        checks.buildPassed
            ? ""
            : `npm build failed${formatCommandFailureDetail(input.build)}`,
        checks.typecheckPassed === false
            ? `typecheck failed${
                  input.typecheck
                      ? formatCommandFailureDetail(input.typecheck)
                      : ""
              }`
            : "",
        checks.evalPassed ? "":"eval failed",
        checks.browserPassed === false
            ? formatBrowserRuntimeFailureReason(input)
            : "",
    ].filter((failure) => failure.length > 0);

    const accepted = qualityFailures.length === 0;
    const successfulValidationSummary =
        browserPassed === true
            ? "install/build/static eval passed and browser runtime checks passed"
            : "install/build/static eval passed";
    const reason = accepted
        ? deterministicallyCompletedAfterModelError
            ? `The model timed out after making workspace progress, but ${successfulValidationSummary}.`
            : deterministicallyCompletedAfterLateActionFailure
              ? `The agent hit a late action failure after changing the workspace, but ${successfulValidationSummary}.`
              : deterministicallyCompletedAfterValidatedProgress
                ? `The agent stopped after making workspace progress, but ${successfulValidationSummary}.`
            : `Agent finished and ${successfulValidationSummary}.`
        : `Rejected because ${qualityFailures.join(", ")}.`;

    return {
        accepted,
        reason,
        checks,
    };
}
