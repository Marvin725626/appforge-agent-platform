import {
    OpenAICompatibleProvider,
    type OpenAICompatibleProviderOptions,
    runCodingAgentLoop,
    type RunCodingAgentLoopResult,
    type ModelProvider,
    coordinateAgents,
    formatCoordinationContext,
    formatSkillInstructions,
    reactViteAppSkill,
    type CoordinateAgentsResult,
} from "@appforge/agent-core";
import {
    copyWorkspaceTemplate,
    runWorkspaceCommand,
} from "@appforge/workspace";

import {
    reviewReactAppAgentResult,
    type ReactAppAgentReview,
} from "./review-react-app-agent.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
    evaluateReactApp,
    type ReactAppEvalResult,
} from "@appforge/harness";
import { formatRepairContext } from "./format-repair-context.js";
import { shouldRepair } from "./should-repair.js";
import type { TraceEvent } from "@appforge/protocol";

export type RunReactAppAgentOptions = {
    goal: string;
    workspaceRoot: string;
    templateRoot: string;
    llm: {
        baseUrl: string;
        apiKey: string;
        model: string;
        timeoutMs?: number;
    };
    model?: ModelProvider;
    maxRepairAttempts?: number;
    memoryContext?:string;
};

export type RunReactAppAgentCommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

export type RunReactAppAgentAttempt = {
    kind: "initial" | "repair";
    agent: RunCodingAgentLoopResult;
    install: RunReactAppAgentCommandResult;
    build: RunReactAppAgentCommandResult;
    eval: ReactAppEvalResult;
    review: ReactAppAgentReview;
};

export type RunReactAppAgentResult = {
    workspaceRoot:string;
    coordination: CoordinateAgentsResult;
    agent: RunCodingAgentLoopResult;
    install: RunReactAppAgentCommandResult;
    build: RunReactAppAgentCommandResult;
    eval:ReactAppEvalResult;
    review: ReactAppAgentReview;
    attempts: RunReactAppAgentAttempt[];
    trace?: TraceEvent[];
};

function createTraceEvent(
    id:string,
    label:string,
    status:TraceEvent["status"],
    message?:string,
):TraceEvent{
    return{
        id,
        label,
        status,
        message,
        createdAt:new Date().toISOString(),
    };
}
function buildTraceEvents(
    attempts: RunReactAppAgentAttempt[],
): TraceEvent[] {
    const trace: TraceEvent[] = [
        createTraceEvent(
            "copy-template",
            "Copy starter template",
            "succeeded",
        ),
        createTraceEvent(
            "coordinate-agents",
            "Coordinate planner, coder, and reviewer",
            "succeeded",
        ),
    ];

    attempts.forEach((attempt, index) => {
        const prefix = `${attempt.kind}-${index + 1}`;

        trace.push(
            createTraceEvent(
                `${prefix}-agent`,
                `${attempt.kind} coding agent`,
                attempt.agent.finished ? "succeeded" : "failed",
                `${attempt.agent.steps.length} agent step(s) executed`,
            ),
            createTraceEvent(
                `${prefix}-install`,
                "Install dependencies",
                attempt.install.exitCode === 0 ? "succeeded" : "failed",
                `exit code ${attempt.install.exitCode}`,
            ),
            createTraceEvent(
                `${prefix}-build`,
                "Build generated app",
                attempt.build.exitCode === 0 ? "succeeded" : "failed",
                `exit code ${attempt.build.exitCode}`,
            ),
            createTraceEvent(
                `${prefix}-eval`,
                "Evaluate generated app",
                attempt.eval.passed ? "succeeded" : "failed",
                `${attempt.eval.checks.filter((check) => check.passed).length}/${attempt.eval.checks.length} checks passed`,
            ),
            createTraceEvent(
                `${prefix}-review`,
                "Review result",
                attempt.review.accepted ? "succeeded" : "failed",
                attempt.review.reason,
            ),
        );
    });

    return trace;
}

export async function runReactAppAgent(
    options: RunReactAppAgentOptions,
): Promise<RunReactAppAgentResult> {
    let provider: ModelProvider;
    const maxRepairAttempts = options.maxRepairAttempts ?? 1;

    if (options.model) {
        provider = options.model;
    } else {
        const providerOptions: OpenAICompatibleProviderOptions = {
            baseUrl: options.llm.baseUrl,
            apiKey: options.llm.apiKey,
            model: options.llm.model,
        };

        if (options.llm.timeoutMs !== undefined) {
            providerOptions.timeoutMs = options.llm.timeoutMs;
        }

        provider = new OpenAICompatibleProvider(providerOptions);
    }

    await copyWorkspaceTemplate(options.workspaceRoot, options.templateRoot);
    const coordination = coordinateAgents({
        goal: options.goal,
    });

    const coordinationContext = formatCoordinationContext(coordination);

    const workspaceContext = formatSkillInstructions(reactViteAppSkill);

    const baseContext = [
        workspaceContext,
        coordinationContext,
        options.memoryContext,
    ]
        .filter((part) => part && part.length > 0)
        .join("\n\n");
    async function runAttempt(
        kind: RunReactAppAgentAttempt["kind"],
        context: string,
    ): Promise<RunReactAppAgentAttempt> {
        const agent = await runCodingAgentLoop({
            goal: options.goal,
            model: provider,
            workspaceRoot: options.workspaceRoot,
            maxSteps: 3,
            context,
        });

        const install = await runWorkspaceCommand(options.workspaceRoot, {
            command: "npm",
            args: ["install"],
        });

        const build = await runWorkspaceCommand(options.workspaceRoot, {
            command: "npm",
            args: ["run", "build"],
        });

        const appSource = await readFile(
            path.join(options.workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        const evalResult = evaluateReactApp({
            source: appSource,
            goal: options.goal,
        });

        const review = reviewReactAppAgentResult({
            agent,
            install,
            build,
            eval: evalResult,
        });

        return {
            kind,
            agent,
            install,
            build,
            eval: evalResult,
            review,
        };
    }
    const attempts:RunReactAppAgentAttempt[]=[];

    const firstAttempt = await runAttempt(
        "initial",
        baseContext,
    );

    attempts.push(firstAttempt);
    let latestAttempt = firstAttempt;
    let repairAttempt = 0;
    while (
        shouldRepair({
            review: latestAttempt.review,
            repairAttempt,
            maxRepairAttempts,
        })
        ){
        const repairContext = formatRepairContext({
            build: latestAttempt.build,
            eval: latestAttempt.eval,
            review: latestAttempt.review,
        });

        const nextAttempt = await runAttempt(
            "repair",
            [
                baseContext,
                repairContext,
            ].join("\n\n"),
        );

        attempts.push(nextAttempt);
        latestAttempt = nextAttempt;
        repairAttempt += 1;
    }

    return {
        workspaceRoot: options.workspaceRoot,
        coordination,
        agent: latestAttempt.agent,
        install: latestAttempt.install,
        build: latestAttempt.build,
        eval: latestAttempt.eval,
        review: latestAttempt.review,
        attempts,
        trace: buildTraceEvents(attempts),
    };

}

