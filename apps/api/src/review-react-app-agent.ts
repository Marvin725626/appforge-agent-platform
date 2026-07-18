import type { ReviewerOutput } from "@appforge/agent-core";

export type ReactAppAgentReview = {
    accepted: boolean;
    reason: string;
    checks: {
        agentFinished: boolean;
        installPassed: boolean;
        buildPassed: boolean;
        evalPassed: boolean;
        browserPassed?: boolean;
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
        !review.checks.evalPassed
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

        if (isBrowserEvalOnlyReviewRejection(llmReview)) {
            return {
                ...deterministicReview,
                accepted: true,
                reason:
                    "LLM reviewer only found non-blocking browser/contrast warnings. The generated app passed install/build/static eval, so the review was accepted and the browser issue was kept as a warning.",
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
    };
    build: {
        exitCode: number;
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
        ? `browser eval failed (${failedChecks.join("; ")})`
        : "browser eval failed";
}

export function reviewReactAppAgentResult(
    input: ReviewReactAppAgentInput,
): ReactAppAgentReview {
    const installPassed = input.install.exitCode === 0;
    const buildPassed = input.build.exitCode === 0;
    const evalPassed = input.eval.passed;
    const browserPassed = input.browserEval?.passed;
    const browserWarning = formatBrowserEvalFailure(input);
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

    if (browserPassed !== undefined) {
        checks.browserPassed = browserPassed;
    }

    const qualityFailures = [
        checks.agentFinished ? "" : "agent did not finish",
        checks.installPassed ? "" : "npm install failed",
        checks.buildPassed ? "" : "npm build failed",
        checks.evalPassed ? "":"eval failed",
    ].filter((failure) => failure.length > 0);

    const accepted = qualityFailures.length === 0;
    const acceptedBrowserWarning =
        accepted && browserWarning.length > 0
            ? ` Browser eval warning was recorded but is non-blocking: ${browserWarning}.`
            : "";
    const reason = accepted
        ? deterministicallyCompletedAfterModelError
            ? `The model timed out after making workspace progress, but install/build/static eval passed.${acceptedBrowserWarning}`
            : deterministicallyCompletedAfterLateActionFailure
              ? `The agent hit a late action failure after changing the workspace, but install/build/static eval passed.${acceptedBrowserWarning}`
              : deterministicallyCompletedAfterValidatedProgress
                ? `The agent stopped after making workspace progress, but install/build/static eval passed.${acceptedBrowserWarning}`
            : `Agent finished and install/build/static eval passed.${acceptedBrowserWarning}`
        : `Rejected because ${qualityFailures.join(", ")}.`;

    return {
        accepted,
        reason,
        checks,
    };
}
