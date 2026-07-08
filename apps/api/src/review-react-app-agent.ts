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

export type ReviewReactAppAgentInput = {
    agent: {
        finished: boolean;
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
    };
};

export function reviewReactAppAgentResult(
    input: ReviewReactAppAgentInput,
): ReactAppAgentReview {
    const checks: ReactAppAgentReview["checks"] = {
        agentFinished: input.agent.finished,
        installPassed: input.install.exitCode === 0,
        buildPassed: input.build.exitCode === 0,
        evalPassed:input.eval.passed,
    };

    const browserPassed = input.browserEval?.passed;

    if (browserPassed !== undefined) {
        checks.browserPassed = browserPassed;
    }

    const failures = [
        checks.agentFinished ? "" : "agent did not finish",
        checks.installPassed ? "" : "npm install failed",
        checks.buildPassed ? "" : "npm build failed",
        checks.evalPassed ? "":"eval failed",
        browserPassed === false ? "browser eval failed" : "",
    ].filter((failure) => failure.length > 0);

    return {
        accepted: failures.length === 0,
        reason:
            failures.length === 0
                ? "Agent finished and install/build/eval passed."
                : `Rejected because ${failures.join(", ")}.`,
        checks,
    };
}
