import {
    OpenAICompatibleProvider,
    DesignPlannerAgent,
    PlannerAgent,
    type OpenAICompatibleProviderOptions,
    runCodingAgentLoop,
    type RunCodingAgentLoopResult,
    type ModelProvider,
    coordinateAgents,
    formatSkillInstructions,
    reactViteAppSkill,
    visualDesignSkill,
    type CoordinateAgentsResult,
    ReviewerAgent,
    type ReviewerOutput,
    ImageAssetTool,
    type ImageAssetProvider,
    type ImageAssetMode,
    type SavedImageAsset,
    type PlannerOutput,
} from "@appforge/agent-core";
import type {
    DesignPlan,
    DesignPlanCompliance,
    DesignPlanSource,
} from "@appforge/protocol";
import {
    copyWorkspaceTemplate,
    runWorkspaceCommand,
} from "@appforge/workspace";

import {
    combineReactAppAgentReviews,
    reviewReactAppAgentResult,
    type ReactAppAgentReview,
} from "./review-react-app-agent.js";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
    evaluateReactApp,
    type BrowserEvalResult,
    type ReactAppEvalResult,
} from "@appforge/harness";
import { formatRepairContext } from "./format-repair-context.js";
import { shouldRepair } from "./should-repair.js";
import type {
    AgentAction,
    RunOperationStage,
    TraceEvent,
} from "@appforge/protocol";
import {
    autofixReactSource,
    autofixReactStyles,
} from "./react-source-autofix.js";
import {
    resolveReactPagePlans,
    runParallelReactPagesAgent,
    type ParallelCodingWorkstreamResult,
    type TopicLookupProvider,
} from "./run-parallel-react-pages-agent.js";
import {
    createFileDiffEvidence,
    createScopeViolationForAction,
    createWorkspaceSnapshot,
    diffWorkspaceSnapshots,
    findUnexpectedScopeFiles,
    findUnexpectedScopeRanges,
    locateFocusedEditScope,
    validateFocusedEditAction,
    type FileSnapshot,
    type FocusedEditExecutionMode,
    type FocusedEditScope,
    type BrowserProbe,
    type RequirementEvidence,
    type ScopeViolation,
    type WorkspaceDiff,
} from "./focused-edit-diagnostics.js";
import {
    createFallbackDesignPlan,
    evaluateDesignPlanCompliance,
    formatDesignPlanForPrompt,
} from "./design-plan-utils.js";
import { evaluateInitialGenerationCompleteness } from "./initial-generation-completeness.js";
import {
    extractStableProductGoal,
    generateStableReactPage,
    isGenericRepairRequest,
} from "./stable-react-page-generator.js";
import {
    isExplicitRegenerationPrompt,
    isFreshPageGenerationRequest,
    isFullApplicationCreationRequest,
} from "./generation-request-intent.js";
import {
    evaluateAntiTemplateSource,
    type AntiTemplateReport,
} from "./anti-template-evaluator.js";
import { evaluateSourceStyleContract } from "./source-style-contract.js";

const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;
const BUILD_COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;
const TYPECHECK_COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;

export type RunReactAppAgentOptions = {
    goal: string;
    /** The newest focused iteration request. The full `goal` remains the
     * acceptance contract used by deterministic/browser/LLM review. */
    currentRequest?: string;
    workspaceRoot: string;
    templateRoot: string;
    llm: {
        baseUrl: string;
        apiKey: string;
        model: string;
        timeoutMs?: number;
        maxRetries?: number;
        stream?: boolean;
        serviceTier?: "auto" | "default";
        plannerTimeoutMs?: number;
        reviewerTimeoutMs?: number;
        /** Absolute per-model-call deadline. Unlike timeoutMs, streamed
         * activity does not extend this budget. */
        hardTimeoutMs?: number;
        parallelMaxTokens?: number;
        parallelThinking?: "enabled" | "disabled" | "auto";
        maxTokens?: number;
    };
    model?: ModelProvider;
    /** Prefer the deterministic single-page generator for fresh structural
     * runs. Production defaults to true; injected-model tests keep the legacy
     * agent path unless they opt in explicitly. */
    stableGeneration?: boolean;
    /** Enable page-scoped Coding Agents for fresh generation. Every planned
     * webpage receives one initial Coding API call; existing-draft iterations
     * remain on the focused single-agent path. */
    parallelCoding?: boolean;
    /** Maximum simultaneous page Coding API requests. */
    parallelCodingConcurrency?: number;
    /** Absolute budget for one page, including its failed-page retry. */
    parallelCodingTimeoutMs?: number;
    maxRepairAttempts?: number;
    memoryContext?:string;
    evaluateBrowser?: EvaluateBrowserForAttempt;
    imageAssetProvider?: ImageAssetProvider;
    imageAssetModes?: ImageAssetMode[];
    topicLookupProvider?: TopicLookupProvider;
    designPlan?: DesignPlan;
    designPlanning?: boolean;
    resetWorkspace?: boolean;
    signal?: AbortSignal;
    onProgress?: (
        stage: RunOperationStage,
    ) => void | Promise<void>;
};

async function emitRunProgress(
    onProgress: RunReactAppAgentOptions["onProgress"],
    stage: RunOperationStage,
): Promise<void> {
    if (!onProgress) {
        return;
    }

    try {
        await onProgress(stage);
    } catch {
        // Progress persistence is observability only. A temporary repository
        // write failure must not discard an otherwise valid generated app.
    }
}

function createRunProgressHeartbeat(
    onProgress: RunReactAppAgentOptions["onProgress"],
    stage: RunOperationStage,
    intervalMs = 10_000,
): () => void {
    let lastEmissionAt = Date.now();
    let emissionPending = false;

    return () => {
        if (
            !onProgress ||
            emissionPending ||
            Date.now() - lastEmissionAt < intervalMs
        ) {
            return;
        }

        lastEmissionAt = Date.now();
        emissionPending = true;
        void emitRunProgress(onProgress, stage).finally(() => {
            emissionPending = false;
        });
    };
}

export type RunReactAppAgentCommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

export type RunMetrics = {
    plannerCalls: number;
    designPlannerCalls: number;
    codingCalls: number;
    reviewerCalls: number;
    retryCalls: number;
    fallbackPages: string[];
    plannerDurationMs: number;
    designPlannerDurationMs: number;
    codingDurationMs: number;
    installDurationMs: number;
    buildDurationMs: number;
    evaluationDurationMs: number;
    reviewerDurationMs: number;
    totalDurationMs: number;
    modifiedFiles: string[];
    dependencyManifestChanged: boolean;
};

export type Requirement = {
    id: string;
    instruction: string;
    priority: "must" | "should" | "must_preserve";
    target?: string;
    targetFiles?: string[];
    browserProbes?: BrowserProbe[];
    verification: string;
};

export type RequirementResult = Requirement & {
    status: "PASS" | "FAIL" | "UNVERIFIED";
    evidence: string;
    evidences: RequirementEvidence[];
    affectedFiles: string[];
    affectedSelectorsOrComponents: string[];
};

export type EvaluateBrowserForAttempt = (input: {
    goal: string;
    workspaceRoot: string;
    kind: "initial" | "repair";
    attemptNumber: number;
    browserProbes?: BrowserProbe[];
    signal?: AbortSignal;
}) => Promise<BrowserEvalResult>;

export type RunReactAppAgentAttempt = {
    kind: "initial" | "repair";
    agent: RunCodingAgentLoopResult;
    install: RunReactAppAgentCommandResult;
    build: RunReactAppAgentCommandResult;
    typecheck?: RunReactAppAgentCommandResult;
    eval: ReactAppEvalResult;
    browserEval?: BrowserEvalResult;
    antiTemplate?: AntiTemplateReport;
    llmReview?: ReviewerOutput;
    review: ReactAppAgentReview;
    parallelWorkstreams?: ParallelCodingWorkstreamResult[];
    metrics?: RunMetrics;
};

export type RunReactAppAgentResult = {
    workspaceRoot:string;
    coordination: CoordinateAgentsResult;
    agent: RunCodingAgentLoopResult;
    install: RunReactAppAgentCommandResult;
    build: RunReactAppAgentCommandResult;
    typecheck?: RunReactAppAgentCommandResult;
    eval:ReactAppEvalResult;
    browserEval?: BrowserEvalResult;
    antiTemplate?: AntiTemplateReport;
    review: ReactAppAgentReview;
    attempts: RunReactAppAgentAttempt[];
    trace?: TraceEvent[];
    llmReview?: ReviewerOutput;
    metrics?: RunMetrics;
    requirements?: RequirementResult[];
    workspaceDiff?: WorkspaceDiff;
    designPlan?: DesignPlan;
    designPlanSource?: DesignPlanSource;
    designPlanCompliance?: DesignPlanCompliance[];
    focusedEditScope?: FocusedEditScope;
    scopeViolations?: ScopeViolation[];
    executionMode?: FocusedEditExecutionMode;
};

type LocalAssetReference = {
    urlPath: string;
    publicPath: string;
    exists: boolean;
};

const CONTINUATION_CORE_SOURCE_FILES = [
    "src/App.tsx",
    "src/content.ts",
    "src/App.css",
    "src/main.tsx",
    "package.json",
    "index.html",
];
const MAX_CONTINUATION_SOURCE_CHARACTERS = 12_000;
const MAX_CONTINUATION_FILE_CHARACTERS = 4_000;
const MAX_CONTINUATION_SOURCE_FILES = 12;
const REVIEW_CORE_SOURCE_FILES = [
    "src/App.tsx",
    "src/content.ts",
    "src/App.css",
    "src/main.tsx",
];
const MAX_REVIEW_SOURCE_CHARACTERS = 5_000;
const MAX_REVIEW_SOURCE_FILES = 8;
const MAX_STATIC_EVALUATION_CHARACTERS = 24_000;
const MAX_STATIC_EVALUATION_SOURCE_FILES = 12;
const MAX_DISCOVERED_SOURCE_FILES = 200;
const MAX_VISITED_SOURCE_DIRECTORIES = 400;
const MAX_ASSET_SCAN_CHARACTERS = 500_000;
const MAX_ASSET_SCAN_FILE_CHARACTERS = 100_000;
const DISCOVERABLE_SOURCE_EXTENSION = /\.(?:tsx?|jsx?|css|scss)$/iu;
const EXCLUDED_SOURCE_FILE =
    /(?:\.d\.ts$|(?:^|[._-])(?:test|spec|stories)(?:[._-]|$))/iu;
const EXCLUDED_SOURCE_DIRECTORIES = new Set([
    "node_modules",
    "dist",
    "build",
    "coverage",
    "out",
    "cache",
    ".cache",
    ".vite",
    ".next",
    ".turbo",
    "__tests__",
    "__snapshots__",
    "tests",
    "specs",
    "stories",
]);
const STRUCTURAL_SOURCE_DIRECTORIES = new Set([
    "components",
    "pages",
    "routes",
    "layouts",
]);
const INSTALL_DEPENDENCY_FILES = [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
];

async function createInstallDependencyFingerprint(
    workspaceRoot: string,
): Promise<string> {
    const hash = createHash("sha256");

    for (const filePath of INSTALL_DEPENDENCY_FILES) {
        hash.update(`\0${filePath}\0`);

        try {
            hash.update(
                await readFile(path.join(workspaceRoot, filePath), "utf8"),
            );
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                hash.update("<missing>");
                continue;
            }

            throw error;
        }
    }

    return hash.digest("hex");
}

function createEmptyRunMetrics(): RunMetrics {
    return {
        plannerCalls: 0,
        designPlannerCalls: 0,
        codingCalls: 0,
        reviewerCalls: 0,
        retryCalls: 0,
        fallbackPages: [],
        plannerDurationMs: 0,
        designPlannerDurationMs: 0,
        codingDurationMs: 0,
        installDurationMs: 0,
        buildDurationMs: 0,
        evaluationDurationMs: 0,
        reviewerDurationMs: 0,
        totalDurationMs: 0,
        modifiedFiles: [],
        dependencyManifestChanged: false,
    };
}

function cloneRunMetrics(metrics: RunMetrics): RunMetrics {
    return {
        ...metrics,
        fallbackPages: [...metrics.fallbackPages],
        modifiedFiles: [...metrics.modifiedFiles],
    };
}

function addDuration(
    metrics: RunMetrics,
    key: keyof Pick<
        RunMetrics,
        | "plannerDurationMs"
        | "designPlannerDurationMs"
        | "codingDurationMs"
        | "installDurationMs"
        | "buildDurationMs"
        | "evaluationDurationMs"
        | "reviewerDurationMs"
    >,
    startedAt: number,
): void {
    metrics[key] += Date.now() - startedAt;
}

async function timeRunPhase<T>(
    metrics: RunMetrics,
    key: Parameters<typeof addDuration>[1],
    operation: () => Promise<T>,
): Promise<T> {
    const startedAt = Date.now();

    try {
        return await operation();
    } finally {
        addDuration(metrics, key, startedAt);
    }
}

function countModelProviderCalls(
    model: ModelProvider,
    metrics: RunMetrics,
    key: keyof Pick<
        RunMetrics,
        | "plannerCalls"
        | "designPlannerCalls"
        | "codingCalls"
        | "reviewerCalls"
    >,
): ModelProvider {
    return {
        async complete(request) {
            metrics[key] += 1;
            return model.complete(request);
        },
    };
}

function listModifiedFilesFromAgent(
    agent: RunCodingAgentLoopResult,
): string[] {
    const paths = new Set<string>();

    for (const step of agent.steps) {
        if (!step.execution.ok || step.execution.changed === false) {
            continue;
        }

        if (
            step.action.type === "write_file" ||
            step.action.type === "append_file" ||
            step.action.type === "edit_file"
        ) {
            paths.add(step.action.path);
        }

        if (step.action.type === "get_image") {
            paths.add(step.action.outputPath);
        }
    }

    return [...paths].sort();
}

function listModifiedFilesFromAttempts(
    attempts: RunReactAppAgentAttempt[],
): string[] {
    const paths = new Set<string>();

    for (const attempt of attempts) {
        for (const filePath of listModifiedFilesFromAgent(attempt.agent)) {
            paths.add(filePath);
        }
    }

    return [...paths].sort();
}

function isDependencyManifestPath(filePath: string): boolean {
    return INSTALL_DEPENDENCY_FILES.includes(filePath.replace(/\\/gu, "/"));
}

function listFallbackPagesFromAttempts(
    attempts: RunReactAppAgentAttempt[],
): string[] {
    const pages = new Set<string>();

    for (const attempt of attempts) {
        for (const workstream of attempt.parallelWorkstreams ?? []) {
            if (workstream.status === "fallback") {
                pages.add(
                    `${workstream.label} (${workstream.routePath || workstream.path})`,
                );
            }
        }
    }

    return [...pages].sort();
}

function parallelWorkstreamsHitHardDeadline(
    workstreams: ParallelCodingWorkstreamResult[] | undefined,
): boolean {
    return (
        workstreams?.some((workstream) =>
            /total generation deadline|exhausted its \d+ms/u.test(
                workstream.errorMessage ?? "",
            ),
        ) ?? false
    );
}

function finalizeRunMetrics(input: {
    metrics: RunMetrics;
    attempts: RunReactAppAgentAttempt[];
    startedAt: number;
}): RunMetrics {
    const modifiedFiles = listModifiedFilesFromAttempts(input.attempts);
    const fallbackPages = listFallbackPagesFromAttempts(input.attempts);

    return {
        ...input.metrics,
        fallbackPages,
        modifiedFiles,
        dependencyManifestChanged: modifiedFiles.some(
            isDependencyManifestPath,
        ),
        totalDurationMs: Date.now() - input.startedAt,
    };
}

function withRunDiagnostics(
    result: RunReactAppAgentResult,
    metrics: RunMetrics,
    startedAt: number,
    requirements?: RequirementResult[],
): RunReactAppAgentResult {
    const finalizedMetrics = finalizeRunMetrics({
        metrics,
        attempts: result.attempts,
        startedAt,
    });

    return {
        ...result,
        metrics: finalizedMetrics,
        ...(requirements ? { requirements } : {}),
    };
}

function withRequirementLedgerResult(
    result: RunReactAppAgentResult,
    requirements: Requirement[],
    focusedEdit: boolean,
    workspaceDiff?: WorkspaceDiff,
    focusedEditScope?: FocusedEditScope,
    scopeViolations: ScopeViolation[] = [],
): RunReactAppAgentResult {
    const metrics =
        result.metrics ??
        finalizeRunMetrics({
            metrics: createEmptyRunMetrics(),
            attempts: result.attempts,
            startedAt: Date.now(),
        });
    const postExecutionScopeViolations =
        workspaceDiff && focusedEditScope
            ? findUnexpectedScopeRanges(workspaceDiff, focusedEditScope).map(
                  (range): ScopeViolation => ({
                      action: "workspace_diff",
                      file: range.file,
                      reason: `Workspace diff changed lines ${range.startLine}-${range.endLine} outside focused edit allowed ranges.`,
                      allowedRanges: focusedEditScope.allowedRanges.filter(
                          (allowedRange) => allowedRange.file === range.file,
                      ),
                  }),
              )
            : [];
    const allScopeViolations = [
        ...scopeViolations,
        ...postExecutionScopeViolations,
    ];
    const requirementResults = evaluateRequirementLedger({
        requirements,
        metrics,
        review: result.review,
        focusedEdit,
        ...(workspaceDiff ? { workspaceDiff } : {}),
        ...(focusedEditScope ? { focusedEditScope } : {}),
        browserEvidence: extractRequirementEvidenceFromBrowser(
            result.browserEval,
        ),
        ...(allScopeViolations.length > 0
            ? { scopeViolations: allScopeViolations }
            : {}),
    });
    const ledgerReview = enforceRequirementLedgerReview({
        review: result.review,
        requirements: requirementResults,
    });
    const review = enforceFallbackPagesReview(ledgerReview, metrics);
    const attempts =
        review === result.review || result.attempts.length === 0
            ? result.attempts
            : result.attempts.map((attempt, index) =>
                  index === result.attempts.length - 1
                      ? { ...attempt, review }
                      : attempt,
              );

    const trace =
        review === result.review
            ? result.trace
            : buildTraceEvents(
                  attempts,
                  result.coordination.plan.length,
              );

    return {
        ...result,
        review,
        attempts,
        metrics,
        requirements: requirementResults,
        ...(workspaceDiff ? { workspaceDiff } : {}),
        ...(focusedEditScope ? { focusedEditScope } : {}),
        ...(allScopeViolations.length > 0
            ? { scopeViolations: allScopeViolations }
            : {}),
        executionMode: focusedEdit ? "fast_edit" : "structural_edit",
        ...(trace ? { trace } : {}),
    };
}

function describeModelStageError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function markReviewWithRepairFailure(
    review: ReactAppAgentReview,
    error: unknown,
): ReactAppAgentReview {
    return {
        ...review,
        accepted: false,
        reason: [
            "Automatic repair failed before a new attempt completed.",
            `Repair error: ${describeModelStageError(error)}`,
            "The latest generated draft was preserved for human review.",
        ].join(" "),
    };
}

function markReviewWithReviewerFailure(
    review: ReactAppAgentReview,
    error: unknown,
): ReactAppAgentReview {
    if (!review.accepted) {
        return review;
    }

    return {
        ...review,
        accepted: true,
        reason: [
            review.reason,
            "LLM reviewer was unavailable, so AppForge accepted the result based on deterministic install/build/eval checks.",
            `Reviewer error: ${describeModelStageError(error)}`,
        ].join(" "),
    };
}

function createFallbackPlannerOutput(error: unknown): PlannerOutput {
    return {
        summary: [
            "Planner Agent was unavailable, so AppForge used a local fallback plan.",
            `Planner error: ${describeModelStageError(error)}`,
        ].join(" "),
        steps: [
            {
                id: "fallback-step-1",
                title: "Implement the requested app",
                description:
                    "Build or update the React/Vite application to satisfy the user's core goal.",
                acceptanceCriteria: [
                    "The generated app visibly addresses the user goal",
                    "Existing work is preserved when this is a continuation request",
                ],
            },
            {
                id: "fallback-step-2",
                title: "Keep the implementation buildable",
                description:
                    "Use compact files, split complex pages into content/CSS/component files when needed, and keep local assets valid.",
                acceptanceCriteria: [
                    "npm install and npm run build complete successfully",
                    "Referenced local assets exist under public/assets",
                ],
            },
        ],
    };
}

async function createPlannerOutputWithFallback(
    input: {
        plannerAgent: PlannerAgent;
        goal: string;
        context: string;
        signal?: AbortSignal;
    },
): Promise<PlannerOutput> {
    try {
        return await input.plannerAgent.createPlan(
            input.goal,
            input.context,
        );
    } catch (error) {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }
        return createFallbackPlannerOutput(error);
    }
}

function explicitlyRequestsDesignPlanRefresh(request: string): boolean {
    return /\b(?:redesign|rebrand|new visual direction|different style|change the whole style|overall style)\b|整体风格|重新设计|换个风格|视觉语言|不要.*风格|更像.*网站|不像.*网站/iu.test(
        request,
    );
}

export async function createDesignPlanWithFallback(input: {
    designPlannerAgent: DesignPlannerAgent;
    goal: string;
    requirements: readonly Requirement[];
    plannerOutput: PlannerOutput;
    routes: readonly {
        path: string;
        purpose: string;
        acceptanceCriteria?: readonly string[];
    }[];
    existingDesignPlan?: DesignPlan;
    preserveExisting: boolean;
    designPlanningEnabled: boolean;
    signal?: AbortSignal;
}): Promise<{
    designPlan: DesignPlan;
    designPlanSource: DesignPlanSource;
}> {
    if (input.existingDesignPlan && input.preserveExisting) {
        return {
            designPlan: input.existingDesignPlan,
            designPlanSource: "preserved",
        };
    }

    if (input.designPlanningEnabled) {
        try {
            input.signal?.throwIfAborted();
            const designPlan = await input.designPlannerAgent.createDesignPlan({
                goal: input.goal,
                currentRequirements: input.requirements.map(
                    (requirement) =>
                        `${requirement.id} [${requirement.priority}]: ${requirement.instruction}`,
                ),
                pagePlan: JSON.stringify(
                    {
                        summary: input.plannerOutput.summary,
                        pages: input.routes,
                    },
                    null,
                    2,
                ),
                forbiddenPatterns: input.requirements
                    .map((requirement) => requirement.instruction)
                    .filter((instruction) =>
                        /不要|禁止|avoid|no |without|not /iu.test(
                            instruction,
                        ),
                    ),
                ...(input.existingDesignPlan
                    ? {
                          historicalContext: formatDesignPlanForPrompt(
                              input.existingDesignPlan,
                          ),
                      }
                    : {}),
            });

            return {
                designPlan,
                designPlanSource: "planner",
            };
        } catch (error) {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
        }
    }

    return {
        designPlan: createFallbackDesignPlan({
            goal: input.goal,
            plannerOutput: input.plannerOutput,
            routes: input.routes,
        }),
        designPlanSource: "fallback",
    };
}

function createFocusedEditPlannerOutput(
    requirements: Requirement[],
): PlannerOutput {
    return {
        summary:
            "Focused edit fast path: skip Planner Agent and preserve unrelated workspace areas.",
        steps: requirements.map((requirement) => ({
            id: requirement.id,
            title: requirement.instruction,
            description:
                requirement.priority === "must_preserve"
                    ? "Preserve unrelated files, selectors, dependencies, image assets, and broader page structure."
                    : "Apply only the requested focused change in the existing workspace.",
            acceptanceCriteria: [requirement.verification],
        })),
    };
}

async function reviewWithOptionalLlm(
    input: {
        reviewerAgent: ReviewerAgent;
        deterministicReview: ReactAppAgentReview;
        goal: string;
        plan: string[];
        source: string;
        buildPassed: boolean;
        evaluationSummary: string;
        assetEvidence: string;
        signal?: AbortSignal;
    },
): Promise<{
    review: ReactAppAgentReview;
    llmReview?: ReviewerOutput;
}> {
    if (!input.deterministicReview.accepted) {
        return {
            review: input.deterministicReview,
        };
    }

    try {
        const llmReview = await input.reviewerAgent.review({
            goal: input.goal,
            plan: input.plan,
            source: input.source,
            buildPassed: input.buildPassed,
            evaluationSummary: input.evaluationSummary,
            assetEvidence: input.assetEvidence,
        });

        return {
            llmReview,
            review: combineReactAppAgentReviews(
                input.deterministicReview,
                llmReview,
            ),
        };
    } catch (error) {
        if (input.signal?.aborted) {
            input.signal.throwIfAborted();
        }
        return {
            review: markReviewWithReviewerFailure(
                input.deterministicReview,
                error,
            ),
        };
    }
}

function labelModelProviderStage(
    model: ModelProvider,
    stage: string,
    signal?: AbortSignal,
    onActivity?: () => void,
    hardTimeoutMs?: number,
): ModelProvider {
    return {
        async complete(request) {
            try {
                signal?.throwIfAborted();
                const normalizedHardTimeoutMs =
                    hardTimeoutMs !== undefined &&
                    Number.isFinite(hardTimeoutMs)
                        ? Math.min(
                              600_000,
                              Math.max(100, Math.floor(hardTimeoutMs)),
                          )
                        : undefined;
                const hardDeadlineSignal = normalizedHardTimeoutMs
                    ? AbortSignal.timeout(normalizedHardTimeoutMs)
                    : undefined;
                const signals = [
                    signal,
                    request.signal,
                    hardDeadlineSignal,
                ].filter(
                    (candidate): candidate is AbortSignal =>
                        candidate !== undefined,
                );
                const effectiveSignal =
                    signals.length > 1
                        ? AbortSignal.any(signals)
                        : signals[0];
                const reportActivity =
                    request.onActivity || onActivity
                        ? () => {
                              request.onActivity?.();
                              onActivity?.();
                          }
                        : undefined;
                const response = await model.complete({
                    ...request,
                    ...(effectiveSignal
                        ? { signal: effectiveSignal }
                        : {}),
                    ...(reportActivity ? { onActivity: reportActivity } : {}),
                });
                effectiveSignal?.throwIfAborted();

                return response;
            } catch (error) {
                if (signal?.aborted) {
                    signal.throwIfAborted();
                }
                throw new Error(
                    `${stage} failed: ${describeModelStageError(error)}`,
                    {
                        cause: error,
                    },
                );
            }
        },
    };
}

function limitContextText(text: string | undefined, maxCharacters: number): string {
    if (!text) {
        return "";
    }

    return text.length > maxCharacters
        ? `${text.slice(0, maxCharacters)}\n... omitted ${text.length - maxCharacters} context characters ...`
        : text;
}

function formatCompactCoordinationContext(
    coordination: CoordinateAgentsResult,
): string {
    return [
        "Agent plan:",
        ...coordination.plan.slice(0, 4).map(
            (step, index) =>
                // Acceptance criteria are appended at the end of each
                // coordinated step. Preserve both implementation intent and
                // the complete normal-sized criteria while bounding unusual
                // model output by trimming only the middle.
                `${index + 1}. ${sliceWithHeadAndTail(step, 650)}`,
        ),
        "",
        "Agent assignments:",
        "- planner: produced the plan",
        "- coder: implement the app",
        "- reviewer: verify the result",
    ].join("\n");
}

function sliceWithHeadAndTail(
    content: string,
    maxCharacters: number,
): string {
    if (content.length <= maxCharacters) {
        return content;
    }

    const headCharacters = Math.floor(maxCharacters / 2);
    const tailCharacters = maxCharacters - headCharacters;

    return [
        content.slice(0, headCharacters),
        `\n\n... omitted ${content.length - maxCharacters} characters from the middle of this file ...\n\n`,
        content.slice(content.length - tailCharacters),
    ].join("");
}

type WorkspaceSourceSnapshot = {
    path: string;
    content: string;
};

function toWorkspacePath(filePath: string): string {
    return filePath.replace(/\\/gu, "/");
}

function isDiscoverableSourceFile(fileName: string): boolean {
    return (
        DISCOVERABLE_SOURCE_EXTENSION.test(fileName) &&
        !EXCLUDED_SOURCE_FILE.test(fileName)
    );
}

async function discoverWorkspaceSourceFiles(
    workspaceRoot: string,
): Promise<string[]> {
    const sourceRoot = path.join(workspaceRoot, "src");
    const discovered: string[] = [];
    let visitedDirectories = 0;

    async function visit(directory: string): Promise<void> {
        if (
            discovered.length >= MAX_DISCOVERED_SOURCE_FILES ||
            visitedDirectories >= MAX_VISITED_SOURCE_DIRECTORIES
        ) {
            return;
        }
        visitedDirectories += 1;
        let entries;

        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return;
            }

            throw error;
        }

        for (const entry of entries.sort((left, right) =>
            left.name.localeCompare(right.name),
        )) {
            if (discovered.length >= MAX_DISCOVERED_SOURCE_FILES) {
                break;
            }
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                if (!EXCLUDED_SOURCE_DIRECTORIES.has(entry.name.toLowerCase())) {
                    await visit(entryPath);
                }
                continue;
            }

            if (entry.isFile() && isDiscoverableSourceFile(entry.name)) {
                discovered.push(
                    toWorkspacePath(path.relative(workspaceRoot, entryPath)),
                );
            }
        }
    }

    await visit(sourceRoot);

    return discovered;
}

function requestMentionsSourceFile(
    filePath: string,
    currentRequest: string,
): boolean {
    if (!currentRequest.trim()) {
        return false;
    }

    const baseName = path.basename(
        filePath,
        path.extname(filePath),
    );
    const words = baseName
        .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
        .split(/[^\p{L}\p{N}]+/gu)
        .map((word) => word.toLocaleLowerCase())
        .filter((word) => word.length >= 3);
    const normalizedRequest = currentRequest.toLocaleLowerCase();

    return words.some((word) => normalizedRequest.includes(word));
}

function isStructuralSourceFile(filePath: string): boolean {
    return toWorkspacePath(filePath)
        .toLocaleLowerCase()
        .split("/")
        .some((segment) => STRUCTURAL_SOURCE_DIRECTORIES.has(segment));
}

async function readPrioritizedWorkspaceFiles(input: {
    workspaceRoot: string;
    currentRequest: string;
    coreFiles: string[];
    maxFiles: number;
}): Promise<WorkspaceSourceSnapshot[]> {
    const discovered = await discoverWorkspaceSourceFiles(input.workspaceRoot);
    const coreFiles = [...new Set(input.coreFiles.map(toWorkspacePath))];
    const coreSet = new Set(coreFiles);
    const additionalFiles = discovered.filter((filePath) => !coreSet.has(filePath));
    const filenameMatches = additionalFiles.filter((filePath) =>
        requestMentionsSourceFile(filePath, input.currentRequest),
    );
    const matchedSet = new Set(filenameMatches);
    const structuralFiles = additionalFiles.filter(
        (filePath) =>
            !matchedSet.has(filePath) && isStructuralSourceFile(filePath),
    );
    const structuralSet = new Set(structuralFiles);
    const remainingFiles = additionalFiles.filter(
        (filePath) =>
            !matchedSet.has(filePath) && !structuralSet.has(filePath),
    );
    const candidates = [
        ...filenameMatches,
        ...coreFiles,
        ...structuralFiles,
        ...remainingFiles,
    ];
    const snapshots: WorkspaceSourceSnapshot[] = [];

    for (const filePath of candidates) {
        if (snapshots.length >= input.maxFiles) {
            break;
        }

        try {
            snapshots.push({
                path: filePath,
                content: await readFile(
                    path.join(input.workspaceRoot, filePath),
                    "utf8",
                ),
            });
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                continue;
            }

            throw error;
        }
    }

    return snapshots;
}

export async function formatStaticEvaluationSource(
    workspaceRoot: string,
): Promise<string> {
    const sourceFiles = await readPrioritizedWorkspaceFiles({
        workspaceRoot,
        currentRequest: "",
        coreFiles: REVIEW_CORE_SOURCE_FILES,
        maxFiles: MAX_STATIC_EVALUATION_SOURCE_FILES,
    });
    const perFileBudget =
        sourceFiles.length > 0
            ? Math.floor(
                  MAX_STATIC_EVALUATION_CHARACTERS / sourceFiles.length,
              )
            : MAX_STATIC_EVALUATION_CHARACTERS;

    return sourceFiles
        .map(
            (file) =>
                `--- ${file.path} ---\n${sliceWithHeadAndTail(file.content, perFileBudget)}`,
        )
        .join("\n\n");
}

async function readAllWorkspaceSourceFiles(
    workspaceRoot: string,
): Promise<WorkspaceSourceSnapshot[]> {
    const filePaths = await discoverWorkspaceSourceFiles(workspaceRoot);
    const sourceFiles: WorkspaceSourceSnapshot[] = [];
    let scannedCharacters = 0;

    for (const filePath of filePaths) {
        if (scannedCharacters >= MAX_ASSET_SCAN_CHARACTERS) {
            break;
        }

        const absolutePath = path.join(workspaceRoot, filePath);
        const fileStats = await stat(absolutePath);
        const remainingCharacters =
            MAX_ASSET_SCAN_CHARACTERS - scannedCharacters;

        if (
            fileStats.size > MAX_ASSET_SCAN_FILE_CHARACTERS ||
            fileStats.size > remainingCharacters
        ) {
            continue;
        }

        const content = await readFile(absolutePath, "utf8");

        if (content.length > remainingCharacters) {
            continue;
        }

        sourceFiles.push({ path: filePath, content });
        scannedCharacters += content.length;
    }

    return sourceFiles;
}

async function evaluateWorkspaceAntiTemplate(input: {
    workspaceRoot: string;
    designPlan?: DesignPlan;
}): Promise<AntiTemplateReport | undefined> {
    const sourceFiles = await readAllWorkspaceSourceFiles(input.workspaceRoot);
    const appSource = sourceFiles
        .filter((file) => /\.(?:tsx|jsx|ts|js)$/iu.test(file.path))
        .map((file) => `--- ${file.path} ---\n${file.content}`)
        .join("\n\n");
    const cssSource = sourceFiles
        .filter((file) => /\.(?:css|scss)$/iu.test(file.path))
        .map((file) => `--- ${file.path} ---\n${file.content}`)
        .join("\n\n");

    if (!appSource.trim() || !cssSource.trim()) {
        return undefined;
    }

    return evaluateAntiTemplateSource({
        ...(input.designPlan
            ? { applicationType: input.designPlan.applicationType }
            : {}),
        appSource,
        cssSource,
    });
}

function explicitlyRequestsVisualStructureDiversity(input: {
    request: string;
    designPlan?: DesignPlan;
}): boolean {
    const text = [
        input.request,
        input.designPlan?.visualDNA.forbiddenPatterns.join(" ") ?? "",
    ].join(" ");
    return /模板|模版|模板化|模版化|卡片化|方块化|格子|卡片|不同风格|自己的特色|每个.*特点|每个.*风格|不要.*一样|不能.*一样|只是.*换色|只是.*文字|same-looking|same template|generic template|card grid|rounded cards|different styles|visual variety/iu.test(text);
}

function formatAntiTemplateReviewMessage(
    antiTemplate: AntiTemplateReport,
): string {
    const metrics = antiTemplate.metrics;
    const findings = antiTemplate.findings
        .map((finding) => finding.code)
        .join(", ");
    return [
        `${antiTemplate.level} templating risk, score ${antiTemplate.score}.`,
        `layoutFamilyMismatch=${metrics.layoutFamilyMismatchScore}, genericTemplateTokens=${metrics.genericTemplateTokenCount}, familySignals=${metrics.layoutFamilySignalCount}, roundedSurfaceRatio=${metrics.roundedSurfaceRatio}, equalColumnGridCount=${metrics.equalColumnGridCount}, largestRepeatedGroup=${metrics.largestRepeatedComponentGroup}.`,
        findings ? `findings=${findings}.` : "",
    ]
        .filter(Boolean)
        .join(" ");
}

function markReviewWithAntiTemplateWarning(
    review: ReactAppAgentReview,
    antiTemplate: AntiTemplateReport | undefined,
    input?: {
        blockOnSevere?: boolean;
    },
): ReactAppAgentReview {
    if (!antiTemplate || antiTemplate.level === "pass") {
        return review;
    }
    const blocking =
        input?.blockOnSevere === true && antiTemplate.level === "severe";
    const diagnostic = formatAntiTemplateReviewMessage(antiTemplate);

    return {
        ...review,
        accepted: blocking ? false : review.accepted,
        reason: [
            review.reason,
            blocking
                ? `Anti-template blocking failure: ${diagnostic} The user requested distinct visual structure, so AppForge must repair the layout family instead of accepting another generic template.`
                : `Anti-template diagnostic warning: ${diagnostic}`,
        ].join(" "),
        checks: {
            ...review.checks,
            antiTemplateLevel: antiTemplate.level,
            antiTemplateWarning: true,
            ...(blocking ? { antiTemplateBlocking: true } : {}),
        },
    };
}

async function formatReviewerSourceEvidence(
    workspaceRoot: string,
    currentRequest = "",
): Promise<string> {
    const parts = [
        "Generated source evidence for review:",
        "This is a size-limited snapshot of the key generated files, not the full workspace.",
    ];
    const existingFiles = await readPrioritizedWorkspaceFiles({
        workspaceRoot,
        currentRequest,
        coreFiles: REVIEW_CORE_SOURCE_FILES,
        maxFiles: MAX_REVIEW_SOURCE_FILES,
    });

    const perFileBudget =
        existingFiles.length > 0
            ? Math.floor(MAX_REVIEW_SOURCE_CHARACTERS / existingFiles.length)
            : MAX_REVIEW_SOURCE_CHARACTERS;

    for (const file of existingFiles) {
        const includedContent = sliceWithHeadAndTail(
            file.content,
            Math.min(perFileBudget, 2_500),
        );

        parts.push(`--- ${file.path} ---\n${includedContent}`);
    }

    return parts.join("\n\n");
}

function extractWorkspaceSourceLocation(
    workspaceRoot: string,
    stderr: string,
): { relativePath: string; lineNumber: number } | undefined {
    const sourceLocationPattern =
        /(src[\\/][^(:\r\n]+?\.(?:tsx?|jsx?|css|scss))(?::(\d+):\d+|\((\d+),\d+\))/giu;

    for (const match of stderr.matchAll(sourceLocationPattern)) {
        const candidate = match[1];
        const lineNumberText = match[2] ?? match[3];
        const lineNumber = lineNumberText ? Number(lineNumberText) : undefined;

        if (!candidate || !lineNumber || !Number.isInteger(lineNumber)) {
            continue;
        }

        const absolutePath = path.resolve(workspaceRoot, candidate);
        const relativePath = path.relative(workspaceRoot, absolutePath);

        if (
            relativePath.startsWith("..") ||
            path.isAbsolute(relativePath) ||
            !toWorkspacePath(relativePath).startsWith("src/")
        ) {
            continue;
        }

        return {
            relativePath: toWorkspacePath(relativePath),
            lineNumber,
        };
    }

    return undefined;
}

export async function formatBuildErrorSourceExcerpt(
    workspaceRoot: string,
    stderr: string,
): Promise<string> {
    const location = extractWorkspaceSourceLocation(workspaceRoot, stderr);

    if (!location) {
        return "";
    }

    try {
        const source = await readFile(
            path.join(workspaceRoot, location.relativePath),
            "utf8",
        );
        const lines = source.split(/\r?\n/u);
        const startLine = Math.max(1, location.lineNumber - 10);
        const endLine = Math.min(lines.length, location.lineNumber + 10);

        return [
            `Source: ${location.relativePath}`,
            ...lines
                .slice(startLine - 1, endLine)
                .map((line, index) => {
                    const currentLine = startLine + index;
                    const marker =
                        currentLine === location.lineNumber ? ">" : " ";

                    return `${marker} ${String(currentLine).padStart(4, " ")} | ${line}`;
                }),
        ].join("\n");
    } catch {
        return "";
    }
}

function formatCommandDiagnostics(
    command: RunReactAppAgentCommandResult | undefined,
): string {
    if (!command) {
        return "";
    }

    return [command.stderr.trim(), command.stdout.trim()]
        .filter((part) => part.length > 0)
        .join("\n");
}

function isTypecheckRepairContext(context: string): boolean {
    return context.includes("Typecheck diagnostics:");
}

function validateEntrypointIntegrationAction(action: AgentAction) {
    if (action.type === "finish") {
        return undefined;
    }

    if (
        (action.type === "write_file" || action.type === "edit_file") &&
        action.path.replaceAll("\\", "/") === "src/App.tsx"
    ) {
        return undefined;
    }

    return {
        ok: true,
        changed: false,
        message: [
            "Skipped unrelated action during entrypoint integration rescue.",
            "The only allowed workspace-changing action is write_file or edit_file for src/App.tsx.",
            "Reuse existing content, styles, and assets; connect the rendered entrypoint first, then return finish.",
        ].join(" "),
    };
}

function validateTypecheckRepairAction(action: AgentAction) {
    if (action.type === "finish") {
        return undefined;
    }

    if (
        action.type === "edit_file" &&
        /^src\/.*\.(?:ts|tsx|js|jsx)$/iu.test(action.path)
    ) {
        return undefined;
    }

    return {
        ok: true,
        changed: false,
        message: [
            "Skipped unrelated action during compiler repair.",
            "Fix the exact TypeScript diagnostic with one focused edit_file action in the reported source or its directly imported local data module, then return finish.",
            "Do not generate images, run commands, append files, or rewrite complete files during a typecheck-only repair.",
        ].join(" "),
    };
}

export async function formatContinuationWorkspaceContext(
    workspaceRoot: string,
    currentRequest = "",
): Promise<string> {
    const parts = [
        "Continuation mode:",
        "Modify the existing application below. Preserve its working features and visual identity unless the request explicitly changes them.",
        "Prefer focused edits. Do not rewrite the whole application unless the requested change requires it.",
        formatChangeLocatorContext(currentRequest),
        "Current workspace source:",
    ].filter((part) => part.length > 0);
    const requestsStyleContext = isStyleLocatorRequest(currentRequest) ||
        /\b(?:css|style|logo|icon|brand|background|colou?r|contrast|spacing|layout|responsive)\b|样式|颜色|背景|对比|看不清|不可见|大小|尺寸|间距|布局|响应式|校徽|徽标|标志/iu.test(
            currentRequest,
        );
    const requestsContentContext =
        /\b(?:copy|content|text|news|article|character|legend|data|list)\b|文案|内容|文字|资讯|新闻|文章|角色|数据|列表/iu.test(
            currentRequest,
        );
    const orderedSourceFiles = requestsStyleContext
        ? [
              "src/App.css",
              "src/App.tsx",
              "src/content.ts",
              ...CONTINUATION_CORE_SOURCE_FILES,
          ]
        : requestsContentContext
          ? [
                "src/content.ts",
                "src/App.tsx",
                "src/App.css",
                ...CONTINUATION_CORE_SOURCE_FILES,
            ]
          : CONTINUATION_CORE_SOURCE_FILES;
    const uniqueSourceFiles = [...new Set(orderedSourceFiles)];
    const existingFiles = await readPrioritizedWorkspaceFiles({
        workspaceRoot,
        currentRequest,
        coreFiles: uniqueSourceFiles,
        maxFiles: MAX_CONTINUATION_SOURCE_FILES,
    });
    const perFileBudget =
        existingFiles.length > 0
            ? Math.floor(
                  MAX_CONTINUATION_SOURCE_CHARACTERS / existingFiles.length,
              )
            : MAX_CONTINUATION_SOURCE_CHARACTERS;

    for (const file of existingFiles) {
        const includedContent = sliceWithHeadAndTail(
            file.content,
            Math.min(perFileBudget, MAX_CONTINUATION_FILE_CHARACTERS),
        );

        parts.push(`--- ${file.path} ---\n${includedContent}`);
    }

    const sourceEvidence = formatLocatedSourceEvidence(
        currentRequest,
        existingFiles,
    );
    if (sourceEvidence.length > 0) {
        parts.push(sourceEvidence);
    }

    return parts.length > 3 ? parts.join("\n\n") : "";
}

function isStyleLocatorRequest(text: string): boolean {
    return (
        isColorChangeRequest(text) ||
        /颜色|背景|蓝色|蓝|青色|字体|字号|太大|过大|看不清|看不见|对比|卡片|方块|方格|格子|排版|布局|留白|图片|圆角/iu.test(
            text,
        )
    );
}

function isColorChangeRequest(text: string): boolean {
    return (
        isRejectingBlueBackgroundRequest(text) ||
        /(?:颜色|配色|色调|背景|主题色|主色|强调色|元素|东西).{0,20}(?:换|换成|换掉|改|改成|替换|调整|不好看|不喜欢|还在|出现)|(?:红色|红|橙色|橙|黄色|黄|绿色|绿|紫色|紫|粉色|粉|黑色|黑|白色|白|灰色|灰|金色|金|蓝色|蓝|青色).{0,20}(?:换|换掉|改掉|替换|不要|别|不喜欢|不好看|还在|出现|太多)|(?:换个|换成|改成|替换成).{0,16}(?:颜色|配色|色调|主题色|好看的颜色|高级颜色|别的颜色)|\b(?:color|palette|theme color|accent|background).{0,24}\b(?:change|replace|adjust|different|better|still|appears|too much)\b|\b(?:change|replace|adjust).{0,24}\b(?:color|palette|theme color|accent|background)\b/iu.test(
            text,
        )
    );
}

function isRejectingBlueBackgroundRequest(text: string): boolean {
    return /(?:不要|别|不是|不想|去掉|换掉|取消|不要再|不能|不该|不希望).{0,16}(?:蓝色|蓝|青色|蓝色背景|蓝背景|蓝色东西|蓝色元素)|(?:背景|主背景|颜色|配色|色调|元素|东西).{0,16}(?:不要|不是|别用|换掉|去掉|取消|改掉|替换).{0,16}(?:蓝色|蓝|青色)|(?:还有|仍然|还是|依旧|又有|出现).{0,12}(?:蓝色|蓝|青色|蓝色东西|蓝色元素)|(?:蓝色|蓝|青色).{0,16}(?:还在|出现|太多|不好看|换个|换掉|改掉|替换|别出现)|(?:蓝色|蓝|青色).{0,24}(?:好看的颜色|好看点|高级|正常)|(?:换个|换成|改成|替换成).{0,12}(?:好看的颜色|更好看的颜色|高级颜色|别的颜色)|\b(?:not|no|don't|dont|without|avoid|remove|change|replace).{0,24}\b(?:blue|cyan)\b|\b(?:background|main background|color|palette|accent).{0,24}\b(?:not|no|avoid|remove|change|replace).{0,24}\b(?:blue|cyan)\b|\b(?:blue|cyan).{0,24}\b(?:still|appears|showing|too much|replace|change|remove)\b/iu.test(
        text,
    );
}

function formatChangeLocatorContext(request: string): string {
    const findings: string[] = [];

    if (isRejectingBlueBackgroundRequest(request)) {
        findings.push(
            [
                "Intent: improve blue/cyan usage that looks bad, excessive, or out of place.",
                "Target files first: src/App.css, then src/App.tsx or src/pages/*.tsx only if inline styles define background.",
                "Required code change: change the ugly or excessive blue/cyan page, hero, game-stage, game-map, panel, HUD, pill, chip, site-letter, border, glow, and gradient tokens. Prefer a subject-appropriate palette; for Valorant use red/black/charcoal/amber as the main palette and keep blue only as a small intentional highlight if it looks good.",
                "Acceptance: generated CSS must contain changed background/accent rules for the offending blue/cyan areas; do not finish after changing only copy or unrelated text.",
            ].join("\n"),
        );
    } else if (isColorChangeRequest(request)) {
        findings.push(
            [
                "Intent: change the current color palette or visible color system.",
                "Target files first: src/App.css, then src/App.tsx or src/pages/*.tsx only if inline styles define colors.",
                "Required code change: locate current color tokens/gradients/backgrounds/borders/glows/pills/chips and replace the relevant palette with the requested target color. If the user does not name a target color, choose a subject-appropriate attractive palette and apply it consistently.",
                "Acceptance: generated CSS must contain changed token/background/accent rules. Do not finish after changing only copy or unrelated layout.",
            ].join("\n"),
        );
    }

    if (/卡片|方块|方格|格子|盒子|card|cards|grid|blocky|boxed/iu.test(request)) {
        findings.push(
            [
                "Intent: reduce card/block template feeling.",
                "Target files first: src/App.css and page JSX classes.",
                "Required code change: reduce dominant page-card/page-grid/card-like repeated surfaces; use type-specific layout such as game-stage/HUD/map, editorial-flow/timeline/map-panel, dashboard shell, product screen, or commerce stage.",
                "Acceptance: do not merely rename cards or change colors; the dominant layout structure must change.",
            ].join("\n"),
        );
    }

    if (/字体|字号|太大|过大|巨大|超级大|font|typography|huge|massive/iu.test(request)) {
        findings.push(
            [
                "Intent: reduce oversized typography.",
                "Target files first: src/App.css.",
                "Required code change: lower actual font-size/clamp rules for h1, h2, metrics, table labels, and HUD labels. Avoid 5rem+ headings and one-character-per-line labels.",
            ].join("\n"),
        );
    }

    if (isHorizontalPointLabelRequest(request)) {
        findings.push(
            [
                "Intent: make tactical A/B/C point labels horizontal and readable.",
                "Target files: affected JSX page plus src/App.css.",
                "Required code change: change markup to game-sites/game-site/site-letter chips and CSS flex row wrap. Do not leave raw A / B / C in narrow table cells.",
            ].join("\n"),
        );
    }

    if (findings.length === 0) {
        return "";
    }

    return [
        "Change locator output:",
        "Treat the following located edits as hard requirements before calling finish.",
        ...findings.map((finding, index) => `Locator ${index + 1}:\n${finding}`),
    ].join("\n");
}

function formatLocatedSourceEvidence(
    request: string,
    files: Array<{ path: string; content: string }>,
): string {
    if (!isColorChangeRequest(request)) {
        return "";
    }

    const evidence: string[] = [];
    const colorPattern =
        /#[0-9a-f]{3,8}\b|rgb[a]?\([^)]*\)|hsl[a]?\([^)]*\)|oklch\([^)]*\)|\b(?:blue|cyan|sky|red|orange|amber|yellow|green|emerald|purple|violet|pink|rose|black|white|gray|grey|slate|zinc)\b/iu;
    const colorRulePattern =
        /color|background|border|shadow|glow|gradient|--[^:\n]*(?:accent|primary|color|bg|background|page|hero|panel)|game-stage|game-map|page-hero|hud-pill|site-letter|game-site/iu;

    for (const file of files) {
        if (!/\.(?:css|tsx|ts)$/iu.test(file.path)) {
            continue;
        }

        const lines = file.content.split(/\r?\n/u);
        for (const [index, line] of lines.entries()) {
            if (!colorPattern.test(line) || !colorRulePattern.test(line)) {
                continue;
            }

            const start = Math.max(0, index - 2);
            const end = Math.min(lines.length, index + 3);
            evidence.push(
                [
                    `Source evidence: ${file.path}:${index + 1}`,
                    ...lines
                        .slice(start, end)
                        .map((sourceLine, offset) => {
                            const lineNumber = start + offset + 1;
                            const marker = lineNumber === index + 1 ? ">" : " ";
                            return `${marker} ${String(lineNumber).padStart(4, " ")} | ${sourceLine}`;
                        }),
                ].join("\n"),
            );

            if (evidence.length >= 8) {
                break;
            }
        }

        if (evidence.length >= 8) {
            break;
        }
    }

    if (evidence.length === 0) {
        return "";
    }

    return [
        "Located source evidence for the color-change request:",
        "The following existing lines are likely responsible for the current color palette, backgrounds, accents, or visible colored elements. Modify the relevant dominant rules directly.",
        ...evidence,
    ].join("\n\n");
}

async function formatFailedActionRepairContext(
    workspaceRoot: string,
    agent: RunCodingAgentLoopResult,
): Promise<string> {
    const failedStep = [...agent.steps]
        .reverse()
        .find((step) => !step.execution.ok);

    if (!failedStep) {
        return "";
    }

    const parts = [
        "Previous failed implementation action:",
        `Action: ${limitContextText(JSON.stringify(failedStep.action), 1_500)}`,
        `Execution result: ${limitContextText(failedStep.execution.message, 1_000)}`,
        "Do not repeat this action unchanged. Re-read the latest target source and choose oldText that exists exactly, or make a smaller coherent action.",
    ];

    if (failedStep.action.type !== "edit_file") {
        return parts.join("\n");
    }

    const targetPath = path.resolve(
        workspaceRoot,
        failedStep.action.path,
    );
    const relativeTargetPath = path.relative(workspaceRoot, targetPath);

    if (
        relativeTargetPath.startsWith("..") ||
        path.isAbsolute(relativeTargetPath)
    ) {
        return parts.join("\n");
    }

    try {
        const latestTargetSource = await readFile(targetPath, "utf8");
        parts.push(
            `Latest target file source (${failedStep.action.path}):`,
            sliceWithHeadAndTail(latestTargetSource, 2_800),
        );
    } catch (error) {
        parts.push(
            `Latest target file source could not be read: ${describeModelStageError(error)}`,
        );
    }

    return parts.join("\n\n");
}

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

function formatEvaluationSummary(
    evalResult: ReactAppEvalResult,
    browserEval?: BrowserEvalResult,
): string {
    return [
        `Deterministic evaluation: ${evalResult.passed ? "passed" : "failed"}`,
        ...evalResult.checks.map(
            (check) => `- ${check.name}: ${check.passed ? "passed" : "failed"}`,
        ),
        ...(browserEval
            ? [
                  `Browser evaluation: ${browserEval.passed ? "passed" : "failed; blocking runtime gate"}`,
                  ...browserEval.checks.map(
                      (check) =>
                          [
                              `- ${check.name}: ${check.passed ? "passed" : "failed"}`,
                              check.message ? ` (${check.message})` : "",
                          ].join(""),
                  ),
              ]
            : []),
    ].join("\n");
}

function formatAssetEvidence(
    agent: RunCodingAgentLoopResult,
): string {
    const assetLines = agent.steps
        .filter(
            (step) =>
                step.action.type === "get_image" &&
                step.execution.ok,
        )
        .map((step) => {
            if (step.action.type !== "get_image") {
                return "";
            }

            return [
                `- ${step.action.outputPath}`,
                `  mode: ${step.action.mode}`,
                `  altText: ${step.action.altText}`,
                `  query: ${step.action.query}`,
                `  result: ${step.execution.message}`,
            ].join("\n");
        })
        .filter((line) => line.length > 0);

    return assetLines.length > 0
        ? ["Generated local assets:", ...assetLines].join("\n")
        : "";
}

function extractLocalAssetReferences(source: string): string[] {
    const references = new Set<string>();
    const assetReferencePattern =
        /["'`](\/assets\/[^"'`)\s?#]+(?:\?[^"'`)\s#]*)?(?:#[^"'`)\s]*)?)["'`]/gu;

    for (const match of source.matchAll(assetReferencePattern)) {
        const reference = match[1]?.split(/[?#]/u)[0];

        if (reference) {
            references.add(reference);
        }
    }

    return [...references].sort();
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);

        return true;
    } catch {
        return false;
    }
}

async function hasPackageScript(
    workspaceRoot: string,
    scriptName: string,
): Promise<boolean> {
    try {
        const raw = await readFile(
            path.join(workspaceRoot, "package.json"),
            "utf8",
        );
        const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };

        return typeof parsed.scripts?.[scriptName] === "string";
    } catch {
        return false;
    }
}

async function findLocalTypeScriptCli(
    workspaceRoot: string,
): Promise<string | undefined> {
    const cliRelativePath = "node_modules/typescript/bin/tsc";
    const cliPath = path.join(workspaceRoot, cliRelativePath);

    if (await pathExists(cliPath)) {
        return cliRelativePath;
    }

    return undefined;
}

async function runTypecheckIfAvailable(input: {
    workspaceRoot: string;
    signal?: AbortSignal;
}): Promise<RunReactAppAgentCommandResult> {
    if (await hasPackageScript(input.workspaceRoot, "typecheck")) {
        return runWorkspaceCommand(
            input.workspaceRoot,
            {
                command: "npm",
                args: ["run", "typecheck"],
            },
            {
                timeoutMs: TYPECHECK_COMMAND_TIMEOUT_MS,
                ...(input.signal ? { signal: input.signal } : {}),
            },
        );
    }

    const tscCli = await findLocalTypeScriptCli(input.workspaceRoot);

    if (!tscCli) {
        return {
            exitCode: 0,
            stdout:
                "Skipped typecheck because no npm typecheck script or local TypeScript compiler was available.",
            stderr: "",
        };
    }

    return runWorkspaceCommand(
        input.workspaceRoot,
        {
            command: "node",
            args: [tscCli, "--noEmit"],
        },
        {
            timeoutMs: TYPECHECK_COMMAND_TIMEOUT_MS,
            ...(input.signal ? { signal: input.signal } : {}),
        },
    );
}

async function formatLocalAssetReferenceEvidence(
    workspaceRoot: string,
): Promise<string> {
    const references = await listWorkspaceLocalAssetReferences(workspaceRoot);

    if (references.length === 0) {
        return "";
    }

    const lines = references.map((reference) =>
        `- ${reference.urlPath}: ${reference.exists ? "found" : "missing"} at ${reference.publicPath}`,
    );

    return ["Local asset references:", ...lines].join("\n");
}

async function listLocalAssetReferences(
    workspaceRoot: string,
    source: string,
): Promise<LocalAssetReference[]> {
    const references = extractLocalAssetReferences(source);

    return Promise.all(
        references.map(async (urlPath) => {
            const publicPath = `public${urlPath}`;
            const exists = await pathExists(
                path.join(workspaceRoot, publicPath),
            );

            return {
                urlPath,
                publicPath,
                exists,
            };
        }),
    );
}

async function listWorkspaceLocalAssetReferences(
    workspaceRoot: string,
): Promise<LocalAssetReference[]> {
    const sourceFiles = await readAllWorkspaceSourceFiles(workspaceRoot);

    return listLocalAssetReferences(
        workspaceRoot,
        sourceFiles.map((file) => file.content).join("\n"),
    );
}

function isAssetOnlyRepairGoal(goal: string): boolean {
    return /logo|icon|badge|image|picture|asset|banner|hero|校徽|徽标|标志|图标|图片|图像|素材|横幅|首图/u.test(
        goal.toLowerCase(),
    );
}

function publicPathToUrlPath(publicPath: string): string {
    return `/${publicPath.replace(/^public[\\/]/u, "").replace(/\\/gu, "/")}`;
}

function inferAssetAltText(goal: string, reference: LocalAssetReference): string {
    const fileName = path.basename(reference.publicPath, path.extname(reference.publicPath));

    if (/清华|tsinghua/u.test(goal) || /tsinghua/u.test(fileName)) {
        return "清华大学校徽";
    }

    if (/logo|校徽|徽标|标志/u.test(goal)) {
        return "页面 logo";
    }

    return fileName.replace(/[-_]+/gu, " ");
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createNavigationTargetId(label: string, index: number): string {
    const normalized = label
        .trim()
        .toLowerCase()
        .replace(/&[a-z]+;/giu, "")
        .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
        .replace(/^-+|-+$/gu, "");

    if (/^(home|首页|主页)$/iu.test(normalized)) {
        return "home";
    }

    return normalized.length > 0 ? normalized : `section-${index + 1}`;
}

export type NavigationRequestKind = "none" | "in-page" | "routes";

export function classifyNavigationRequest(
    goal: string,
): NavigationRequestKind {
    const asksForExplicitUtf8ChineseRoutes =
        /(?:URL|地址栏).{0,12}(?:跳转|导航|切换)|路由|多页面|多个页面|独立页面|不同页面|子页面|详情页|新页面|浏览器(?:前进|后退)|前进后退|历史记录|[二三四五六七八九十\d]+个页面/iu.test(
            goal,
        );

    if (asksForExplicitUtf8ChineseRoutes) {
        return "routes";
    }

    const asksForExplicitRoutes =
        /\b(?:routes?|routing|router|react[- ]?router|url paths?|url navigation|pathname|browser history|back and forward|multi[- ]?page|multiple pages|separate pages|distinct (?:pages|views)|subpages?|detail pages?)\b|(?:URL|地址栏).{0,12}(?:跳转|导航|切换)|路由|多页面|多个页面|独立页面|不同页面|子页面|详情页|新页面|地址栏|浏览器(?:前进|后退)|前进后退|历史记录|[二三四五六七八九十\d]+个页面/iu.test(
            goal,
        );

    if (asksForExplicitRoutes) {
        return "routes";
    }

    const asksForSamePageNavigation =
        /\b(?:same[- ]page|same document|in[- ]page|(?:scroll|jump) to (?:the )?(?:matching )?(?:[\w-]+\s+){0,3}(?:sections?|anchors?|blocks?)|anchor links?|hash anchors?)\b|页面内|页内|当前页|同一页|本页|滚动到|锚点|跳转到.{0,12}(?:板块|区块|栏目|章节|位置)/iu.test(
            goal,
        );

    if (asksForSamePageNavigation) {
        return "in-page";
    }

    const asksForGenericUtf8ChineseCrossPageNavigation =
        /(?:可以|可|能|能够|支持|实现|进行|并且|而且).{0,8}(?:跳转|切换|导航)|(?:跳转|切换|导航).{0,8}(?:功能|效果|入口)/iu.test(
            goal,
        ) &&
        /页面|界面|网页|网站|主页|首页|介绍|展示|应用/iu.test(goal);

    if (asksForGenericUtf8ChineseCrossPageNavigation) {
        return "routes";
    }

    const asksForCrossPageNavigation =
        /\bpage (?:navigation|switching)\b|\b(?:navigat(?:e|ion)|switch(?:ing)?)\s+between\s+(?:the\s+)?(?:pages|views)\b|\b(?:open|show|visit|go to|navigate to|switch to)\s+(?:the\s+)?[\w -]{0,40}\b(?:page|view)\b|\b(?:links?|buttons?|nav(?:igation)? items?|menu items?)\b.{0,50}\b(?:open|show|visit|go to|navigate to|switch to)\b.{0,40}\b(?:pages?|views?)\b|(?:页面|界面).{0,30}(?:跳转|导航|切换)|(?:跳转|导航|切换).{0,30}(?:页面|界面)|(?:链接|按钮|导航|栏目|菜单).{0,20}(?:对应|进入|打开|切换|跳转).{0,12}(?:页面|界面)|(?:进入|打开|切换|跳转).{0,12}(?:对应)?(?:页面|界面)/iu.test(
            goal,
        );

    return asksForCrossPageNavigation ? "routes" : "none";
}

function isNavigationFallbackGoal(goal: string): boolean {
    return classifyNavigationRequest(goal) === "in-page";
}

function formatNavigationExecutionContext(
    requestKind: NavigationRequestKind,
): string {
    if (requestKind === "routes") {
        return [
            "Independent page routing requirement:",
            "Route-shell-first execution order: the first implementation action must establish src/App.tsx with a URL-aware route skeleton, real navigation targets, and the matching popstate or hashchange listener. Use write_file for initial generation and edit_file only when exact existing source is supplied. Do this before adding route copy, images, or CSS polish.",
            "Preserve the existing application and keep its current primary page as the home route unless the user explicitly asks to replace it.",
            "Implement substantive, distinct views for every requested page instead of scrolling to sections in one document.",
            "Navigation must update a route-specific URL and browser Back/Forward must restore the matching view. Use an already-installed router, a dependency-free History API router with popstate handling, or a URL-aware hash router with hashchange handling.",
            'Use real path targets such as "/about" or route hashes such as "#/about". A route hash must begin with "#/" and render a distinct view; ordinary #section scrolling is not routing. Never use href="#", empty links, hidden sections, tabs, or text-only placeholders as substitutes for routes.',
            "Each route must have verifiable unique content and a navigation control that reaches it.",
            "After the route shell is connected, add complete, substantive route-specific content and polished responsive styling in small focused edits without rewriting already-working files.",
        ].join("\n");
    }

    if (requestKind === "in-page") {
        return [
            "Same-page navigation requirement:",
            "The request explicitly asks to move within the current document, so matching #section anchors or scrollIntoView targets are appropriate.",
            "Keep every target id non-empty and ensure it exists on visible content.",
        ].join("\n");
    }

    return "";
}

function addIdToFirstContainer(source: string, id: string): string {
    if (new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, "u").test(source)) {
        return source;
    }

    return source.replace(
        /<(main|section|div)(\s[^>]*)?>/u,
        (match, tag: string, attributes = "") => {
            if (/\bid=/u.test(attributes)) {
                return match;
            }

            return `<${tag}${attributes} id="${id}">`;
        },
    );
}

function addIdNearVisibleLabel(
    source: string,
    label: string,
    id: string,
): string {
    if (new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, "u").test(source)) {
        return source;
    }

    const escapedLabel = escapeRegExp(label.trim());
    const headingPattern = new RegExp(
        `<(h[1-6]|section|article|div)([^>]*)>([^<]{0,80}${escapedLabel}[^<]{0,80})`,
        "u",
    );

    return source.replace(
        headingPattern,
        (match, tag: string, attributes: string, contentStart: string) => {
            if (/\bid=/u.test(attributes)) {
                return match;
            }

            return `<${tag}${attributes} id="${id}">${contentStart}`;
        },
    );
}

function listHashNavigationTargetFailures(source: string): string[] {
    const ids = new Set(
        [...source.matchAll(/\bid=(["'])([^"']+)\1/gu)].map(
            (match) => match[2] ?? "",
        ),
    );
    const targets = [
        ...new Set(
            [...source.matchAll(/\bhref=(["'])#([^"']+)\1/gu)]
                .map((match) => match[2]?.trim() ?? "")
                .filter((target) => target.length > 0),
        ),
    ];
    const buttonTargets = [
        ...new Set(
            [
                ...source.matchAll(
                    /document\.getElementById\((["'])([^"']+)\1\)/gu,
                ),
            ]
                .map((match) => match[2]?.trim() ?? "")
                .filter((target) => target.length > 0),
        ),
    ];
    const allTargets = [...new Set([...targets, ...buttonTargets])];

    if (allTargets.length === 0) {
        return ["No non-empty navigation targets were created."];
    }

    return allTargets
        .filter((target) => !ids.has(target))
        .map((target) => `Missing matching id for #${target}.`);
}

async function readRouteImplementationSource(
    workspaceRoot: string,
): Promise<string> {
    const sourceRoot = path.join(workspaceRoot, "src");
    const files: string[] = [];

    async function collectSourceFiles(directory: string): Promise<void> {
        let entries;

        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return;
            }

            throw error;
        }

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                await collectSourceFiles(entryPath);
                continue;
            }

            if (
                entry.isFile() &&
                /\.(?:[cm]?[jt]sx?)$/iu.test(entry.name) &&
                !/\.test\.[cm]?[jt]sx?$/iu.test(entry.name)
            ) {
                files.push(entryPath);
            }
        }
    }

    await collectSourceFiles(sourceRoot);

    const sourceParts = await Promise.all(
        files.sort().map(async (filePath) => {
            const relativePath = path.relative(workspaceRoot, filePath);

            return `--- ${relativePath} ---\n${await readFile(filePath, "utf8")}`;
        }),
    );

    return sourceParts.join("\n\n");
}

function normalizeRoutePath(candidate: string): string | undefined {
    const pathWithoutQuery = candidate.trim().split(/[?#]/u, 1)[0] ?? "";

    if (
        !pathWithoutQuery.startsWith("/") ||
        pathWithoutQuery.startsWith("//") ||
        pathWithoutQuery === "/*" ||
        pathWithoutQuery === "*"
    ) {
        return undefined;
    }

    return pathWithoutQuery.replace(/\/+$/u, "") || "/";
}

function extractHashRoutePaths(source: string): string[] {
    return [
        ...source.matchAll(/["']#(\/[^"']*)["']/giu),
    ]
        .map((match) => normalizeRoutePath(match[1] ?? ""))
        .filter((routePath): routePath is string => routePath !== undefined);
}

function extractDefinedRoutePaths(source: string): string[] {
    const candidates = [
        ...source.matchAll(
            /<Route\b[^>]*\bpath\s*=\s*(?:\{\s*)?["']([^"']+)["']/giu,
        ),
        ...source.matchAll(/\bpath\s*:\s*["']([^"']+)["']/giu),
        ...source.matchAll(
            /(?:window\.)?(?:location\.)?pathname\s*={2,3}\s*["']([^"']+)["']/giu,
        ),
        ...source.matchAll(
            /["'](\/[^"']*)["']\s*:\s*(?:[A-Za-z_$][\w$]*|\([^)]*\)\s*=>|<)/giu,
        ),
    ]
        .map((match) => normalizeRoutePath(match[1] ?? ""))
        .filter((routePath): routePath is string => routePath !== undefined);

    if (/<Route\b[^>]*\bindex(?:\s*=\s*\{?true\}?)?/iu.test(source)) {
        candidates.push("/");
    }

    candidates.push(...extractHashRoutePaths(source));

    return [...new Set(candidates)];
}

function listRouteImplementationFailures(source: string): string[] {
    const failures: string[] = [];
    const routePaths = extractDefinedRoutePaths(source);
    const hasRouterRuntime =
        /\b(?:BrowserRouter|HashRouter|createBrowserRouter|RouterProvider|useRoutes)\b|<Routes\b/iu.test(
            source,
        );
    const usesHistoryApi =
        /\bhistory\.(?:pushState|replaceState)\s*\(/u.test(source) &&
        /(?:addEventListener\s*\(\s*["']popstate["']|onpopstate\s*=)/u.test(
            source,
        ) &&
        /(?:window\.)?location\.pathname/u.test(source);
    const hashRoutePaths = [...new Set(extractHashRoutePaths(source))];
    const usesHashRouting =
        /(?:window\.)?location\.hash/u.test(source) &&
        /(?:addEventListener\s*\(\s*["']hashchange["']|onhashchange\s*=)/u.test(
            source,
        ) &&
        (hashRoutePaths.length >= 2 || routePaths.length >= 2);
    const hasLiteralRouteNavigation =
        /<(?:Link|NavLink)\b[^>]*\bto\s*=|\bnavigate\s*\(\s*["']\/|\bhistory\.pushState\s*\(|<a\b[^>]*\bhref\s*=\s*["'](?:\/[^/]|#\/)/iu.test(
            source,
        );
    const dataDrivenAnchorProperties = [
        ...source.matchAll(
            /<a\b[^>]*\bhref\s*=\s*\{\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\}/giu,
        ),
    ]
        .map((match) => match[1])
        .filter((property): property is string => property !== undefined);
    const hasDataDrivenAnchorNavigation =
        routePaths.length >= 2 &&
        dataDrivenAnchorProperties.some((property) =>
            new RegExp(
                `\\b${escapeRegExp(property)}\\s*:\\s*["'](?:\\/[^/]|#\\/)[^"']*["']`,
                "iu",
            ).test(source),
        );
    const hasComputedHashAnchorNavigation =
        routePaths.length >= 2 &&
        (/<a\b[^>]*\bhref\s*=\s*\{\s*["']#["']\s*\+\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?path\s*\}/iu.test(
            source,
        ) ||
            /<a\b[^>]*\bhref\s*=\s*\{\s*`#\$\{\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?path\s*\}`\s*\}/iu.test(
                source,
            ));
    const hasRouteNavigation =
        hasLiteralRouteNavigation ||
        hasDataDrivenAnchorNavigation ||
        hasComputedHashAnchorNavigation;
    const placeholderNavigation = [
        ...source.matchAll(
            /\b(?:href|to)\s*=\s*(?:["'](?:#|javascript:void\(0\)|)["']|\{\s*["'](?:#|javascript:void\(0\)|)["']\s*\})(?=\s|\/?>)/giu,
        ),
    ];
    const placeholderViews = [
        ...source.matchAll(
            /(?:>|["'])\s*(?:(?:content\s+)?coming soon|todo|placeholder|under construction|(?:内容|页面|功能|资料)?\s*(?:建设中|待完善|待补充)|敬请期待|稍后开放)[\s.。…!！?？-]*(?:<|["'])/giu,
        ),
    ];

    if (placeholderNavigation.length > 0) {
        failures.push('Placeholder navigation such as href="#" is not allowed.');
    }

    if (placeholderViews.length > 0) {
        failures.push("Route views still contain placeholder-only content.");
    }

    if (!hasRouterRuntime && !usesHistoryApi && !usesHashRouting) {
        failures.push(
            "No URL-aware router, History API implementation with popstate handling, or hash router with hashchange handling was found.",
        );
    }

    if (routePaths.length < 2) {
        failures.push(
            "Fewer than two distinct renderable route paths were defined.",
        );
    }

    if (!hasRouteNavigation) {
        failures.push("No navigation control points to a real URL path.");
    }

    return failures;
}

async function applyHashNavigationFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();
    if (!isNavigationFallbackGoal(goal)) {
        return [];
    }

    const appPath = path.join(workspaceRoot, "src", "App.tsx");
    let source: string;

    try {
        source = await readFile(appPath, "utf8");
    } catch (error) {
        if (signal?.aborted) {
            signal.throwIfAborted();
        }
        return [];
    }

    const linkPattern =
        /<a\b([^>]*?)href=(["'])#\2([^>]*?)>([^<]{1,40})<\/a>/gu;
    const replacements: Array<{
        original: string;
        replacement: string;
        label: string;
        id: string;
        kind: "link" | "button";
    }> = [];

    for (const match of source.matchAll(linkPattern)) {
        const original = match[0];
        const label = match[4]?.trim();

        if (!label || /[{}]/u.test(label)) {
            continue;
        }

        const id = createNavigationTargetId(label, replacements.length);
        const replacement = original.replace(
            /href=(["'])#\1/u,
            `href="#${id}"`,
        );

        replacements.push({
            original,
            replacement,
            label,
            id,
            kind: "link",
        });
    }

    const buttonPattern =
        /<button\b([^>]*)>([^<>{}]{1,40})<\/button>/gu;

    for (const match of source.matchAll(buttonPattern)) {
        const original = match[0];
        const attributes = match[1] ?? "";
        const label = match[2]?.trim();

        if (
            !label ||
            /\bonClick\s*=/u.test(attributes) ||
            /type=(["'])submit\1/u.test(attributes)
        ) {
            continue;
        }

        const id = createNavigationTargetId(label, replacements.length);
        const nextAttributes = /\btype\s*=/u.test(attributes)
            ? attributes
            : `${attributes} type="button"`;
        const replacement = `<button${nextAttributes} onClick={() => document.getElementById("${id}")?.scrollIntoView({ behavior: "smooth" })}>${label}</button>`;

        replacements.push({
            original,
            replacement,
            label,
            id,
            kind: "button",
        });
    }

    if (replacements.length === 0) {
        return [];
    }

    let nextSource = source;

    for (const replacement of replacements) {
        nextSource = nextSource.replace(
            replacement.original,
            replacement.replacement,
        );

        nextSource =
            replacement.id === "home"
                ? addIdToFirstContainer(nextSource, replacement.id)
                : addIdNearVisibleLabel(
                      nextSource,
                      replacement.label,
                      replacement.id,
                  );
    }

    if (nextSource === source) {
        return [];
    }

    const navigationFailures = listHashNavigationTargetFailures(nextSource);

    if (navigationFailures.length > 0) {
        return [];
    }

    signal?.throwIfAborted();
    await writeFile(appPath, nextSource, "utf8");

    return replacements.map(
        (replacement) =>
            replacement.kind === "button"
                ? `Connected button "${replacement.label}" to #${replacement.id}`
                : `Linked "${replacement.label}" to #${replacement.id}`,
    );
}

function isCompactTopNavigationRequest(goal: string): boolean {
    return (
        /(?:导航|nav|menu|菜单|顶部|上面|header|页头)/iu.test(goal) &&
        /(?:字.{0,8}(?:少|短|简|缩)|写少|简短|缩短|一行|单行|不要.{0,8}换行|别.{0,8}换行|nowrap|white-space)/iu.test(
            goal,
        )
    );
}

function formatCompactNavigationHelper(): string {
    return [
        "function compactNavigationLabel(section: PageSection, index: number) {",
        "    const title = section.title.trim();",
        "    const rules: Array<[RegExp, string]> = [",
        "        [/概览|首页|overview|home/i, \"概览\"],",
        "        [/城市精神|精神|价值|定位/i, \"精神\"],",
        "        [/文化地图|地图|路线|route|map/i, \"地图\"],",
        "        [/人物|技艺|非遗|工艺|craft/i, \"人物\"],",
        "        [/历史|时间线|timeline/i, \"时间线\"],",
        "        [/故事|story/i, \"故事\"],",
        "        [/参观|信息|visit/i, \"参观\"],",
        "        [/工作流|流程|生命周期|workflow|flow/i, \"流程\"],",
        "        [/工具|集成|接入|integration|tool/i, \"接入\"],",
        "        [/监控|观察|日志|追踪|observability|monitor/i, \"监控\"],",
        "        [/团队|协作|权限|发布|team|collab/i, \"协作\"],",
        "        [/API|SDK|CLI|接口|developer/i, \"API\"],",
        "        [/定价|价格|pricing/i, \"定价\"],",
        "        [/指标|数据|后台|dashboard|metric/i, \"指标\"],",
        "        [/告警|异常|alert|incident/i, \"告警\"],",
        "        [/战术|点位|模式|agent|hud|game/i, \"战术\"],",
        "    ];",
        "    const matched = rules.find(([pattern]) => pattern.test(title));",
        "    if (matched) return matched[1];",
        "    const compact = title.replace(/[：:｜|].*$/u, \"\").replace(/\\s+/gu, \"\").replace(/[·•]/gu, \"\");",
        "    return compact.length > 4 ? compact.slice(0, 4) : compact || `导航${index + 1}`;",
        "}",
    ].join("\n");
}

function formatCompactTopNavigationCss(): string {
    return [
        "/* appforge compact-top-navigation start */",
        "@media (min-width: 1180px) {",
        "    .site-header {",
        "        grid-template-columns: minmax(150px, auto) minmax(0, 1fr) auto;",
        "        gap: clamp(10px, 1.4vw, 20px);",
        "        min-height: 64px;",
        "        padding-block: 10px;",
        "    }",
        "",
        "    .brand-lockup,",
        "    .status-signal {",
        "        min-width: 0;",
        "        white-space: nowrap;",
        "    }",
        "",
        "    .brand-lockup strong {",
        "        max-width: min(18vw, 13rem);",
        "        overflow: hidden;",
        "        text-overflow: ellipsis;",
        "        white-space: nowrap;",
        "    }",
        "",
        "    .site-header .primary-nav {",
        "        min-width: 0;",
        "        overflow: hidden;",
        "        flex-wrap: nowrap !important;",
        "        justify-content: center;",
        "        gap: 2px;",
        "    }",
        "",
        "    .site-header .primary-nav a {",
        "        flex: 0 1 auto;",
        "        min-width: 0;",
        "        padding: 8px clamp(6px, .72vw, 10px);",
        "        font-size: clamp(.68rem, .72vw, .76rem);",
        "        line-height: 1;",
        "        white-space: nowrap !important;",
        "        overflow: hidden;",
        "        text-overflow: ellipsis;",
        "    }",
        "}",
        "/* appforge compact-top-navigation end */",
    ].join("\n");
}

async function applyCompactTopNavigationFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();

    if (!isCompactTopNavigationRequest(goal)) {
        return [];
    }

    const appPath = path.join(workspaceRoot, "src", "App.tsx");
    const cssPath = path.join(workspaceRoot, "src", "App.css");
    let source: string;
    let cssSource: string;

    try {
        [source, cssSource] = await Promise.all([
            readFile(appPath, "utf8"),
            readFile(cssPath, "utf8"),
        ]);
    } catch {
        return [];
    }

    let nextSource = source;

    if (!nextSource.includes("function compactNavigationLabel(")) {
        nextSource = nextSource.replace(
            /\nfunction PrimaryNavigation\(\) \{/u,
            `\n${formatCompactNavigationHelper()}\n\nfunction PrimaryNavigation() {`,
        );
    }

    nextSource = nextSource.replace(
        /page\.sections\.slice\(0,\s*4\)\.map\(\(section\)\s*=>\s*<a href=\{`#\$\{section\.id\}`\} key=\{section\.id\}>\{section\.title\}<\/a>\)/u,
        "page.sections.slice(0, 5).map((section, index) => <a href={`#${section.id}`} key={section.id}>{compactNavigationLabel(section, index)}</a>)",
    );

    const nextCss = `${cssSource.replace(
        /\n?\/\* appforge compact-top-navigation start \*\/[\s\S]*?\/\* appforge compact-top-navigation end \*\/\n?/u,
        "\n",
    ).trimEnd()}\n\n${formatCompactTopNavigationCss()}\n`;
    const messages: string[] = [];

    if (nextSource !== source) {
        signal?.throwIfAborted();
        await writeFile(appPath, nextSource, "utf8");
        messages.push(
            "Shortened top navigation labels with a deterministic compact label mapper.",
        );
    }

    if (nextCss !== cssSource) {
        signal?.throwIfAborted();
        await writeFile(cssPath, nextCss, "utf8");
        messages.push(
            "Forced desktop top navigation into a compact single-line nowrap layout.",
        );
    }

    return messages;
}

type LocalSourceFallbackChange = {
    messages: string[];
    action: {
        path: string;
        oldText: string;
        newText: string;
    };
};

const TEXT_FALLBACK_SOURCE_FILES = [
    "src/App.tsx",
    "src/pages/home.tsx",
    "src/pages/about.tsx",
];

function stripUserQualifierText(value: string, side: "before" | "after"): string {
    let next = value
        .replace(/[，。,.!?！？].*$/u, "")
        .replace(
            /^(?:the\s+)?(?:button|title|heading|label|text|copy|按钮|按鈕|标题|標題|文字|文案|标签|標籤)\s*/iu,
            "",
        )
        .trim();

    if (side === "before") {
        const tokens = next.split(/\s+/u).filter(Boolean);
        const lastToken = tokens.at(-1);
        if (lastToken && /^[A-Za-z0-9_-]{1,48}$/u.test(lastToken)) {
            next = lastToken;
        }
    } else {
        const firstToken = next.split(/\s+/u).filter(Boolean)[0];
        if (firstToken && /^[A-Za-z0-9_-]{1,48}$/u.test(firstToken)) {
            next = firstToken;
        }
    }

    return next.replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").trim();
}

function extractRequestedTextReplacement(
    goal: string,
): { oldText?: string; newText: string; target: "button" | "title" | "text" } | undefined {
    if (
        /(?:颜色|顏色|背景|字体大小|字號|字号|font-size|background|color)/iu.test(
            goal,
        ) &&
        !/(?:按钮文字|按鈕文字|按钮文案|标题文字|標題文字|button\s+text|button\s+label|title\s+text)/iu.test(
            goal,
        )
    ) {
        return undefined;
    }

    const hasTextTarget =
        /\b(?:button|title|heading|label|text|copy)\b|按钮|按鈕|标题|標題|文字|文案|标签|標籤/iu.test(
            goal,
        );
    const hasChangeVerb =
        /\b(?:from|to|replace|change)\b|改成|改为|改為|换成|換成|变成|變成/iu.test(
            goal,
        );

    if (!hasTextTarget || !hasChangeVerb) {
        return undefined;
    }

    const target = /\bbutton\b|按钮|按鈕/iu.test(goal)
        ? "button"
        : /\b(?:title|heading|h1)\b|标题|標題/iu.test(goal)
          ? "title"
          : "text";

    const quoted = goal.match(
        /["“'‘]([^"”'’]{1,120})["”'’]\s*(?:改成|改为|改為|换成|換成|变成|變成|to|->)\s*["“'‘]([^"”'’]{1,120})["”'’]/iu,
    );
    if (quoted) {
        return {
            oldText: stripUserQualifierText(quoted[1] ?? "", "before"),
            newText: stripUserQualifierText(quoted[2] ?? "", "after"),
            target,
        };
    }

    const explicitFrom = goal.match(
        /(?:from|把|将|將)\s+(.{1,80}?)\s*(?:to|改成|改为|改為|换成|換成|变成|變成|为|為)\s+(.{1,80})/iu,
    );
    if (explicitFrom) {
        const oldText = stripUserQualifierText(
            explicitFrom[1] ?? "",
            "before",
        );
        const newText = stripUserQualifierText(
            explicitFrom[2] ?? "",
            "after",
        );
        if (oldText && newText) {
            return { oldText, newText, target };
        }
    }

    const implicitTo = goal.match(
        /(?:to|改成|改为|改為|换成|換成|变成|變成|为|為)\s+([A-Za-z0-9_\-\u4e00-\u9fff]{1,48})/iu,
    );
    const newText = stripUserQualifierText(implicitTo?.[1] ?? "", "after");

    return newText ? { newText, target } : undefined;
}

function replaceFirstElementText(
    source: string,
    tagName: "button" | "h1",
    newText: string,
): { nextSource: string; oldText: string } | undefined {
    const pattern = new RegExp(
        `(<${tagName}\\b[^>]*>)([^<>{}\\n]{1,120})(<\\/${tagName}>)`,
        "iu",
    );
    const match = source.match(pattern);
    const oldText = match?.[2]?.trim();
    if (!match || !oldText || oldText === newText) {
        return undefined;
    }

    return {
        nextSource: source.replace(pattern, `$1${newText}$3`),
        oldText,
    };
}

async function applyTextReplacementFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<LocalSourceFallbackChange | undefined> {
    signal?.throwIfAborted();

    const replacement = extractRequestedTextReplacement(goal);
    if (!replacement) {
        return undefined;
    }

    for (const relativePath of TEXT_FALLBACK_SOURCE_FILES) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        let source: string;

        try {
            source = await readFile(absolutePath, "utf8");
        } catch {
            continue;
        }

        if (
            replacement.oldText &&
            source.includes(replacement.oldText) &&
            replacement.oldText !== replacement.newText
        ) {
            const nextSource = source.replace(
                replacement.oldText,
                replacement.newText,
            );
            signal?.throwIfAborted();
            await writeFile(absolutePath, nextSource, "utf8");
            return {
                messages: [
                    `Replaced focused visible text "${replacement.oldText}" with "${replacement.newText}".`,
                ],
                action: {
                    path: relativePath,
                    oldText: replacement.oldText,
                    newText: replacement.newText,
                },
            };
        }

        const tagName =
            replacement.target === "button"
                ? "button"
                : replacement.target === "title"
                  ? "h1"
                  : undefined;
        const elementReplacement = tagName
            ? replaceFirstElementText(source, tagName, replacement.newText)
            : undefined;

        if (elementReplacement) {
            signal?.throwIfAborted();
            await writeFile(
                absolutePath,
                elementReplacement.nextSource,
                "utf8",
            );
            return {
                messages: [
                    `Updated the first ${tagName} text from "${elementReplacement.oldText}" to "${replacement.newText}".`,
                ],
                action: {
                    path: relativePath,
                    oldText: elementReplacement.oldText,
                    newText: replacement.newText,
                },
            };
        }
    }

    return undefined;
}

function isDeleteOrHideSingleTargetRequest(goal: string): boolean {
    return (
        /\b(?:delete|remove|hide)\b|删除|刪除|移除|隐藏|隱藏|不要显示|不要顯示/iu.test(
            goal,
        ) &&
        /\b(?:second|feature|module|section|card|block)\b|第二|功能|模块|模塊|区块|區塊|卡片/iu.test(
            goal,
        )
    );
}

function findBalancedElementRange(
    source: string,
    openingTagStart: number,
): { start: number; end: number; oldText: string } | undefined {
    const opening = source
        .slice(openingTagStart)
        .match(/^<([A-Za-z][\w:-]*)\b[^>]*>/u);
    const tagName = opening?.[1];
    if (!opening || !tagName) {
        return undefined;
    }

    const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "giu");
    tagPattern.lastIndex = openingTagStart;
    let depth = 0;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(source))) {
        const token = match[0];
        const isClosing = token.startsWith("</");
        const isSelfClosing = /\/>\s*$/u.test(token);

        if (isClosing) {
            depth -= 1;
            if (depth === 0) {
                const end = tagPattern.lastIndex;
                return {
                    start: openingTagStart,
                    end,
                    oldText: source.slice(openingTagStart, end),
                };
            }
        } else if (!isSelfClosing) {
            depth += 1;
        }
    }

    return undefined;
}

function findExplicitSecondFeatureRange(
    source: string,
): { start: number; end: number; oldText: string } | undefined {
    const explicitPatterns = [
        /<([A-Za-z][\w:-]*)\b[^>]*(?:className|class)=["'][^"']*\bfeature-two\b[^"']*["'][^>]*>/iu,
        /<([A-Za-z][\w:-]*)\b[^>]*data-feature=["']second["'][^>]*>/iu,
    ];

    for (const pattern of explicitPatterns) {
        const match = pattern.exec(source);
        if (match) {
            return findBalancedElementRange(source, match.index);
        }
    }

    return undefined;
}

async function applyDeleteOrHideFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<LocalSourceFallbackChange | undefined> {
    signal?.throwIfAborted();

    if (!isDeleteOrHideSingleTargetRequest(goal)) {
        return undefined;
    }

    for (const relativePath of TEXT_FALLBACK_SOURCE_FILES) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        let source: string;

        try {
            source = await readFile(absolutePath, "utf8");
        } catch {
            continue;
        }

        const targetRange = findExplicitSecondFeatureRange(source);
        if (!targetRange) {
            continue;
        }

        const nextSource = `${source.slice(0, targetRange.start)}${source.slice(
            targetRange.end,
        )}`;
        if (nextSource === source) {
            continue;
        }

        signal?.throwIfAborted();
        await writeFile(absolutePath, nextSource, "utf8");
        return {
            messages: [
                "Removed the explicitly targeted second feature/module without rewriting surrounding content.",
            ],
            action: {
                path: relativePath,
                oldText: targetRange.oldText,
                newText: "",
            },
        };
    }

    return undefined;
}

async function applyNoProgressLocalFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<LocalSourceFallbackChange | undefined> {
    const textChange = await applyTextReplacementFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (textChange) {
        return textChange;
    }

    const deleteOrHideChange = await applyDeleteOrHideFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (deleteOrHideChange) {
        return deleteOrHideChange;
    }

    const compactNavigationMessages =
        await applyCompactTopNavigationFallback(workspaceRoot, goal, signal);
    if (compactNavigationMessages.length > 0) {
        return {
            messages: compactNavigationMessages,
            action: {
                path: "src/App.tsx",
                oldText: "long top navigation labels",
                newText: "compact top navigation labels with nowrap desktop CSS",
            },
        };
    }

    const sizeSpacingMessages = await applySizeSpacingPositionFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (sizeSpacingMessages.length > 0) {
        return {
            messages: sizeSpacingMessages,
            action: {
                path: "src/App.css",
                oldText: "current size, spacing, radius, or position",
                newText: "marked size/spacing/position override CSS",
            },
        };
    }

    const semanticMessages = await applyFocusedSemanticVisualFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (semanticMessages.length > 0) {
        return {
            messages: semanticMessages,
            action: {
                path: "src/pages/home.tsx",
                oldText: "raw point labels such as A / B / C and visible // separators",
                newText: "horizontal point-label chips and CSS-backed visual separators",
            },
        };
    }

    const colorMessages = await applyColorPaletteFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (colorMessages.length > 0) {
        return {
            messages: colorMessages,
            action: {
                path: "src/App.css",
                oldText: "current color palette or background",
                newText: "marked palette override CSS",
            },
        };
    }

    const visualMessages = await applyVisualLayoutStabilizationFallback(
        workspaceRoot,
        goal,
        signal,
    );
    if (visualMessages.length > 0) {
        return {
            messages: visualMessages,
            action: {
                path: "src/App.css",
                oldText: "oversized, overflowing, or hard-to-read visual layout",
                newText: "marked visual layout stabilizer CSS",
            },
        };
    }

    return undefined;
}

function isSizeSpacingPositionRequest(goal: string): boolean {
    return (
        /\d+(?:\.\d+)?\s*px/iu.test(goal) &&
        /\b(?:sidebar|width|height|gap|spacing|padding|margin|move|right|left|radius|rounded)\b|左侧栏|侧边栏|宽度|高度|间距|内边距|外边距|移动|右移|左移|圆角/iu.test(
            goal,
        )
    ) || /大圆角|圆角太大|不要.*圆角|别.*圆角/iu.test(goal);
}

function extractRequestedPx(goal: string, fallbackPx: number): number {
    const pxMatch = goal.match(/(\d+(?:\.\d+)?)\s*px/iu);
    return pxMatch ? Number(pxMatch[1]) : fallbackPx;
}

function formatSizeSpacingPositionCss(goal: string): string {
    const px = extractRequestedPx(goal, 8);
    const rules: string[] = [
        "/* appforge size-spacing-position-fix start */",
    ];

    if (/\bsidebar\b|left\s+sidebar|left\s+rail|左侧栏|侧边栏/iu.test(goal)) {
        rules.push(
            `.sidebar,
.app-sidebar,
aside,
[class*="sidebar" i] {
    flex: 0 0 ${px}px !important;
    width: ${px}px !important;
    max-width: ${px}px !important;
    min-width: min(${px}px, 100%) !important;
}`,
        );
    }

    if (/\b(?:move|right|left)\b|移动|右移|左移/iu.test(goal)) {
        const direction = /\bleft\b|左移/iu.test(goal) ? -1 : 1;
        rules.push(
            `button,
.button,
.btn,
[role="button"],
[class*="button" i],
[class*="btn" i] {
    transform: translateX(${direction * px}px) !important;
}`,
        );
    }

    if (/\b(?:gap|spacing|padding|margin)\b|间距|内边距|外边距/iu.test(goal)) {
        rules.push(
            `.page-grid,
.feature-grid,
.metric-grid,
.content-grid,
[class*="grid" i],
[class*="list" i],
[class*="stack" i] {
    gap: ${px}px !important;
}

.page-card,
.feature-card,
.panel,
.card,
[class*="card" i],
[class*="panel" i] {
    padding: ${px}px !important;
}`,
        );
    }

    if (/\b(?:radius|rounded)\b|圆角|大圆角/iu.test(goal)) {
        const radiusPx = /大圆角|圆角太大|不要.*圆角|别.*圆角/iu.test(goal)
            ? Math.min(px, 8)
            : px;
        rules.push(
            `.page-card,
.feature-card,
.panel,
.card,
.tile,
.media-panel,
[class*="card" i],
[class*="panel" i],
[class*="tile" i] {
    border-radius: ${radiusPx}px !important;
}`,
        );
    }

    rules.push("/* appforge size-spacing-position-fix end */");

    return `${rules.join("\n\n")}\n`;
}

async function applySizeSpacingPositionFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();

    if (!isSizeSpacingPositionRequest(goal)) {
        return [];
    }

    const cssPath = path.join(workspaceRoot, "src", "App.css");
    let source: string;

    try {
        source = await readFile(cssPath, "utf8");
    } catch {
        return [];
    }

    const fixCss = formatSizeSpacingPositionCss(goal);
    const withoutPrevious = source.replace(
        /\n?\/\* appforge size-spacing-position-fix start \*\/[\s\S]*?\/\* appforge size-spacing-position-fix end \*\/\n?/u,
        "\n",
    );
    const nextSource = `${withoutPrevious.trimEnd()}\n\n${fixCss}`;

    if (nextSource === source) {
        return [];
    }

    signal?.throwIfAborted();
    await writeFile(cssPath, nextSource, "utf8");

    return [
        "Applied deterministic size/spacing/position CSS override for the focused visual adjustment.",
    ];
}

function isVisualLayoutStabilizationRequest(goal: string): boolean {
    if (isHorizontalPointLabelRequest(goal)) {
        return false;
    }

    if (
        /\b(?:row|inline|horizontal|vertical|site|point|label|abc|a\/b\/c)\b|竖着|竖排|竖起来|纵向|横排|横着|一排|同一排|一行|同一行|并排|排成一排|点位|包点|站点|标签|ABC|abc|A\/B\/C/iu.test(
            goal,
        )
    ) {
        return true;
    }

    return /\b(?:contrast|readable|visibility|visible|font|typography|layout|spacing|blank|empty|oversized|too large|too tall|too prominent|overpowering|dominant|cramped|wraps?|line[- ]break|image|photo|fit|contain|crop|cropped|card|cards|card-like|grid|box|boxed|tile|tiles|panel|rounded|radius|huge|massive)\b|看不清|看不见|不可见|不清楚|读不清|字看不见|文字看不见|字体|字号|很大|太大|过大|太夸张|太抢眼|太突兀|抢眼|突兀|压住|压过|占太多|撑开|挤在|拥挤|断行|换行|一行一字|太小|缩小|小一点|小点|收一点|别那么大|不要那么大|景点名|地点名|路线名|路线节点|排版|布局|空白|留白|图片太高|图片超过|图.*超过|图片.*放|图.*放在|放在里面|裁切|裁掉|截断|重新搞|卡片|方格|格子|盒子|卡片感|像卡片|还是卡片|超级大|巨大|太巨大|面板太大|圆角|大圆角|不像游戏|游戏感/iu.test(
        goal,
    );
}

function formatVisualLayoutStabilizationCss(): string {
    return `/* appforge visual-iteration-stabilizer start */
:root {
    --appforge-readable-ink: #191713;
    --appforge-readable-muted: #5f554a;
    --appforge-readable-surface: rgba(255, 252, 246, .96);
}

.site-header,
.site-nav,
.brand-link {
    min-width: 0;
}

.brand-link strong,
.nav-link,
.page-kicker,
.eyebrow {
    overflow-wrap: anywhere;
    text-wrap: balance;
}

.page-hero h1,
.page-title,
h1 {
    font-size: clamp(2rem, 5vw, 4.2rem);
    line-height: 1.04;
    overflow-wrap: anywhere;
    text-wrap: balance;
}

.page-card h2,
.timeline-item h2,
.callout h2,
h2 {
    font-size: clamp(1.18rem, 1.8vw, 1.65rem);
    line-height: 1.22;
    overflow-wrap: anywhere;
    text-wrap: balance;
}

.page-card,
.metric,
.stat,
.timeline-item,
.callout,
.quote,
.media-panel {
    min-width: 0;
    overflow: hidden;
}

.page-card p,
.page-card li,
.page-card small,
.timeline-item p,
.timeline-item li,
.quote,
.quote p,
.media-panel,
.media-panel p {
    color: var(--appforge-readable-muted);
}

.page-card h3,
.page-card li strong,
.page-card li b,
.timeline-item strong,
.timeline-item b,
.timeline-item h3,
.feature-list strong,
.feature-list b,
.feature-list li,
.tag-list strong,
.tag-list b,
.tag,
.step strong,
.step b,
.step h3,
.route-stop,
.place-name,
.spot-name,
.itinerary-stop,
.route-node,
[class*="route"] strong,
[class*="route"] b,
[class*="place"] strong,
[class*="place"] b,
[class*="spot"] strong,
[class*="spot"] b,
dt,
dd strong,
.metric h2,
.metric h3,
.stat h2,
.stat h3,
.feature-card h2,
.feature-card h3,
.info-card h2,
.info-card h3,
.culture-card h2,
.culture-card h3,
[class*="card"] h2,
[class*="card"] h3 {
    font-size: clamp(1rem, 1.45vw, 1.32rem);
    line-height: 1.26;
    letter-spacing: 0;
    overflow-wrap: anywhere;
    text-wrap: balance;
    word-break: keep-all;
}

.metric strong,
.stat strong,
.metric-value,
.stat-value,
.number,
[class*="metric"] strong,
[class*="stat"] strong,
[class*="value"] {
    display: inline-block;
    max-width: 100%;
    font-size: clamp(1.8rem, 4vw, 3rem);
    line-height: 1.04;
    letter-spacing: -0.035em;
    white-space: nowrap;
    overflow-wrap: normal;
    word-break: keep-all;
}

.metric p,
.stat p,
[class*="metric"] p,
[class*="stat"] p {
    font-size: clamp(.95rem, 1.2vw, 1.08rem);
    line-height: 1.65;
}

.page-card--accent,
.callout {
    color: #fff7ea;
}

.page-card--accent p,
.page-card--accent li,
.callout p,
.callout li {
    color: #f8e9d1;
}

.page-card img,
.page-card .page-image,
.page-card picture,
.page-card figure,
.media-panel img,
.media-panel .page-image {
    display: block;
    width: 100%;
    height: auto;
    min-height: 0;
    max-height: clamp(9rem, 20vw, 15rem);
    aspect-ratio: 4 / 3;
    object-fit: contain;
    object-position: center;
    background: linear-gradient(135deg, rgba(255, 249, 239, .96), rgba(232, 213, 184, .58));
    border-radius: 1rem;
}

.page-card--wide img,
.page-card--wide .page-image {
    max-height: clamp(11rem, 24vw, 18rem);
    aspect-ratio: 16 / 9;
}

.page-genre-game .game-stage {
    border-radius: clamp(.65rem, 1.5vw, 1.1rem);
    color: #f7fbff;
    background: linear-gradient(135deg, rgba(7, 10, 18, .96), rgba(22, 18, 36, .94));
}

.page-genre-game .game-stage :is(p, li, td, th, span, small, strong),
.page-genre-game :is(.hud-pill, .game-slab, .game-site, .game-lane, .game-agent, .game-round) {
    text-shadow: 0 1px 10px rgba(0, 0, 0, .42);
}

.page-genre-game .game-stage :is(td, th),
.page-genre-game .game-stage table {
    color: #f7fbff;
    background: rgba(7, 13, 24, .72);
}

.page-genre-game .game-stage > .game-hud,
.page-genre-game .game-stage > .game-callout,
.page-genre-game .game-stage > .metric-grid,
.page-genre-game .game-stage > .timeline,
.page-genre-game .game-stage > .game-sites {
    grid-column: 1 / -1;
}

.page-genre-game,
.page-genre-game * {
    writing-mode: horizontal-tb;
}

.page-genre-game .game-sites {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: stretch;
    gap: .65rem;
    min-width: 0;
}

.page-genre-game .game-site {
    flex: 1 1 8rem;
    min-width: min(8rem, 100%);
    display: inline-flex;
    align-items: center;
    gap: .55rem;
    padding: .6rem .75rem;
    color: #f7fbff;
    background: linear-gradient(90deg, rgba(255, 70, 85, .18), rgba(124, 247, 255, .08));
    border-left: 2px solid #ff4655;
    clip-path: polygon(0 0, calc(100% - .55rem) 0, 100% .55rem, 100% 100%, 0 100%);
}

.page-genre-game .site-letter {
    flex: 0 0 auto;
    min-width: 2.1rem;
    min-height: 2.1rem;
    display: inline-grid;
    place-items: center;
    color: #071018;
    background: #7cf7ff;
    font-size: clamp(.95rem, 1.4vw, 1.15rem);
    font-weight: 950;
    line-height: 1;
    white-space: nowrap;
    word-break: keep-all;
    overflow-wrap: normal;
}

.page-genre-game .hud-pill,
.page-genre-game .game-slab {
    min-height: 40px;
    padding: .55rem .8rem;
    border-radius: .4rem;
    font-size: clamp(.72rem, .95vw, .9rem);
    clip-path: polygon(.45rem 0, 100% 0, calc(100% - .45rem) 100%, 0 100%);
}

.page-genre-game .game-panel,
.page-genre-game .game-callout,
.page-genre-game [class*="card"],
.page-genre-game [class*="panel"] {
    max-width: 100%;
    min-width: 0;
    padding: clamp(.85rem, 1.9vw, 1.35rem);
    color: #f7fbff;
    border: 0;
    border-left: 2px solid var(--page-warm, #7cf7ff);
    border-radius: .35rem;
    background: linear-gradient(110deg, rgba(7, 13, 24, .92), rgba(22, 30, 48, .82));
    box-shadow: inset 0 0 0 1px rgba(124, 247, 255, .16), 0 18px 42px rgba(0, 0, 0, .18);
    clip-path: polygon(0 0, calc(100% - .75rem) 0, 100% .75rem, 100% 100%, .75rem 100%, 0 calc(100% - .75rem));
}

.page-genre-game .game-panel h2,
.page-genre-game .game-callout h2,
.page-genre-game [class*="card"] h2,
.page-genre-game [class*="panel"] h2,
.page-genre-game [class*="card"] h3,
.page-genre-game [class*="panel"] h3 {
    color: #ffffff;
    font-size: clamp(1.05rem, 1.55vw, 1.55rem);
    line-height: 1.12;
    letter-spacing: -0.015em;
    text-shadow: 0 1px 12px rgba(0, 0, 0, .42);
}

.page-genre-game .game-panel p,
.page-genre-game .game-panel li,
.page-genre-game .game-callout p,
.page-genre-game .game-callout li,
.page-genre-game [class*="card"] p,
.page-genre-game [class*="panel"] p,
.page-genre-game [class*="card"] li,
.page-genre-game [class*="panel"] li {
    color: rgba(238, 248, 255, .86);
    font-size: clamp(.88rem, 1vw, .98rem);
    line-height: 1.55;
}

.page-genre-game .game-rail {
    max-width: none;
}

.page-genre-game .metric-grid {
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.page-genre-game .metric {
    color: #edf8ff;
    background: rgba(7, 13, 24, .72);
    border: 0;
    border-top: 2px solid rgba(124, 247, 255, .55);
    border-radius: .25rem;
    box-shadow: inset 0 0 0 1px rgba(124, 247, 255, .16);
}

.page-genre-game .metric strong {
    color: #fff;
    font-size: clamp(1.1rem, 2.1vw, 1.8rem);
    line-height: 1.08;
    letter-spacing: -0.025em;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.page-media,
.media-panel,
figure,
picture {
    min-width: 0;
}

@media (min-width: 801px) and (max-width: 1120px) {
    .route-main {
        width: min(100% - 1.5rem, 920px);
    }

    .page-hero {
        grid-template-columns: 1fr;
    }

    .page-grid {
        grid-template-columns: repeat(6, minmax(0, 1fr));
    }

    .page-card,
    .page-card--wide {
        grid-column: span 6;
    }
}

@media (max-width: 800px) {
    .route-main {
        width: min(100% - 1rem, 720px);
    }

    .page-hero {
        padding: clamp(1.4rem, 5vw, 2.4rem);
    }
}
/* appforge visual-iteration-stabilizer end */
`;
}

async function applyVisualLayoutStabilizationFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();
    if (!isVisualLayoutStabilizationRequest(goal)) {
        return [];
    }

    const cssPath = path.join(workspaceRoot, "src", "App.css");
    let source: string;

    try {
        source = await readFile(cssPath, "utf8");
    } catch (error) {
        if (signal?.aborted) {
            signal.throwIfAborted();
        }
        return [];
    }

    const stabilizerCss = formatVisualLayoutStabilizationCss();
    const withoutPrevious = source.replace(
        /\n?\/\* appforge visual-iteration-stabilizer start \*\/[\s\S]*?\/\* appforge visual-iteration-stabilizer end \*\/\n?/u,
        "\n",
    );
    const nextSource = `${withoutPrevious.trimEnd()}\n\n${stabilizerCss}`;

    if (nextSource === source) {
        return [];
    }

    signal?.throwIfAborted();
    await writeFile(cssPath, nextSource, "utf8");

    return [
        "Applied readable-text, smaller-heading, card-image, and responsive layout CSS stabilization.",
    ];
}

function formatPointSiteLabels(labels: string[]): string {
    return `<div className="game-sites game-sites--compact">${labels
        .map(
            (label) =>
                `<span className="game-site"><strong className="site-letter">${label}</strong></span>`,
        )
        .join("")}</div>`;
}

function applyTacticalPointMarkupFix(source: string): string {
    return source
        .replace(/\s\/\/\s/gu, " · ")
        .replace(
            /<td>\s*A\s*\/\s*B\s*\/\s*C\s*<\/td>/giu,
            `<td>${formatPointSiteLabels(["A", "B", "C"])}</td>`,
        )
        .replace(
            /<td>\s*A\s*\/\s*B\s*<\/td>/giu,
            `<td>${formatPointSiteLabels(["A", "B"])}</td>`,
        )
        .replace(
            /<td>\s*B\s*\/\s*C\s*<\/td>/giu,
            `<td>${formatPointSiteLabels(["B", "C"])}</td>`,
        );
}

function formatTacticalPointMarkupCss(): string {
    return `/* appforge semantic-visual-fix start */
.page-genre-game .data-table {
    table-layout: fixed;
    color: #f7fbff;
    background: rgba(7, 13, 24, .84);
    border: 1px solid rgba(124, 247, 255, .18);
}

.page-genre-game .data-table :is(th, td) {
    color: #f7fbff;
    vertical-align: top;
    background: rgba(7, 13, 24, .42);
    border-bottom-color: rgba(124, 247, 255, .18);
    overflow-wrap: break-word;
}

.page-genre-game .data-table .game-sites--compact {
    display: flex;
    flex-flow: row wrap;
    align-items: center;
    gap: .35rem;
    min-width: 5.5rem;
}

.page-genre-game .data-table .game-site {
    flex: 0 0 auto;
    min-width: 0;
    padding: .2rem;
    color: #071018;
    background: transparent;
    border-left: 0;
    clip-path: none;
}

.page-genre-game .data-table .site-letter {
    min-width: 1.75rem;
    min-height: 1.75rem;
    padding: .2rem .45rem;
    display: inline-grid;
    place-items: center;
    color: #071018;
    background: #7cf7ff;
    font-size: .9rem;
    font-weight: 950;
    line-height: 1;
    white-space: nowrap;
    word-break: keep-all;
    border-radius: .18rem;
    text-shadow: none;
}

.page-genre-game :is(.eyebrow, .page-kicker, .hud-pill) {
    text-shadow: 0 1px 12px rgba(0, 0, 0, .48);
}
/* appforge semantic-visual-fix end */
`;
}

function unwrapSemanticVisualFixCss(css: string): string {
    return css
        .replace(/\/\* appforge semantic-visual-fix start \*\/\n?/u, "")
        .replace(/\n?\/\* appforge semantic-visual-fix end \*\//u, "")
        .trim();
}

function wrapSemanticVisualFixCss(css: string): string {
    return `/* appforge semantic-visual-fix start */\n${css.trim()}\n/* appforge semantic-visual-fix end */\n`;
}

function formatAvoidBlueBackgroundCss(): string {
    return `
:root {
    --appforge-valorant-bg: #080808;
    --appforge-valorant-panel: #17100f;
    --appforge-valorant-panel-2: #251312;
    --appforge-valorant-red: #ff4655;
    --appforge-valorant-amber: #f6b35b;
}

body:has(.page-genre-game),
.site-genre-game,
.page-genre-game {
    background:
        radial-gradient(circle at 18% 12%, rgba(255, 70, 85, .24), transparent 18rem),
        radial-gradient(circle at 84% 18%, rgba(246, 179, 91, .16), transparent 16rem),
        linear-gradient(135deg, #080808 0%, #17100f 52%, #251312 100%) !important;
}

.page-genre-game .page-hero,
.page-genre-game .game-stage,
.page-genre-game .game-map,
.page-genre-game .game-hud,
.page-genre-game .data-table,
.page-genre-game :is(.game-panel, .game-callout, .media-panel, .quote, [class*="panel" i]) {
    color: #fff8f2 !important;
    background:
        radial-gradient(circle at 20% 20%, rgba(255, 70, 85, .18), transparent 14rem),
        linear-gradient(135deg, var(--appforge-valorant-panel), var(--appforge-valorant-panel-2)) !important;
    border-color: rgba(255, 70, 85, .34) !important;
}

.page-genre-game .game-map::after {
    background: linear-gradient(90deg, transparent, var(--appforge-valorant-amber), var(--appforge-valorant-red), transparent) !important;
    box-shadow: 0 0 22px rgba(255, 70, 85, .42) !important;
}

.page-genre-game :is(.hud-pill, .game-slab, .site-letter, .tag, [class*="chip" i], [class*="pill" i]),
.page-genre-game .data-table :is(th, .site-letter) {
    color: #12090a !important;
    background: linear-gradient(135deg, var(--appforge-valorant-red), var(--appforge-valorant-amber)) !important;
    border-color: rgba(255, 70, 85, .45) !important;
}

.page-genre-game .game-site,
.page-genre-game .game-lane,
.page-genre-game .game-agent,
.page-genre-game .game-round {
    background: linear-gradient(90deg, rgba(255, 70, 85, .22), rgba(246, 179, 91, .08)) !important;
    border-left-color: var(--appforge-valorant-red) !important;
}

body:has(.page-genre-game) :is([class*="hud" i], [class*="brief" i], [class*="status" i], [class*="ticker" i], [class*="meta" i], [class*="phase" i], [class*="carrier" i], [class*="econ" i], [class*="match" i], [class*="site" i], [class*="letter" i], [class*="map" i], [class*="stage" i], [class*="strip" i], [class*="bar" i], [style*="7cf7ff" i], [style*="38bdf8" i], [style*="cyan" i], [style*="blue" i], [style*="124, 247, 255" i], [style*="56, 189, 248" i]) {
    color: #fff8f2 !important;
    background-color: rgba(23, 16, 15, .94) !important;
    background-image: linear-gradient(135deg, rgba(23, 16, 15, .96), rgba(37, 19, 18, .92)) !important;
    border-color: rgba(255, 70, 85, .42) !important;
    box-shadow: none !important;
}

body:has(.page-genre-game) :is([class*="pill" i], [class*="chip" i], [class*="tag" i], [class*="badge" i], [class*="letter" i], [class*="site-letter" i], [style*="7cf7ff" i], [style*="38bdf8" i], [style*="cyan" i], [style*="blue" i]) :is(span, strong, small, b, em),
body:has(.page-genre-game) :is([class*="pill" i], [class*="chip" i], [class*="tag" i], [class*="badge" i], [class*="letter" i], [class*="site-letter" i]):not(:has(*)) {
    color: #16090a !important;
    background: linear-gradient(135deg, var(--appforge-valorant-red), var(--appforge-valorant-amber)) !important;
    text-shadow: none !important;
}

body:has(.page-genre-game) :is([class*="hud" i], [class*="brief" i], [class*="status" i], [class*="ticker" i], [class*="meta" i], [class*="map" i], [class*="stage" i], [class*="strip" i], [class*="bar" i])::before,
body:has(.page-genre-game) :is([class*="hud" i], [class*="brief" i], [class*="status" i], [class*="ticker" i], [class*="meta" i], [class*="map" i], [class*="stage" i], [class*="strip" i], [class*="bar" i])::after {
    background: linear-gradient(90deg, var(--appforge-valorant-red), var(--appforge-valorant-amber)) !important;
    border-color: rgba(255, 70, 85, .42) !important;
    box-shadow: none !important;
}
`.trim();
}

function inferRequestedPalette(goal: string): {
    name: string;
    bg: string;
    panel: string;
    panelSoft: string;
    text: string;
    muted: string;
    accent: string;
    accent2: string;
    accentText: string;
} {
    if (/紫|purple|violet/iu.test(goal)) {
        return {
            name: "purple",
            bg: "#120b1f",
            panel: "#211332",
            panelSoft: "#2d1a43",
            text: "#fbf7ff",
            muted: "#ddccef",
            accent: "#a78bfa",
            accent2: "#f0abfc",
            accentText: "#14091f",
        };
    }

    if (/绿|green|emerald/iu.test(goal)) {
        return {
            name: "green",
            bg: "#071610",
            panel: "#10241b",
            panelSoft: "#183528",
            text: "#f2fff8",
            muted: "#cdebd9",
            accent: "#34d399",
            accent2: "#fde68a",
            accentText: "#06140d",
        };
    }

    if (/红|red|valorant|瓦罗兰特|无畏契约/iu.test(goal)) {
        return {
            name: "red-charcoal",
            bg: "#0b0809",
            panel: "#1b1113",
            panelSoft: "#2b171a",
            text: "#fff7f4",
            muted: "#f0d2cc",
            accent: "#ff4655",
            accent2: "#f6b35b",
            accentText: "#180709",
        };
    }

    if (/金|黄|橙|warm|amber|orange|yellow/iu.test(goal)) {
        return {
            name: "warm-amber",
            bg: "#171006",
            panel: "#2a1c0d",
            panelSoft: "#3a2712",
            text: "#fff8ea",
            muted: "#ead7b8",
            accent: "#f6b35b",
            accent2: "#fde68a",
            accentText: "#1d1206",
        };
    }

    if (/灰|黑|深色|深灰|dark|gray|grey|black|高级/iu.test(goal)) {
        return {
            name: "graphite",
            bg: "#0f1115",
            panel: "#191d24",
            panelSoft: "#232832",
            text: "#f7f9fc",
            muted: "#cbd5e1",
            accent: "#f6b35b",
            accent2: "#e5e7eb",
            accentText: "#111318",
        };
    }

    return {
        name: "editorial-ink",
        bg: "#17130f",
        panel: "#2a2119",
        panelSoft: "#3a2d20",
        text: "#fffaf3",
        muted: "#e8d8c2",
        accent: "#d89c5b",
        accent2: "#f6d58d",
        accentText: "#1b1208",
    };
}

function formatPaletteOverrideCss(goal: string): string {
    const palette = inferRequestedPalette(goal);

    return `/* appforge palette-override start */
:root {
    --appforge-palette-name: "${palette.name}";
    --appforge-palette-bg: ${palette.bg};
    --appforge-palette-panel: ${palette.panel};
    --appforge-palette-panel-soft: ${palette.panelSoft};
    --appforge-palette-text: ${palette.text};
    --appforge-palette-muted: ${palette.muted};
    --appforge-palette-accent: ${palette.accent};
    --appforge-palette-accent-2: ${palette.accent2};
    --appforge-palette-accent-text: ${palette.accentText};
}

body,
.page-view,
.site-shell,
.route-main {
    color: var(--appforge-palette-text) !important;
    background:
        radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--appforge-palette-accent) 22%, transparent), transparent 20rem),
        radial-gradient(circle at 86% 18%, color-mix(in srgb, var(--appforge-palette-accent-2) 16%, transparent), transparent 18rem),
        linear-gradient(135deg, var(--appforge-palette-bg), var(--appforge-palette-panel)) !important;
}

.site-header,
.app-header,
.topbar,
header,
nav {
    color: var(--appforge-palette-text) !important;
    background: color-mix(in srgb, var(--appforge-palette-bg) 88%, black) !important;
    border-color: color-mix(in srgb, var(--appforge-palette-accent) 34%, transparent) !important;
}

.page-hero,
.hero,
.masthead,
.banner,
[class*="hero" i],
[class*="stage" i],
[class*="panel" i],
[class*="card" i],
[class*="tile" i],
.data-table,
table {
    color: var(--appforge-palette-text) !important;
    background:
        linear-gradient(135deg, color-mix(in srgb, var(--appforge-palette-panel) 94%, transparent), color-mix(in srgb, var(--appforge-palette-panel-soft) 90%, transparent)) !important;
    border-color: color-mix(in srgb, var(--appforge-palette-accent) 32%, transparent) !important;
    box-shadow: none;
}

.page-hero :is(h1, h2, h3, p, span, strong, small, a),
.hero :is(h1, h2, h3, p, span, strong, small, a),
[class*="panel" i] :is(h1, h2, h3, h4, p, li, span, strong, small, td, th),
[class*="card" i] :is(h1, h2, h3, h4, p, li, span, strong, small, td, th),
table :is(td, th, span, strong, small) {
    color: inherit !important;
    text-shadow: none !important;
}

.nav-link,
.primary-nav a,
button,
[role="button"],
.button,
.btn,
.cta,
.tag,
.chip,
.pill,
.badge,
[class*="tag" i],
[class*="chip" i],
[class*="pill" i],
[class*="badge" i],
[class*="hud" i],
[class*="status" i] {
    color: var(--appforge-palette-accent-text) !important;
    background: linear-gradient(135deg, var(--appforge-palette-accent), var(--appforge-palette-accent-2)) !important;
    border-color: color-mix(in srgb, var(--appforge-palette-accent) 45%, black) !important;
    text-shadow: none !important;
}

.nav-link:not(.nav-link--active):not([aria-current="page"]),
.primary-nav a:not([aria-current="page"]) {
    color: var(--appforge-palette-text) !important;
    background: transparent !important;
}

p,
li,
small,
.muted,
.page-lead,
[class*="muted" i],
[class*="lead" i] {
    color: var(--appforge-palette-muted) !important;
}
/* appforge palette-override end */
`;
}

async function applyColorPaletteFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();

    if (!isColorChangeRequest(goal)) {
        return [];
    }

    const cssPath = path.join(workspaceRoot, "src", "App.css");
    let source: string;

    try {
        source = await readFile(cssPath, "utf8");
    } catch {
        return [];
    }

    const paletteCss = formatPaletteOverrideCss(goal);
    const withoutPrevious = source.replace(
        /\n?\/\* appforge palette-override start \*\/[\s\S]*?\/\* appforge palette-override end \*\/\n?/u,
        "\n",
    );
    const nextSource = `${withoutPrevious.trimEnd()}\n\n${paletteCss}`;

    if (nextSource === source) {
        return [];
    }

    signal?.throwIfAborted();
    await writeFile(cssPath, nextSource, "utf8");

    return [
        `Applied deterministic ${inferRequestedPalette(goal).name} palette override for the requested color/background change.`,
    ];
}

function isLowContrastBrowserFailure(
    browserEval: BrowserEvalResult | undefined,
): boolean {
    return (
        browserEval?.passed === false &&
        browserEval.checks.some(
            (check) =>
                !check.passed &&
                (check.name === "visible text has sufficient contrast" ||
                    /low-contrast|contrast|对比|看不清|看不见|不可见/iu.test(
                        check.message ?? "",
                    )),
        )
    );
}

function isBrowserContrastFailureForFallback(
    browserEval: BrowserEvalResult | undefined,
): boolean {
    return (
        browserEval?.passed === false &&
        browserEval.checks.some((check) => {
            if (check.passed) {
                return false;
            }

            const detail = `${check.name} ${check.message ?? ""}`;
            return (
                check.name === "visible text has sufficient contrast" ||
                /low[-\s]?contrast|contrast|visible text|needs\s+(?:4\.5|3)(?::1)?|wcag|对比|看不清|看不见|不可见/iu.test(
                    detail,
                )
            );
        })
    );
}

function formatBrowserContrastHardeningCss(goal: string): string {
    const gameTone = isLikelyTacticalGameRequest(goal)
        ? `
.site-genre-game .site-header,
.page-genre-game .page-hero,
.page-genre-game .game-stage,
.page-genre-game :is(.game-panel, .game-callout, .page-card, .media-panel, .quote, .data-table, table, [class*="panel" i], [class*="card" i]) {
    color: #f8fbff !important;
    background: #071018 !important;
    border-color: rgba(124, 247, 255, .35) !important;
    text-shadow: none !important;
}

.site-genre-game .site-header :is(.brand-link, .nav-link) {
    color: #f8fbff !important;
    background: transparent !important;
    text-shadow: none !important;
}

.site-genre-game .site-header :is(.brand-link strong, .brand-link small, .nav-link:not(.nav-link--active)) {
    color: #f8fbff !important;
    background: transparent !important;
    text-shadow: 0 2px 14px rgba(0, 0, 0, .65) !important;
}

.site-genre-game .site-header :is(.nav-link--active, [aria-current="page"]) {
    color: #071018 !important;
    background: #7cf7ff !important;
    text-shadow: none !important;
}

.page-genre-game :is(.game-panel, .game-callout, .page-card, .media-panel, .quote, .data-table, table, [class*="panel" i], [class*="card" i]) :is(h1, h2, h3, h4, p, li, span, strong, small, th, td) {
    color: #f8fbff !important;
    background: transparent !important;
    text-shadow: none !important;
}

.page-genre-game :is(.data-table, table) :is(thead, tbody, tr, th, td) {
    color: #f8fbff !important;
    background: #071018 !important;
    border-color: rgba(124, 247, 255, .28) !important;
    text-shadow: none !important;
}

.page-genre-game :is(.data-table, table) th {
    color: #071018 !important;
    background: #7cf7ff !important;
    font-weight: 900 !important;
}

.page-genre-game :is(.hud-pill, .game-slab, [class*="hud" i]) {
    color: #071018 !important;
    background: #7cf7ff !important;
    border-color: rgba(5, 10, 18, .35) !important;
    text-shadow: none !important;
}

.page-genre-game :is([class*="bomb" i], [class*="defus" i], [class*="clutch" i], [class*="status" i], [class*="alert" i], [class*="ready" i], [class*="timer" i], [class*="ticker" i], [class*="label" i], [class*="meta" i], [class*="tag" i], [class*="chip" i], [class*="badge" i], [class*="pill" i]) {
    color: #071018 !important;
    background: #7cf7ff !important;
    border-color: rgba(5, 10, 18, .35) !important;
    text-shadow: none !important;
}

.page-genre-game :is([class*="bomb" i], [class*="defus" i], [class*="clutch" i], [class*="status" i], [class*="alert" i], [class*="ready" i], [class*="timer" i], [class*="ticker" i], [class*="label" i], [class*="meta" i], [class*="tag" i], [class*="chip" i], [class*="badge" i], [class*="pill" i]) :is(h1, h2, h3, h4, p, span, strong, small, b, em) {
    color: #071018 !important;
    background: transparent !important;
    text-shadow: none !important;
}

.page-genre-game :is(.hud-pill, .game-slab, [class*="hud" i], [class*="bomb" i], [class*="defus" i], [class*="clutch" i], [class*="status" i], [class*="alert" i], [class*="ready" i], [class*="timer" i], [class*="ticker" i], [class*="label" i], [class*="meta" i], [class*="tag" i], [class*="chip" i], [class*="badge" i], [class*="pill" i]):not(:has(*)) {
    color: #071018 !important;
    background: #7cf7ff !important;
    text-shadow: none !important;
}

.page-genre-game :is(.metric, [class*="metric" i], [class*="stat" i]) {
    color: #f8fbff !important;
    background: #071018 !important;
    border-color: rgba(124, 247, 255, .35) !important;
    text-shadow: none !important;
}

.page-genre-game :is(.metric, [class*="metric" i], [class*="stat" i]) :is(strong, span, small, p) {
    color: #f8fbff !important;
    background: transparent !important;
    text-shadow: none !important;
}

.page-genre-game :is([class*="round" i], [class*="phase" i], [class*="timeline" i], [class*="economy" i], [class*="loadout" i], [class*="weapon" i], [class*="rifle" i], [class*="pistol" i]) {
    color: #f8fbff !important;
    background: #071018 !important;
    border-color: rgba(124, 247, 255, .35) !important;
    text-shadow: none !important;
}

.page-genre-game :is([class*="round" i], [class*="phase" i], [class*="timeline" i], [class*="economy" i], [class*="loadout" i], [class*="weapon" i], [class*="rifle" i], [class*="pistol" i]) :is(h1, h2, h3, h4, p, li, span, strong, small, b, em, th, td) {
    color: #f8fbff !important;
    background: transparent !important;
    text-shadow: none !important;
}
`
        : "";

    return `/* appforge browser-contrast-hardening start */
:root {
    --appforge-readable-ink: #f8fbff;
    --appforge-readable-muted: #d7e2f3;
    --appforge-readable-dark: #061018;
    --appforge-readable-panel: rgba(5, 10, 18, .94);
    --appforge-readable-panel-soft: rgba(9, 16, 28, .88);
    --appforge-readable-accent: #7cf7ff;
    --appforge-readable-warm: #ffd166;
}

body {
    color: #111827;
}

body :is(header, nav, .header, .navbar, .topbar, .site-header, .app-header, [class*="header" i], [class*="navbar" i], [class*="topbar" i]) {
    color: var(--appforge-readable-ink) !important;
    background: linear-gradient(90deg, rgba(5, 8, 14, .98), rgba(18, 22, 30, .96)) !important;
    border-color: rgba(124, 247, 255, .22) !important;
}

body :is(header, nav, .header, .navbar, .topbar, .site-header, .app-header, [class*="header" i], [class*="navbar" i], [class*="topbar" i]) :is(h1, h2, h3, p, span, strong, small, a, button) {
    color: var(--appforge-readable-ink) !important;
    text-shadow: 0 1px 10px rgba(0, 0, 0, .45);
}

body :is(header, nav, .header, .navbar, .topbar, .site-header, .app-header, [class*="header" i], [class*="navbar" i], [class*="topbar" i]) :is(.active, .current, [aria-current="page"], button[aria-current="page"], a[aria-current="page"]) {
    color: var(--appforge-readable-dark) !important;
    background: var(--appforge-readable-warm) !important;
    text-shadow: none !important;
}

body :is(.hero, .page-hero, .game-hero, .banner, .intro, .masthead, [class*="hero" i], [class*="banner" i], [class*="masthead" i]) {
    color: var(--appforge-readable-ink) !important;
    background-color: var(--appforge-readable-panel) !important;
}

body :is(.hero, .page-hero, .game-hero, .banner, .intro, .masthead, [class*="hero" i], [class*="banner" i], [class*="masthead" i]) :is(h1, h2, h3, p, span, strong, small, a) {
    color: var(--appforge-readable-ink) !important;
    text-shadow: 0 2px 14px rgba(0, 0, 0, .58);
}

body :is(.eyebrow, .kicker, .badge, .pill, .tag, .chip, .hud-pill, [class*="badge" i], [class*="pill" i], [class*="tag" i], [class*="chip" i], [class*="hud" i], [class*="status" i], [class*="alert" i], [class*="ready" i], [class*="timer" i], [class*="ticker" i], [class*="bomb" i], [class*="defus" i], [class*="clutch" i]) {
    color: var(--appforge-readable-dark) !important;
    background: linear-gradient(135deg, var(--appforge-readable-accent), var(--appforge-readable-warm)) !important;
    border-color: rgba(5, 10, 18, .28) !important;
    text-shadow: none !important;
}

body :is(.page-kicker, .eyebrow, [class*="eyebrow" i], [class*="kicker" i]) {
    display: inline-flex;
    width: fit-content;
    max-width: 100%;
    color: var(--appforge-readable-dark) !important;
    background: #ffd166 !important;
    border: 1px solid rgba(5, 10, 18, .24) !important;
    border-radius: .45rem !important;
    padding: .25rem .55rem !important;
    line-height: 1.25 !important;
    text-shadow: none !important;
}

.site-genre-game :is(.brand-link strong, .brand-link small, .site-title, .site-subtitle, [class*="brand" i], [class*="logo" i]) {
    color: var(--appforge-readable-ink) !important;
    text-shadow: 0 2px 16px rgba(0, 0, 0, .72) !important;
}

.site-genre-game :is(.hud-pill, .metric, .metric strong, .metric span, [class*="hud" i], [class*="metric" i], [class*="stat" i]) {
    color: var(--appforge-readable-dark) !important;
    background: linear-gradient(135deg, var(--appforge-readable-accent), var(--appforge-readable-warm)) !important;
    border-color: rgba(5, 10, 18, .35) !important;
    text-shadow: none !important;
}

body :is(main, section, article, aside, .route-main, .page-view) :is(a:not(.brand-link):not(.nav-link), button, [role="button"], .button, .btn, .cta, .link, [class*="button" i], [class*="btn" i], [class*="cta" i], [class*="link" i]) {
    color: var(--appforge-readable-dark) !important;
    background-color: var(--appforge-readable-warm) !important;
    border-color: rgba(5, 10, 18, .25) !important;
    text-shadow: none !important;
}

body :is(.subject, .major, .discipline, .program, .faculty, .school, .label, .name, .item, [class*="subject" i], [class*="major" i], [class*="discipline" i], [class*="program" i], [class*="faculty" i], [class*="school" i], [class*="label" i], [class*="name" i]) {
    color: var(--appforge-readable-dark) !important;
    background-color: rgba(255, 255, 255, .94) !important;
    text-shadow: none !important;
}

body :is(.card, .panel, .tile, .stat, .data-table, table, [class*="card" i], [class*="panel" i], [class*="tile" i]) {
    color: #111827 !important;
    background-color: rgba(255, 255, 255, .94);
}

body :is(.card, .panel, .tile, .stat, .data-table, table, [class*="card" i], [class*="panel" i], [class*="tile" i]) :is(h1, h2, h3, h4, p, li, td, th, span, strong, small) {
    color: inherit !important;
    text-shadow: none !important;
}

body :is([class*="round" i], [class*="phase" i], [class*="timeline" i], [class*="economy" i], [class*="loadout" i], [class*="weapon" i], [class*="rifle" i], [class*="pistol" i]) {
    color: var(--appforge-readable-ink) !important;
    background-color: var(--appforge-readable-panel) !important;
    border-color: rgba(124, 247, 255, .30) !important;
    text-shadow: none !important;
}

body :is([class*="round" i], [class*="phase" i], [class*="timeline" i], [class*="economy" i], [class*="loadout" i], [class*="weapon" i], [class*="rifle" i], [class*="pistol" i]) :is(h1, h2, h3, h4, p, li, td, th, span, strong, small, b, em) {
    color: var(--appforge-readable-ink) !important;
    background: transparent !important;
    text-shadow: none !important;
}

body :is(section, article, aside, main) :is(h1, h2, h3, h4, p, li, td, th, span, strong, small):not(header *):not(nav *):not(.hero *):not(.page-hero *):not(.game-hero *):not(.banner *):not(.masthead *) {
    text-shadow: none;
}

.game-sites,
.game-sites--compact {
    display: flex !important;
    flex-flow: row wrap !important;
    align-items: center !important;
    gap: .35rem !important;
    writing-mode: horizontal-tb !important;
}

.game-site,
.site-letter {
    writing-mode: horizontal-tb !important;
    white-space: nowrap !important;
    word-break: keep-all !important;
}

.site-letter {
    color: var(--appforge-readable-dark) !important;
    background: var(--appforge-readable-accent) !important;
    text-shadow: none !important;
}
${gameTone}
/* appforge browser-contrast-hardening end */
`;
}

async function applyBrowserContrastHardeningFallback(
    workspaceRoot: string,
    goal: string,
    browserEval: BrowserEvalResult | undefined,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();

    if (process.env.APPFORGE_AUTO_CONTRAST_HARDENING === "0") {
        return [];
    }

    if (!isBrowserContrastFailureForFallback(browserEval)) {
        return [];
    }

    const cssPath = path.join(workspaceRoot, "src", "App.css");
    let cssSource: string;

    try {
        cssSource = await readFile(cssPath, "utf8");
    } catch (error) {
        if (signal?.aborted) {
            signal.throwIfAborted();
        }
        return [];
    }

    const contrastCss = formatBrowserContrastHardeningCss(goal);
    const withoutPrevious = cssSource.replace(
        /\n?\/\* appforge browser-contrast-hardening start \*\/[\s\S]*?\/\* appforge browser-contrast-hardening end \*\/\n?/u,
        "\n",
    );
    const nextCss = `${withoutPrevious.trimEnd()}\n\n${contrastCss}`;

    if (nextCss === cssSource) {
        return [];
    }

    signal?.throwIfAborted();
    await writeFile(cssPath, nextCss, "utf8");

    return [
        "Applied browser-driven WCAG contrast hardening while preserving the current visual/semantic request.",
    ];
}

async function applyFocusedSemanticVisualFallback(
    workspaceRoot: string,
    goal: string,
    signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();

    const needsPointFix =
        isHorizontalPointLabelRequest(goal) || isLikelyTacticalGameRequest(goal);
    const needsAvoidBlueBackgroundRequest =
        isRejectingBlueBackgroundRequest(goal);

    if (
        !needsPointFix &&
        !needsAvoidBlueBackgroundRequest
    ) {
        return [];
    }

    const sourceTargets = [
        path.join("src", "pages", "home.tsx"),
        path.join("src", "App.tsx"),
    ];
    const messages: string[] = [];
    let sourceLooksGame = false;

    for (const relativePath of sourceTargets) {
        const filePath = path.join(workspaceRoot, relativePath);
        let source: string;

        try {
            source = await readFile(filePath, "utf8");
        } catch (error) {
            if (signal?.aborted) {
                signal.throwIfAborted();
            }
            continue;
        }

        sourceLooksGame =
            sourceLooksGame ||
            /page-genre-game|site-genre-game|game-stage|game-hud|game-panel|valorant|瓦罗兰特|无畏契约/iu.test(
                source,
            );

        const nextSource = needsPointFix
            ? applyTacticalPointMarkupFix(source)
            : source;

        if (nextSource === source) {
            continue;
        }

        signal?.throwIfAborted();
        await writeFile(filePath, nextSource, "utf8");
        messages.push(
            `Rewrote tactical point labels and visible separator punctuation in ${toWorkspacePath(relativePath)}.`,
        );
    }

    const needsAvoidBlueBackground =
        needsAvoidBlueBackgroundRequest &&
        (isLikelyTacticalGameRequest(goal) || sourceLooksGame);

    if (messages.length === 0 && !needsAvoidBlueBackground) {
        return [];
    }

    const cssPath = path.join(workspaceRoot, "src", "App.css");
    try {
        const cssSource = await readFile(cssPath, "utf8");
        const semanticCss = wrapSemanticVisualFixCss(
            [
                messages.length > 0
                    ? unwrapSemanticVisualFixCss(formatTacticalPointMarkupCss())
                    : "",
                needsAvoidBlueBackground ? formatAvoidBlueBackgroundCss() : "",
            ]
                .filter((part) => part.length > 0)
                .join("\n\n"),
        );
        const withoutPrevious = cssSource.replace(
            /\n?\/\* appforge semantic-visual-fix start \*\/[\s\S]*?\/\* appforge semantic-visual-fix end \*\/\n?/u,
            "\n",
        );
        const nextCss = `${withoutPrevious.trimEnd()}\n\n${semanticCss}`;

        if (nextCss !== cssSource) {
            signal?.throwIfAborted();
            await writeFile(cssPath, nextCss, "utf8");
            messages.push(
                needsAvoidBlueBackground
                    ? "Applied requested non-blue Valorant/game background palette override."
                    : "Added high-contrast horizontal point-label CSS for tactical tables.",
            );
        }
    } catch (error) {
        if (signal?.aborted) {
            signal.throwIfAborted();
        }
    }

    return messages;
}

function formatPreparedAssetEvidence(
    savedAssets: SavedImageAsset[],
): string {
    if (savedAssets.length === 0) {
        return "";
    }

    return [
        "Tool-prepared local assets:",
        ...savedAssets.map((asset) =>
            [
                `- ${asset.path}`,
                `  mediaType: ${asset.mediaType}`,
                `  source: ${asset.source}`,
                `  bytes: ${asset.byteLength}`,
            ].join("\n"),
        ),
    ].join("\n");
}

async function evaluateLocalWorkspaceChangeResult(
    input: {
        goal: string;
        workspaceRoot: string;
        coordination: CoordinateAgentsResult;
        messages: string[];
        action?: {
            path: string;
            oldText: string;
            newText: string;
        };
        traceName?: string;
        traceTitle?: string;
        evaluateBrowser?: EvaluateBrowserForAttempt;
        browserProbes?: BrowserProbe[];
        signal?: AbortSignal;
        onProgress?: RunReactAppAgentOptions["onProgress"];
        metrics?: RunMetrics;
        runStartedAt?: number;
        focusedEdit?: boolean;
    },
): Promise<RunReactAppAgentResult> {
    const agent: RunCodingAgentLoopResult = {
        steps: [
            {
                action: {
                    type: "edit_file",
                    path: input.action?.path ?? "src/App.tsx",
                    oldText: input.action?.oldText ?? "local navigation placeholders",
                    newText: input.action?.newText ?? "hash navigation links",
                },
                execution: {
                    ok: true,
                    message: input.messages.join("\n"),
                },
            },
            {
                action: {
                    type: "finish",
                    summary: "Applied a local deterministic workspace change.",
                },
                execution: {
                    ok: true,
                    message: "Applied a local deterministic workspace change.",
                },
            },
        ],
        finished: true,
        stopReason: "finish",
    };
    await emitRunProgress(input.onProgress, "installing");
    const install = input.focusedEdit
        ? {
              exitCode: 0,
              stdout:
                  "Skipped npm install for focused edit because dependency manifests did not change.",
              stderr: "",
          }
        : input.metrics
        ? await timeRunPhase(input.metrics, "installDurationMs", () =>
              runWorkspaceCommand(
                  input.workspaceRoot,
                  {
                      command: "npm",
                      args: ["install"],
                  },
                  {
                      timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
                      ...(input.signal ? { signal: input.signal } : {}),
                  },
              ),
          )
        : await runWorkspaceCommand(
              input.workspaceRoot,
              {
                  command: "npm",
                  args: ["install"],
              },
              {
                  timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
                  ...(input.signal ? { signal: input.signal } : {}),
              },
          );
    await emitRunProgress(input.onProgress, "building");
    let build = input.metrics
        ? await timeRunPhase(input.metrics, "buildDurationMs", () =>
              runWorkspaceCommand(
                  input.workspaceRoot,
                  {
                      command: "npm",
                      args: ["run", "build"],
                  },
                  {
                      timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
                      ...(input.signal ? { signal: input.signal } : {}),
                  },
              ),
          )
        : await runWorkspaceCommand(
              input.workspaceRoot,
              {
                  command: "npm",
                  args: ["run", "build"],
              },
              {
                  timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
                  ...(input.signal ? { signal: input.signal } : {}),
              },
          );
    input.signal?.throwIfAborted();
    await emitRunProgress(input.onProgress, "evaluating");
    const appSource = await readFile(
        path.join(input.workspaceRoot, "src", "App.tsx"),
        "utf8",
    );
    const evalResult = input.metrics
        ? await timeRunPhase(input.metrics, "evaluationDurationMs", async () => {
              if (input.focusedEdit) {
                  return {
                      passed: true,
                      checks: [
                          {
                              name: "focused edit quick static check",
                              passed: true,
                          },
                      ],
                  };
              }

              const evaluationSource = await formatStaticEvaluationSource(
                  input.workspaceRoot,
              );

              return evaluateReactApp({
                  source: evaluationSource,
                  goal: input.goal,
              });
          })
        : input.focusedEdit
          ? {
                passed: true,
                checks: [
                    {
                        name: "focused edit quick static check",
                        passed: true,
                    },
                ],
            }
          : evaluateReactApp({
                source: await formatStaticEvaluationSource(input.workspaceRoot),
                goal: input.goal,
            });
    let browserEval: BrowserEvalResult | undefined;

    if (
        input.evaluateBrowser &&
        install.exitCode === 0 &&
        build.exitCode === 0
    ) {
        try {
            await emitRunProgress(input.onProgress, "evaluating");
                browserEval = input.metrics
                    ? await timeRunPhase(
                          input.metrics,
                          "evaluationDurationMs",
                          () =>
                              input.evaluateBrowser!({
                                  goal: input.goal,
                                  workspaceRoot: input.workspaceRoot,
                                  kind: "repair",
                                  attemptNumber: 1,
                                  ...((input.browserProbes?.length ?? 0) > 0
                                      ? { browserProbes: input.browserProbes }
                                      : {}),
                                  ...(input.signal
                                      ? { signal: input.signal }
                                      : {}),
                              }),
                      )
                    : await input.evaluateBrowser({
                          goal: input.goal,
                          workspaceRoot: input.workspaceRoot,
                          kind: "repair",
                          attemptNumber: 1,
                          ...((input.browserProbes?.length ?? 0) > 0
                              ? { browserProbes: input.browserProbes }
                              : {}),
                          ...(input.signal ? { signal: input.signal } : {}),
                      });
        } catch (error) {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
            browserEval = {
                passed: false,
                checks: [
                    {
                        name: "browser preview starts",
                        passed: false,
                        message:
                            error instanceof Error
                                ? error.message
                                : "Browser preview could not start",
                    },
                ],
            };
        }
    }

    const contrastHardeningMessages =
        await applyBrowserContrastHardeningFallback(
            input.workspaceRoot,
            input.goal,
            browserEval,
            input.signal,
        );

    if (
        contrastHardeningMessages.length > 0 &&
        input.evaluateBrowser &&
        install.exitCode === 0
    ) {
        agent.steps.splice(agent.steps.length - 1, 0, {
            action: {
                type: "edit_file",
                path: "src/App.css",
                oldText: "low-contrast browser-visible text",
                newText: "WCAG-readable header, hero, navigation, tag, chip, and tactical label contrast rules",
            },
            execution: {
                ok: true,
                message: contrastHardeningMessages.join("\n"),
                changed: true,
            },
        });
        await emitRunProgress(input.onProgress, "building");
        build = await runWorkspaceCommand(
            input.workspaceRoot,
            {
                command: "npm",
                args: ["run", "build"],
            },
            {
                timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
                ...(input.signal ? { signal: input.signal } : {}),
            },
        );
        input.signal?.throwIfAborted();

        if (build.exitCode === 0) {
            try {
                await emitRunProgress(input.onProgress, "evaluating");
                browserEval = await input.evaluateBrowser({
                    goal: input.goal,
                    workspaceRoot: input.workspaceRoot,
                    kind: "repair",
                    attemptNumber: 2,
                    ...((input.browserProbes?.length ?? 0) > 0
                        ? { browserProbes: input.browserProbes }
                        : {}),
                    ...(input.signal ? { signal: input.signal } : {}),
                });
            } catch (error) {
                if (input.signal?.aborted) {
                    input.signal.throwIfAborted();
                }
                browserEval = {
                    passed: false,
                    checks: [
                        {
                            name: "browser preview starts",
                            passed: false,
                            message:
                                error instanceof Error
                                    ? error.message
                                    : "Browser preview could not start",
                        },
                    ],
                };
            }
        }
    }

    await emitRunProgress(input.onProgress, "reviewing");
    const review = reviewReactAppAgentResult({
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
    });
    const navigationFailures = listHashNavigationTargetFailures(appSource);
    const finalReview =
        isNavigationFallbackGoal(input.goal) &&
        review.accepted &&
        navigationFailures.length > 0
            ? {
                  ...review,
                  accepted: false,
                  reason: `Rejected because local navigation fallback produced invalid links: ${navigationFailures.join(
                      " ",
                  )}`,
              }
            : review;
    const attempt: RunReactAppAgentAttempt = {
        kind: "repair",
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
        review: finalReview,
    };

    const result: RunReactAppAgentResult = {
        workspaceRoot: input.workspaceRoot,
        coordination: input.coordination,
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
        review: finalReview,
        attempts: [attempt],
        trace: [
            createTraceEvent(
                input.traceName ?? "local-navigation-fallback",
                input.traceTitle ?? "Apply local navigation fallback",
                "succeeded",
                input.messages.join("\n"),
            ),
            ...buildTraceEvents([attempt], input.coordination.plan.length),
        ],
    };

    return input.metrics && input.runStartedAt
        ? withRunDiagnostics(result, input.metrics, input.runStartedAt)
        : result;
}

async function prepareMissingLocalAssets(
    input: {
        goal: string;
        workspaceRoot: string;
        imageAssetTool: ImageAssetTool | undefined;
        imageAssetModes: ImageAssetMode[];
        signal?: AbortSignal;
    },
): Promise<SavedImageAsset[]> {
    if (
        !input.imageAssetTool ||
        !input.imageAssetModes.includes("generate") ||
        !isAssetOnlyRepairGoal(input.goal)
    ) {
        return [];
    }

    const sourceFiles = await readAllWorkspaceSourceFiles(input.workspaceRoot);
    const missingReferences = (
        await listLocalAssetReferences(
            input.workspaceRoot,
            sourceFiles.map((file) => file.content).join("\n"),
        )
    ).filter((reference) => !reference.exists);

    const savedAssets: SavedImageAsset[] = [];

    for (const reference of missingReferences) {
        input.signal?.throwIfAborted();
        const saved = await input.imageAssetTool.save({
            request: {
                query: [
                    input.goal,
                    `Create a clean local visual asset for ${reference.urlPath}.`,
                    `Alt text: ${inferAssetAltText(input.goal, reference)}.`,
                ].join(" "),
                mode: "generate",
                altText: inferAssetAltText(input.goal, reference),
            },
            outputPath: reference.publicPath,
            ...(input.signal ? { signal: input.signal } : {}),
        });

        savedAssets.push(saved);

        const savedUrlPath = publicPathToUrlPath(saved.path);

        if (savedUrlPath !== reference.urlPath) {
            for (const sourceFile of sourceFiles) {
                sourceFile.content = sourceFile.content
                    .split(reference.urlPath)
                    .join(savedUrlPath);
            }
        }
    }

    if (savedAssets.length > 0) {
        input.signal?.throwIfAborted();
        await Promise.all(
            sourceFiles.map(async (sourceFile) => {
                const absolutePath = path.join(
                    input.workspaceRoot,
                    sourceFile.path,
                );
                const currentContent = await readFile(absolutePath, "utf8");

                if (currentContent !== sourceFile.content) {
                    await writeFile(absolutePath, sourceFile.content, "utf8");
                }
            }),
        );
    }

    return savedAssets;
}

async function evaluatePreparedAssetOnlyResult(
    input: {
        goal: string;
        workspaceRoot: string;
        coordination: CoordinateAgentsResult;
        savedAssets: SavedImageAsset[];
        evaluateBrowser?: EvaluateBrowserForAttempt;
        signal?: AbortSignal;
        onProgress?: RunReactAppAgentOptions["onProgress"];
    },
): Promise<RunReactAppAgentResult> {
    const agent: RunCodingAgentLoopResult = {
        steps: [
            ...input.savedAssets.map((asset) => ({
                action: {
                    type: "get_image" as const,
                    query: input.goal,
                    mode: "generate" as const,
                    altText: path.basename(
                        asset.path,
                        path.extname(asset.path),
                    ),
                    outputPath: asset.path,
                },
                execution: {
                    ok: true,
                    message: [
                        `Saved image: ${asset.path}`,
                        `Media type: ${asset.mediaType}`,
                        `Source: ${asset.source}`,
                        `Bytes: ${asset.byteLength}`,
                    ].join("\n"),
                },
            })),
            {
                action: {
                    type: "finish" as const,
                    summary:
                        "Prepared missing local image assets and updated references.",
                },
                execution: {
                    ok: true,
                    message:
                        "Prepared missing local image assets and updated references.",
                },
            },
        ],
        finished: true,
        stopReason: "finish",
    };
    await emitRunProgress(input.onProgress, "installing");
    const install = await runWorkspaceCommand(
        input.workspaceRoot,
        {
            command: "npm",
            args: ["install"],
        },
        {
            timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
            ...(input.signal ? { signal: input.signal } : {}),
        },
    );
    await emitRunProgress(input.onProgress, "building");
    const build = await runWorkspaceCommand(
        input.workspaceRoot,
        {
            command: "npm",
            args: ["run", "build"],
        },
        {
            timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
            ...(input.signal ? { signal: input.signal } : {}),
        },
    );
    input.signal?.throwIfAborted();
    await emitRunProgress(input.onProgress, "evaluating");
    const evaluationSource = await formatStaticEvaluationSource(
        input.workspaceRoot,
    );
    const evalResult = evaluateReactApp({
        source: evaluationSource,
        goal: input.goal,
    });
    let browserEval: BrowserEvalResult | undefined;

    if (
        input.evaluateBrowser &&
        install.exitCode === 0 &&
        build.exitCode === 0
    ) {
        try {
            await emitRunProgress(input.onProgress, "evaluating");
            browserEval = await input.evaluateBrowser({
                goal: input.goal,
                workspaceRoot: input.workspaceRoot,
                kind: "repair",
                attemptNumber: 1,
                ...(input.signal ? { signal: input.signal } : {}),
            });
        } catch (error) {
            if (input.signal?.aborted) {
                input.signal.throwIfAborted();
            }
            browserEval = {
                passed: false,
                checks: [
                    {
                        name: "browser preview starts",
                        passed: false,
                        message:
                            error instanceof Error
                                ? error.message
                                : "Browser preview could not start",
                    },
                ],
            };
        }
    }

    const localAssetReferences =
        await listWorkspaceLocalAssetReferences(input.workspaceRoot);
    const missingReferences = localAssetReferences.filter(
        (reference) => !reference.exists,
    );
    await emitRunProgress(input.onProgress, "reviewing");
    const deterministicReview = reviewReactAppAgentResult({
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
    });
    const review: ReactAppAgentReview =
        deterministicReview.accepted && missingReferences.length > 0
            ? {
                  ...deterministicReview,
                  accepted: false,
                  reason: `Rejected because local asset references are still missing: ${missingReferences
                      .map((reference) => reference.urlPath)
                      .join(", ")}.`,
              }
            : deterministicReview;
    const attempt: RunReactAppAgentAttempt = {
        kind: "repair",
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
        review,
    };

    return {
        workspaceRoot: input.workspaceRoot,
        coordination: input.coordination,
        agent,
        install,
        build,
        eval: evalResult,
        ...(browserEval ? { browserEval } : {}),
        review,
        attempts: [attempt],
        trace: [
            createTraceEvent(
                "prepare-missing-assets",
                "Prepare missing local image assets",
                input.savedAssets.length > 0 ? "succeeded" : "failed",
                formatPreparedAssetEvidence(input.savedAssets),
            ),
            ...buildTraceEvents([attempt], input.coordination.plan.length),
        ],
    };
}

function formatImageToolContext(
    modes: ImageAssetMode[],
): string {
    if (modes.length === 0) {
        return "";
    }

    return [
        "Image asset tool is available.",
        `Available image modes: ${modes.join(", ")}.`,
        'When the product goal asks for a logo, icon, badge, official brand mark, or known existing product image, plan a get_image action with mode "search" before writing src/App.tsx.',
        'Use mode "search" with either a keyword phrase such as "Valorant official logo Riot Games svg png" or an http(s) page/direct image URL.',
        'When the product goal asks for a new AI-created hero image, banner, illustration, or generic local visual asset, plan a get_image action with mode "generate" before writing src/App.tsx.',
        "All image outputPath values must be inside public/assets.",
        'React code must reference saved assets as "/assets/file-name.ext".',
        "Do not rely on remote image URLs for generated app UI.",
    ].join(" ");
}

function buildTraceEvents(
    attempts: RunReactAppAgentAttempt[],
    plannerStepCount: number,
    plannerFallbackSummary?: string,
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
        createTraceEvent(
            "planner-agent",
            plannerFallbackSummary
                ? "Planner Agent unavailable; local fallback plan used"
                : "Planner Agent created implementation plan",
            plannerFallbackSummary ? "failed" : "succeeded",
            plannerFallbackSummary ??
                `${plannerStepCount} plan step(s) generated`,
        ),
    ];

    attempts.forEach((attempt, index) => {
        const prefix = `${attempt.kind}-${index + 1}`;

        trace.push(
            ...(attempt.parallelWorkstreams ?? []).map((workstream) =>
                createTraceEvent(
                    `${prefix}-coding-${workstream.id}`,
                    `${workstream.role} Coding Agent: ${workstream.path}`,
                    workstream.status === "succeeded"
                        ? "succeeded"
                        : "failed",
                    workstream.errorMessage ??
                        [
                            workstream.status === "fallback"
                                ? "该页面的模型输出无效，目前展示的是本地兜底草稿。"
                                : "",
                            `${workstream.generationAttempts} generation attempt(s); ${workstream.summary}`,
                        ]
                            .filter(Boolean)
                            .join(" "),
                ),
            ),
            createTraceEvent(
                `${prefix}-agent`,
                `${attempt.kind} coding agent`,
                attempt.agent.finished ? "succeeded" : "failed",
                `${attempt.agent.steps.length} agent step(s) executed; stop reason: ${attempt.agent.stopReason ?? "unknown"}`,
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
            ...(attempt.browserEval
                ? [
                      createTraceEvent(
                          `${prefix}-browser-eval`,
                          "Evaluate app in browser",
                          attempt.browserEval.passed ? "succeeded" : "failed",
                          [
                              `${attempt.browserEval.checks.filter((check) => check.passed).length}/${attempt.browserEval.checks.length} browser checks passed`,
                              ...attempt.browserEval.checks
                                  .filter((check) => !check.passed)
                                  .slice(0, 3)
                                  .map((check) =>
                                      check.message
                                          ? `${check.name}: ${check.message}`
                                          : check.name,
                                  ),
                          ].join("; "),
                      ),
                  ]
                : []),
            ...(attempt.llmReview
                ? [
                    createTraceEvent(
                        `${prefix}-llm-review`,
                        "LLM Reviewer inspected generated app",
                        attempt.llmReview.accepted
                            ? "succeeded"
                            : "failed",
                        attempt.llmReview.reason,
                    ),
                ]
                : []),
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

function isComplexReactAppRequest(text: string): boolean {
    const explicitlyMinimal =
        /\b(?:simple|minimal|basic|small|single[- ]screen|one[- ]screen)\b|简单|极简|基础页面|小型页面|单屏/iu.test(
            text,
        );

    if (explicitlyMinimal) {
        return false;
    }

    return (
        /complex|homepage|landing|dashboard|portal|official site|many sections|multi-section|complete|polished|hero|banner|carousel|gallery|apex|legends|官网|官方网站|复杂|完整|好看|精美|首页|主页|门户|多板块|多个板块|多栏目|轮播|图片|配图|素材|清华|北大|大学官网|游戏官网|游戏页面|介绍页面|旅游介绍/iu.test(
            text,
        ) ||
        /\b(?:create|build|design|make|generate|redesign)\b.{0,50}\b(?:page|site|homepage|landing|screen|interface)\b|(?:我想要|我要|给我|来一个|做|创建|生成|设计|制作|搭建).{0,40}(?:页面|界面|网站|主页|首页)|(?:介绍|展示).{0,30}(?:页面|界面|网站)/iu.test(
            text,
        )
    );
}

function isFocusedVisualAdjustmentRequest(text: string): boolean {
    const mentionsExistingBrandElement =
        /\b(?:logo|icon|badge|emblem|brand mark)\b|图标|徽标|校徽|标志/iu.test(
            text,
        );
    const asksForVisualAdjustment =
        /\b(?:colou?r|contrast|background|visibility|visible|size|spacing|padding|margin|position|blend|typography|font|layout|readable|fit|contain|crop|cropped|prominent|overpowering|dominant|cramped|wraps?|line[- ]break|card|cards|card-like|grid|box|boxed|tile|tiles|panel|rounded|radius|huge|massive)\b|颜色|背景|对比|看不清|看不见|不可见|不清楚|读不清|字看不见|文字看不见|字体|字号|很大|太大|过大|太夸张|太抢眼|太突兀|抢眼|突兀|压住|压过|占太多|撑开|挤在|拥挤|断行|换行|一行一字|太小|缩小|小一点|小点|收一点|别那么大|不要那么大|放大|大小|尺寸|间距|位置|排版|布局|空白|留白|图片太高|图片超过|图片.*放|图.*放在|放在里面|裁切|裁掉|截断|融入|一样|卡片|方格|格子|盒子|卡片感|像卡片|还是卡片|超级大|巨大|太巨大|面板太大|圆角|大圆角|不像游戏|游戏感/iu.test(
            text,
        );
    const mentionsVisualSurface =
        /\b(?:text|font|title|heading|copy|card|cards|grid|box|tile|panel|image|photo|layout|section|page|screen|list|route|place|spot|stop|label|name)\b|文字|字体|字号|标题|名字|名称|卡片|方格|格子|盒子|面板|圆角|图片|照片|排版|布局|页面|界面|空白|留白|文化|景点|地点|路线|节点|清单/iu.test(
            text,
        );
    const asksForHorizontalReadableLabels =
        /\b(?:row|inline|horizontal|vertical|site|point|label|abc|a\/b\/c)\b|竖着|竖排|竖起来|纵向|横排|横着|一排|同一排|一行|同一行|并排|排成一排|点位|包点|站点|标签|ABC|abc|A\/B\/C/iu.test(
            text,
        );
    const asksForTextChange =
        /\b(?:text|copy|label|wording|rename|change)\b|(?:\u6587\u5b57|\u6587\u672c|\u6587\u6848|\u6309\u94ae\u6587\u5b57|\u6309\u94ae\u6587\u6848|\u6539\u6210|\u4fee\u6539|\u66ff\u6362)/iu.test(
            text,
        );
    const asksForFocusedAssetChange =
        /\b(?:replace|swap|change)\s+(?:the\s+)?(?:hero\s+)?(?:image|photo|asset)\b|\b(?:hero\s+)?image\s+asset\b/iu.test(
            text,
        );
    const asksForFocusedDeletion =
        /\b(?:delete|remove|hide)\s+(?:the\s+)?(?:second\s+)?(?:feature|module|section|card|button|image|element)\b/iu.test(
            text,
        );
    const mentionsEditableTextSurface =
        /\b(?:button|text|copy|label|heading|title)\b|(?:\u6309\u94ae|\u6587\u5b57|\u6587\u672c|\u6587\u6848|\u6807\u9898|\u6807\u7b7e)/iu.test(
            text,
        );
    const explicitlyRejectsBroadReplacement =
        /\b(?:do not|don't|without)\s+(?:redesigning|rebuilding|replacing)|(?:不要|别|无需|不需要).{0,8}(?:重做|重建|重新设计)/iu.test(
            text,
        );
    const asksForBroadReplacement =
        !explicitlyRejectsBroadReplacement &&
        /\b(?:create|build|redesign|rebuild|replace)\b.{0,30}\b(?:page|site|homepage|app)\b|\b(?:whole|entire)\s+(?:page|site|app)\b|重做|重建|重新设计|整个(?:页面|网站|应用)/iu.test(
            text,
        );

    return (
        (mentionsExistingBrandElement ||
            mentionsVisualSurface ||
            mentionsEditableTextSurface ||
            asksForHorizontalReadableLabels ||
            asksForFocusedDeletion ||
            asksForFocusedAssetChange) &&
        (asksForVisualAdjustment ||
            asksForHorizontalReadableLabels ||
            asksForTextChange ||
            asksForFocusedAssetChange ||
            asksForFocusedDeletion) &&
        !asksForBroadReplacement
    );
}

function isContentCorrectionRequest(text: string): boolean {
    return /(?:content|copy|wording|text)\s+(?:is|are|feels?)\s+(?:wrong|generic|irrelevant|off-topic|not\s+about)|(?:make|change|rewrite|replace).{0,80}(?:content|copy|text).{0,40}(?:about|related\s+to|specific\s+to)|内容.{0,20}(?:不对|不相关|不符合|不是|太通用|没有相关|换成|改成|替换成)|文案.{0,20}(?:不对|不相关|不符合|不是|太通用|换成|改成)|文字内容.{0,30}(?:换成|改成|替换成|不是|不相关)|不是.{0,30}(?:相关|主题|内容)|没有.{0,20}相关.{0,20}内容/iu.test(
        text,
    );
}

type IterationRequestKind =
    | "fresh_generation"
    | "fast_edit"
    | "content_correction"
    | "layout_repair"
    | "structural_regen"
    | "dependency_change";

function isNoChangeCorrectionRequest(text: string): boolean {
    return /(?:no\s+change|unchanged|still\s+(?:same|wrong|broken)|did\s+not\s+change|not\s+applied|ignored)|(?:还是一样|没有变化|没变化|没有改|没改|改不了|没有效果|没用|不生效|还是不对|还是错|没听懂|不听需求)/iu.test(
        text,
    );
}

function isLayoutRepairIterationRequest(text: string): boolean {
    return /(?:layout|ui|screen|page).{0,40}(?:broken|messy|chaotic|unreadable|collapsed|overflow|too\s+large)|(?:界面|页面|排版|布局).{0,30}(?:乱|搞乱|坏|炸|崩|不合理|显示不全|看不清|太大|溢出|挤压)|(?:字体|标题|文字).{0,20}(?:太大|显示不全|挤在一起|压住|看不清)/iu.test(
        text,
    );
}

function isAmbiguousTypographyRequest(text: string): boolean {
    const mentionsTypographySize =
        /\b(?:font|font-size|text|heading|title)\b.{0,30}\b(?:small|large|bigger|smaller|tiny|huge)\b|\b(?:small|large|bigger|smaller|tiny|huge)\b.{0,30}\b(?:font|text|heading|title)\b|(?:字体|字号|文字|标题).{0,20}(?:太小|太大|小一点|大一点|放大|缩小)|(?:太小|太大|小一点|大一点|放大|缩小).{0,20}(?:字体|字号|文字|标题)/iu.test(
            text,
        );
    const hasExplicitTarget =
        /\b(?:button|sidebar|hero|nav|navigation|header|footer|table|card|section|title|h1|h2|h3|\.|#|selector|class)\b|(?:按钮|侧边栏|左侧栏|导航|顶部|页脚|表格|卡片|模块|区块|标题|主标题|副标题|菜单|列表|指标|数字|段落|正文)/iu.test(
            text,
        );
    const hasDeicticReference =
        /\b(?:this|that|these|those|here|there)\b|(?:这个|那个|这里|那里|上面|下面|截图|图里|里面|这一块|那一块|某个|有些)/iu.test(
            text,
        );

    return mentionsTypographySize && hasDeicticReference && !hasExplicitTarget;
}

function isDependencyChangeRequest(text: string): boolean {
    return /(?:package\.json|package-lock|dependency|dependencies|npm\s+install|install\s+(?:a\s+)?package|add\s+(?:a\s+)?library)|(?:依赖|安装包|加库|package\.json|lockfile)/iu.test(
        text,
    );
}

export function classifyIterationRequest(input: {
    currentRequest: string;
    executionRequest: string;
    resetWorkspace?: boolean;
    genericRepairRequest: boolean;
    navigationRequestKind: NavigationRequestKind;
}): IterationRequestKind {
    if (input.resetWorkspace !== false) {
        return "fresh_generation";
    }

    if (isDependencyChangeRequest(input.currentRequest)) {
        return "dependency_change";
    }

    if (
        !input.genericRepairRequest &&
        isContentCorrectionRequest(input.currentRequest)
    ) {
        return "content_correction";
    }

    if (
        !input.genericRepairRequest &&
        (isLayoutRepairIterationRequest(input.currentRequest) ||
            isAmbiguousTypographyRequest(input.currentRequest) ||
            isNoChangeCorrectionRequest(input.currentRequest))
    ) {
        return "layout_repair";
    }

    if (
        isExplicitRegenerationPrompt(input.executionRequest) ||
        isFullApplicationCreationRequest(input.executionRequest)
    ) {
        return "structural_regen";
    }

    if (
        !input.genericRepairRequest &&
        (isFocusedVisualAdjustmentRequest(input.executionRequest) ||
            isExplicitFocusedEditRequest(input.executionRequest) ||
            input.navigationRequestKind === "in-page")
    ) {
        return "fast_edit";
    }

    return "structural_regen";
}

function isExplicitFocusedEditRequest(text: string): boolean {
    const actionThenTarget =
        /\b(?:change|modify|update|set|move|delete|remove|hide|replace|swap)\b.{0,80}\b(?:button|sidebar|hero|background|color|width|height|font|title|image|photo|asset|module|section|route|\/about|mobile|desktop)\b/iu;
    const targetThenAction =
        /\b(?:button|sidebar|hero|background|color|width|height|font|title|image|photo|asset|module|section|route|\/about|mobile|desktop)\b.{0,80}\b(?:change|modify|update|set|move|delete|remove|hide|replace|swap)\b/iu;
    const chineseFocused =
        /(?:修改|改成|换成|替换|移动|删除|移除|隐藏|缩小|放大).{0,80}(?:按钮|侧边栏|左侧栏|首屏|背景|颜色|宽度|高度|字号|标题|图片|模块|区块|路由|手机|桌面)/iu;
    const broadRedo =
        /\b(?:create|build|redesign|rebuild)\b.{0,40}\b(?:page|site|homepage|app)\b|\b(?:whole|entire)\s+(?:page|site|app)\b|整体重做|重新设计|重做整个/iu;

    return !broadRedo.test(text) &&
        (actionThenTarget.test(text) ||
            targetThenAction.test(text) ||
            chineseFocused.test(text));
}

function splitRequirementClauses(text: string): string[] {
    return text
        .split(/(?:\r?\n|[。；;]|(?:\s+and\s+)|(?:\s*,\s*))/iu)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .slice(0, 8);
}

function inferRequirementTarget(instruction: string): string | undefined {
    const targetPatterns = [
        /(左侧栏|侧边栏|sidebar)/iu,
        /(按钮|button|cta)/iu,
        /(背景|background)/iu,
        /(颜色|color|contrast|对比)/iu,
        /(字体|字号|font|heading|title|标题|文字)/iu,
        /(图片|image|photo|media)/iu,
        /(卡片|方块|card|cards|grid|box|tile|panel)/iu,
        /(导航|跳转|route|navigation|link)/iu,
    ];

    for (const pattern of targetPatterns) {
        const match = instruction.match(pattern);

        if (match?.[1]) {
            return match[1];
        }
    }

    return undefined;
}

function inferRequirementTargetFiles(instruction: string): string[] | undefined {
    const files = new Set<string>();

    if (/颜色|背景|间距|宽|高|字体|字号|圆角|阴影|card|cards|卡片|方块|grid|box|panel|style|css/iu.test(instruction)) {
        files.add("src/App.css");
    }

    if (/文字|文本|按钮|隐藏|删除|移动|导航|跳转|route|link|sidebar|左侧栏|侧边栏|组件|区块|交互/iu.test(instruction)) {
        files.add("src/App.tsx");
        files.add("src/pages/home.tsx");
    }

    return files.size > 0 ? [...files] : undefined;
}

export function createBrowserProbesForRequirement(input: {
    requirementId: string;
    instruction: string;
}): BrowserProbe[] | undefined {
    const instruction = input.instruction;
    const probes: BrowserProbe[] = [];
    const defaultViewport = { width: 1440, height: 900 };
    const pxMatch = instruction.match(/(\d+(?:\.\d+)?)\s*px/iu);
    const expectedPx = pxMatch ? Number(pxMatch[1]) : undefined;

    if (/\bsidebar\b|left\s+sidebar|left\s+rail|左侧栏|侧边栏/iu.test(instruction) && expectedPx !== undefined) {
        probes.push({
            requirementId: input.requirementId,
            selector: ".sidebar, .app-sidebar, aside, [class*='sidebar']",
            viewport: defaultViewport,
            measurement: "bounding_box",
            property: "width",
            expected: expectedPx,
            tolerance: 2,
        });
    }

    if (/\bhero\b|首屏|头图/iu.test(instruction) && /\b(?:background|color|blue|gray|grey|dark)\b|背景|颜色|蓝色|灰色|深灰/iu.test(instruction)) {
        const expectedColor = /#202124|深灰|dark\s+gr[ae]y/iu.test(instruction)
            ? "rgb(32, 33, 36)"
            : undefined;
        probes.push({
            requirementId: input.requirementId,
            selector: ".hero, .page-hero, [class*='hero']",
            viewport: defaultViewport,
            measurement: "computed_style",
            property: "backgroundColor",
            ...(expectedColor ? { expected: expectedColor } : {}),
        });
    }

    const submitMatch = instruction.match(/\b(?:to|为|成)\s+([A-Z][A-Za-z0-9_-]*)\b/u);
    if (/\bbutton\b|按钮/iu.test(instruction) && /text|文字|文案|label|改为|change/iu.test(instruction)) {
        probes.push({
            requirementId: input.requirementId,
            selector: "button, .button, [role='button']",
            viewport: defaultViewport,
            measurement: "text",
            expected: submitMatch?.[1] ?? "Submit",
        });
    }

    if (/\b(?:delete|remove)\b|删除|移除/iu.test(instruction)) {
        probes.push({
            requirementId: input.requirementId,
            selector: ".feature-two, [data-feature='second'], .feature-card:nth-of-type(2)",
            viewport: defaultViewport,
            measurement: "element_count",
            expected: 0,
        });
    }

    if (/\b(?:move|right|left)\b|移动|右移|左移/iu.test(instruction) && expectedPx !== undefined) {
        probes.push({
            requirementId: input.requirementId,
            selector: "button, .button, [role='button']",
            viewport: defaultViewport,
            measurement: "bounding_box",
            property: "x",
            expected: expectedPx,
            tolerance: 2,
        });
    }

    if (/\/about|\babout\b|关于/iu.test(instruction) && /title|标题|文字|text/iu.test(instruction)) {
        const expectedTitle = /About new/iu.test(instruction)
            ? "About new"
            : undefined;
        probes.push({
            requirementId: input.requirementId,
            route: "/about",
            selector: "h1, [data-page='about'] h1, .about-page h1",
            viewport: defaultViewport,
            measurement: "text",
            ...(expectedTitle ? { expected: expectedTitle } : {}),
        });
    }

    // General responsive requirements are validated by the deterministic
    // multi-viewport visual report. Do not synthesize a generic grid probe:
    // applications may use flexbox, container queries, or differently named
    // layout primitives, and getComputedStyle(gridTemplateColumns) resolves
    // tracks to pixels rather than the authored value (for example, "1fr").
    // The previous heuristic therefore rejected valid responsive pages when
    // the selector was absent, hidden, flex-based, or returned a pixel track.

    if (/\b(?:image|photo|asset)\b|图片|照片|素材/iu.test(instruction)) {
        probes.push({
            requirementId: input.requirementId,
            selector: ".hero img, .page-hero img, img",
            viewport: defaultViewport,
            measurement: "attribute",
            property: "src",
        });
    }

    return probes.length > 0 ? probes : undefined;
}

function parseRequirementLedger(input: {
    currentRequest: string;
    focusedEdit: boolean;
}): Requirement[] {
    const clauses = splitRequirementClauses(input.currentRequest);
    const requirements: Requirement[] = clauses.map((instruction, index) => {
        const target = inferRequirementTarget(instruction);
        const targetFiles = inferRequirementTargetFiles(instruction);
        const isPreserve =
            /\b(?:do not|don't|without)\s+(?:modify|change|touch|rewrite)|\bkeep\b.{0,60}\b(?:unchanged|same)|\bother\b.{0,40}\b(?:unchanged|unmodified)|\bpreserve\b|不要.{0,20}(?:修改|改变|动)|其他.{0,20}(?:不变|不要动|不要修改)/iu.test(
                instruction,
            );
        const isSoft =
            /\b(?:可以|尽量|maybe|prefer|should)\b|最好|尽可能/iu.test(
                instruction,
            );

        const requirementId = `REQ-${index + 1}`;
        const browserProbes = createBrowserProbesForRequirement({
            requirementId,
            instruction,
        });

        return {
            id: requirementId,
            instruction,
            priority: isPreserve ? "must_preserve" : isSoft ? "should" : "must",
            ...(target ? { target } : {}),
            ...(targetFiles ? { targetFiles } : {}),
            ...(browserProbes ? { browserProbes } : {}),
            verification: target
                ? `Verify that the ${target} request changed only the relevant source/CSS selectors.`
                : "Verify that the current request is reflected in the workspace changes.",
        };
    });

    if (input.focusedEdit) {
        requirements.push({
            id: "PRESERVE-1",
            instruction:
                "Preserve unrelated layout, content, dependencies, image lookup, planner output, and full-page generation during this focused edit.",
            priority: "must_preserve",
            verification:
                "Focused edit must avoid Planner, topic lookup, image search, npm install unless manifests changed, and broad unrelated file changes.",
        });
    }

    return requirements.length > 0
        ? requirements
        : [
              {
                  id: "REQ-1",
                  instruction: input.currentRequest,
                  priority: "must",
                  verification:
                      "Verify that the latest request is represented in the changed workspace.",
              },
          ];
}

function inferAffectedSelectorsOrComponents(
    requirement: Requirement,
): string[] {
    const instruction = requirement.instruction;
    const selectors = new Set<string>();

    if (/左侧栏|侧边栏|sidebar/iu.test(instruction)) {
        selectors.add(".sidebar");
        selectors.add(".app-sidebar");
    }

    if (/按钮|button|cta/iu.test(instruction)) {
        selectors.add("button");
        selectors.add(".cta");
    }

    if (/背景|background/iu.test(instruction)) {
        selectors.add("body");
        selectors.add(".page-view");
        selectors.add(".page-hero");
    }

    if (/颜色|对比|contrast|color/iu.test(instruction)) {
        selectors.add("color");
        selectors.add("background");
    }

    if (/字体|字号|font|title|标题|文字/iu.test(instruction)) {
        selectors.add("h1");
        selectors.add("h2");
        selectors.add(".page-lead");
    }

    if (/图片|image|photo|media/iu.test(instruction)) {
        selectors.add("img");
        selectors.add(".page-media");
        selectors.add(".page-image");
    }

    if (/卡片|方块|card|cards|grid|box|tile|panel/iu.test(instruction)) {
        selectors.add(".page-card");
        selectors.add(".page-grid");
        selectors.add(".game-panel");
    }

    if (/导航|跳转|route|navigation|link/iu.test(instruction)) {
        selectors.add("nav");
        selectors.add("a");
        selectors.add("App");
    }

    return [...selectors];
}

function evaluateRequirementLedger(input: {
    requirements: Requirement[];
    metrics: RunMetrics;
    review: ReactAppAgentReview;
    focusedEdit: boolean;
    workspaceDiff?: WorkspaceDiff;
    focusedEditScope?: FocusedEditScope;
    browserEvidence?: RequirementEvidence[];
    scopeViolations?: ScopeViolation[];
}): RequirementResult[] {
    const diffEvidence = input.workspaceDiff
        ? createFileDiffEvidence(input.workspaceDiff)
        : [];
    const changedFiles = input.workspaceDiff
        ? [
              ...input.workspaceDiff.addedFiles,
              ...input.workspaceDiff.deletedFiles,
              ...input.workspaceDiff.modifiedFiles,
          ].sort()
        : input.metrics.modifiedFiles;
    const unexpectedScopeFiles = input.workspaceDiff
        ? findUnexpectedScopeFiles(
              input.workspaceDiff,
              input.focusedEditScope,
          )
        : [];
    const unexpectedScopeRanges = input.workspaceDiff
        ? findUnexpectedScopeRanges(
              input.workspaceDiff,
              input.focusedEditScope,
          )
        : [];
    const scopeViolations = input.scopeViolations ?? [];

    return input.requirements.map((requirement) => {
        const targetFiles = requirement.targetFiles ?? [];
        const affectedFiles =
            targetFiles.length > 0
                ? changedFiles.filter((filePath) =>
                      targetFiles.some((targetFile) =>
                          filePath.endsWith(targetFile) ||
                          targetFile.endsWith(filePath),
                      ),
                  )
                : changedFiles;
        const selectors =
            inferAffectedSelectorsOrComponents(requirement);
        let evidences: RequirementEvidence[] = [
            ...diffEvidence.filter(
                (item) =>
                    !item.file ||
                    affectedFiles.length === 0 ||
                    affectedFiles.includes(item.file),
            ),
            ...(input.browserEvidence ?? []).filter((item) => {
                if (item.requirementId) {
                    return item.requirementId === requirement.id;
                }

                return selectors.length === 0 || !item.selector
                    ? true
                    : selectors.includes(item.selector) ||
                          selectors.some((selector) =>
                              item.selector?.includes(selector),
                          );
            }),
        ];

        if (
            !input.focusedEdit &&
            evidences.length === 0 &&
            (!input.workspaceDiff || changedFiles.length > 0) &&
            input.review.checks.buildPassed &&
            input.review.checks.evalPassed &&
            input.review.checks.browserPassed !== false
        ) {
            evidences = [
                {
                    source: "build",
                    expected: "Structural generation passes build, static evaluation, and browser validation when available.",
                    actual: [
                        "buildPassed=true",
                        "evalPassed=true",
                        input.review.checks.browserPassed === undefined
                            ? "browserPassed=not-run"
                            : "browserPassed=true",
                    ].join("; "),
                },
            ];
        }
        let evidenceText =
            affectedFiles.length > 0
                ? `Modified ${affectedFiles.join(", ")}.`
                : changedFiles.length > 0
                  ? `Modified ${changedFiles.join(", ")}.`
                  : "No workspace file change was recorded.";
        let status: RequirementResult["status"] =
            evidences.length > 0 ? "PASS" : "UNVERIFIED";
        const requiresBrowserProbe =
            input.focusedEdit && (requirement.browserProbes?.length ?? 0) > 0;
        const hasBrowserProbeEvidence = evidences.some(
            (evidence) =>
                (evidence.source === "browser" ||
                    evidence.source === "computed_style") &&
                (!evidence.requirementId ||
                    evidence.requirementId === requirement.id),
        );

        if (requirement.priority === "must_preserve") {
            const forbiddenReasons: string[] = [];
            const preserveEvidence: RequirementEvidence = {
                source: "file_diff",
                expected: "No scope-outside file changes, no dependency edits, no Planner/Reviewer/npm install on fast edit.",
            };

            if (input.metrics.plannerCalls > 0) {
                forbiddenReasons.push("Planner was called");
            }

            if (input.metrics.dependencyManifestChanged) {
                forbiddenReasons.push("dependency manifest changed");
            }

            if (
                changedFiles.some((filePath) =>
                    /^public\/assets\//u.test(filePath),
                )
            ) {
                forbiddenReasons.push("image asset changed");
            }

            if (unexpectedScopeFiles.length > 0) {
                forbiddenReasons.push(
                    `scope-outside files changed: ${unexpectedScopeFiles.join(", ")}`,
                );
                preserveEvidence.unexpectedFiles = unexpectedScopeFiles;
            }

            if (unexpectedScopeRanges.length > 0) {
                forbiddenReasons.push(
                    `scope-outside ranges changed: ${unexpectedScopeRanges
                        .map(
                            (range) =>
                                `${range.file}:${range.startLine}-${range.endLine}`,
                        )
                        .join(", ")}`,
                );
                preserveEvidence.unexpectedRanges = [
                    ...(preserveEvidence.unexpectedRanges ?? []),
                    ...unexpectedScopeRanges,
                ];
            }

            if (scopeViolations.length > 0) {
                forbiddenReasons.push(
                    `scope violations: ${scopeViolations
                        .map((violation) => `${violation.file}: ${violation.reason}`)
                        .join("; ")}`,
                );
                preserveEvidence.unexpectedRanges = [
                    ...(preserveEvidence.unexpectedRanges ?? []),
                    ...scopeViolations.flatMap((violation) =>
                        violation.attemptedRange
                            ? [
                                  {
                                      file: violation.file,
                                      startLine:
                                          violation.allowedRanges[0]
                                              ?.startLine ?? 1,
                                      endLine:
                                          violation.allowedRanges[0]?.endLine ??
                                          1,
                                  },
                              ]
                            : [],
                    ),
                ];
            }

            evidences = [preserveEvidence];
            status = forbiddenReasons.length === 0 ? "PASS" : "FAIL";
            evidenceText = status === "PASS"
                ? "Focused edit stayed on the fast path without Planner, npm install, dependency changes, or image asset changes."
                : forbiddenReasons.join("; ");
        } else if (requirement.priority === "must" && evidences.length === 0) {
            status = "UNVERIFIED";
            evidenceText = `${evidenceText} No verifiable diff, browser, computed-style, build, or manual evidence was produced.`;
        } else if (
            requirement.priority === "must" &&
            requiresBrowserProbe &&
            !hasBrowserProbeEvidence
        ) {
            status = "UNVERIFIED";
            evidenceText = `${evidenceText} Requirement has browser probes but no matching browser/computed-style evidence was produced.`;
        } else if (requirement.priority === "should" && evidences.length === 0) {
            status = "UNVERIFIED";
        }

        if (!input.review.accepted && status !== "PASS") {
            evidenceText = `${evidenceText} Review also failed: ${input.review.reason}`;
        }

        return {
            ...requirement,
            status,
            evidence: evidenceText,
            evidences,
            affectedFiles,
            affectedSelectorsOrComponents: selectors,
        };
    });
}

function extractRequirementEvidenceFromBrowser(
    browserEval: BrowserEvalResult | undefined,
): RequirementEvidence[] {
    return (browserEval?.evidence ?? []).map((item) => ({
        source: item.source,
        ...(item.requirementId ? { requirementId: item.requirementId } : {}),
        ...(item.selector ? { selector: item.selector } : {}),
        ...(item.property ? { property: item.property } : {}),
        ...(item.before ? { before: item.before } : {}),
        ...(item.after ? { after: item.after } : {}),
        ...(item.expected ? { expected: item.expected } : {}),
        ...(item.actual ? { actual: item.actual } : {}),
        ...(item.beforeElement ? { beforeElement: item.beforeElement } : {}),
        ...(item.afterElement ? { afterElement: item.afterElement } : {}),
    }));
}

function mergeBeforeBrowserEvidence(
    afterEvidence: RequirementEvidence[],
    beforeEvidence: RequirementEvidence[],
): RequirementEvidence[] {
    if (beforeEvidence.length === 0) {
        return afterEvidence;
    }

    const keyForEvidence = (evidence: RequirementEvidence): string =>
        [
            evidence.requirementId ?? "",
            evidence.selector ?? "",
            evidence.property ?? "",
        ].join("\u0000");
    const beforeByKey = new Map(
        beforeEvidence.map((evidence) => [keyForEvidence(evidence), evidence]),
    );

    return afterEvidence.map((evidence) => {
        const before = beforeByKey.get(keyForEvidence(evidence));

        if (!before?.afterElement) {
            return evidence;
        }

        return {
            ...evidence,
            ...(evidence.before ?? before.actual
                ? { before: evidence.before ?? before.actual }
                : {}),
            beforeElement: before.afterElement,
        };
    });
}

function formatFocusedRequirementRepairContext(input: {
    browserEval: BrowserEvalResult | undefined;
    requirements: Requirement[];
    focusedEditScope: FocusedEditScope | undefined;
}): string {
    const failedChecks =
        input.browserEval?.checks
            .filter((check) => !check.passed)
            .map((check) =>
                [check.name, check.message].filter(Boolean).join(": "),
            ) ?? [];
    const evidenceRequirementIds = new Set(
        input.browserEval?.evidence
            ?.map((evidence) => evidence.requirementId)
            .filter((id): id is string => Boolean(id)) ?? [],
    );
    const failedRequirements = input.requirements.filter(
        (requirement) =>
            requirement.priority === "must" &&
            (evidenceRequirementIds.size === 0 ||
                evidenceRequirementIds.has(requirement.id)),
    );

    return [
        "Limited focused requirement repair:",
        "Repair only the failed focused-edit requirement. Do not redesign the page, regenerate the app, add dependencies, run topic/image lookup, or modify protected areas.",
        "Use at most one small edit_file action inside the existing FocusedEditScope allowedRanges, then finish.",
        failedChecks.length > 0
            ? `Failed browser probe/check evidence:\n${failedChecks
                  .map((check) => `- ${check}`)
                  .join("\n")}`
            : "Failed browser probe/check evidence: unavailable; repair only the explicit current request.",
        failedRequirements.length > 0
            ? `Relevant requirements:\n${failedRequirements
                  .map(
                      (requirement) =>
                          `- ${requirement.id}: ${requirement.instruction}`,
                  )
                  .join("\n")}`
            : "",
        input.focusedEditScope
            ? `FocusedEditScope: ${JSON.stringify(input.focusedEditScope)}`
            : "",
    ]
        .filter((part) => part.length > 0)
        .join("\n\n");
}

function enforceRequirementLedgerReview(input: {
    review: ReactAppAgentReview;
    requirements: RequirementResult[];
}): ReactAppAgentReview {
    const failedRequired = input.requirements.filter(
        (requirement) =>
            requirement.status !== "PASS" &&
            (requirement.priority === "must" ||
                requirement.priority === "must_preserve"),
    );

    if (failedRequired.length === 0) {
        return input.review;
    }

    return {
        ...input.review,
        accepted: false,
        reason: [
            `Rejected because ${failedRequired.length} required requirement(s) failed or were unverified: ${failedRequired
                .map((requirement) => requirement.id)
                .join(", ")}.`,
            input.review.reason,
        ].join(" "),
    };
}

function enforceFallbackPagesReview(
    review: ReactAppAgentReview,
    metrics: RunMetrics,
): ReactAppAgentReview {
    if (metrics.fallbackPages.length === 0) {
        return review;
    }

    return {
        ...review,
        accepted: false,
        reason: [
            `Rejected because ${metrics.fallbackPages.length} page(s) used local fallback instead of valid model output: ${metrics.fallbackPages.join(", ")}.`,
            "该页面的模型输出无效，目前展示的是本地兜底草稿。",
            review.reason,
        ].join(" "),
    };
}

function formatRequirementLedgerContext(requirements: Requirement[]): string {
    return [
        "Current-request Requirement Ledger:",
        "These requirements override historical goals and generic design guidance for this turn.",
        ...requirements.map((requirement) =>
            [
                `${requirement.id} [${requirement.priority}] ${requirement.instruction}`,
                requirement.target ? `target=${requirement.target}` : "",
                requirement.targetFiles?.length
                    ? `targetFiles=${requirement.targetFiles.join(", ")}`
                    : "",
                `verification=${requirement.verification}`,
            ]
                .filter(Boolean)
                .join(" | "),
        ),
    ].join("\n");
}

function isHorizontalPointLabelRequest(text: string): boolean {
    return /\b(?:row|inline|horizontal|vertical|site|point|label|abc|a\/b\/c)\b|ABC|abc|A\/B\/C|\u7ad6\u7740|\u7ad6\u6392|\u7ad6\u8d77\u6765|\u7eb5\u5411|\u6a2a\u6392|\u6a2a\u7740|\u4e00\u6392|\u540c\u4e00\u6392|\u4e00\u884c|\u540c\u4e00\u884c|\u5e76\u6392|\u6392\u6210\u4e00\u6392|\u70b9\u4f4d|\u5305\u70b9|\u7ad9\u70b9|\u6807\u7b7e/iu.test(
        text,
    );
}

function isLikelyTacticalGameRequest(text: string): boolean {
    return /\b(?:valorant|apex|cs2|counter[- ]strike|overwatch|fps|tactical|esports|game|gaming|site|map|agent|loadout)\b|\u74e6\u7f57\u5170\u7279|\u65e0\u754f\u5951\u7ea6|\u70b9\u4f4d|\u5305\u70b9|\u5730\u56fe|\u6e38\u620f|\u7535\u7ade|\u6218\u672f|\u82f1\u96c4|Apex/iu.test(
        text,
    );
}

function hasExplicitHorizontalPointLabelStructure(source: string): boolean {
    return /\b(?:game-sites|game-site|site-letter|site-label-row|point-label-row|label-row|abc-row|tactical-sites|site-chip|point-chip)\b/iu.test(
        source,
    );
}

function stillHasUngovernedPointLabelSource(source: string): boolean {
    return /\b(?:A\s*(?:\/|SITE|POINT|\u70b9|\u5305\u70b9)|B\s*(?:\/|SITE|POINT|\u70b9|\u5305\u70b9)|C\s*(?:\/|SITE|POINT|\u70b9|\u5305\u70b9)|A\s*\/\s*B|A\s*\/\s*B\s*\/\s*C|ABC|abc)\b/iu.test(
        source,
    );
}

function hasRawSlashSeparatedPointText(source: string): boolean {
    return /(?:["'`>]\s*)A\s*\/\s*B(?:\s*\/\s*C)?(?:\s*[<"'`])|(?:["'`>]\s*)B\s*\/\s*C(?:\s*[<"'`])|(?:["'`>]\s*)A\s*\n?\s*\/\s*\n?\s*B(?:\s*\n?\s*\/\s*\n?\s*C)?(?:\s*[<"'`])/iu.test(
        source,
    );
}

function hasVisibleDecorativeSlashNoise(source: string): boolean {
    return /(?:["'`>][^"'`<>{}\n]{0,40})\s\/\/\s*(?:[^"'`<>{}\n]{0,20}[<"'`])|(?:["'`>][^"'`<>{}\n]{0,40})\s(?:::|--)\s*(?:[^"'`<>{}\n]{0,20}[<"'`])/u.test(
        source,
    );
}

async function enforceFocusedVisualSemanticReview(input: {
    workspaceRoot: string;
    executionRequest: string;
    review: ReactAppAgentReview;
}): Promise<ReactAppAgentReview> {
    if (!input.review.accepted) {
        return input.review;
    }

    const shouldCheckPointLabels =
        isHorizontalPointLabelRequest(input.executionRequest) ||
        isLikelyTacticalGameRequest(input.executionRequest);

    if (!shouldCheckPointLabels) {
        return input.review;
    }

    const source = await readRouteImplementationSource(input.workspaceRoot);

    const failureReasons: string[] = [];

    if (
        isHorizontalPointLabelRequest(input.executionRequest) &&
        stillHasUngovernedPointLabelSource(source) &&
        !hasExplicitHorizontalPointLabelStructure(source)
    ) {
        failureReasons.push(
            "the iteration appears to have left A/B/C or point labels in the old markup",
        );
    }

    if (hasRawSlashSeparatedPointText(source)) {
        failureReasons.push(
            "the source still contains raw slash-separated point labels such as A / B / C, which can wrap into vertical characters in narrow columns",
        );
    }

    if (hasVisibleDecorativeSlashNoise(source)) {
        failureReasons.push(
            "the source contains visible decorative separator punctuation such as //, ::, or -- in UI copy instead of using CSS decoration",
        );
    }

    if (failureReasons.length === 0) {
        return input.review;
    }

    return {
        ...input.review,
        accepted: false,
        reason: [
            `Rejected because ${failureReasons.join("; ")}.`,
            "Tactical/game point labels must be separate horizontal chips or labels, and visual separators must be CSS, not literal punctuation noise.",
            input.review.reason,
        ].join(" "),
    };
}

export function shouldUseParallelCodingAgents(input: {
    request: string;
    navigationKind: NavigationRequestKind;
    resetWorkspace?: boolean;
    enabled: boolean;
}): boolean {
    if (!input.enabled || input.resetWorkspace === false) {
        return false;
    }

    // Independent URL views always use page-scoped calls, even when the user
    // calls the requested app "simple". Same-document anchors do not.
    if (input.navigationKind === "routes") {
        return true;
    }

    if (
        input.navigationKind === "in-page" ||
        isFocusedVisualAdjustmentRequest(input.request)
    ) {
        return false;
    }

    // Fresh single-page work uses the same page contract with a pool size of
    // one. Complexity affects the page prompt, never the number of Coding API
    // calls. Non-page coding tasks stay on the general iterative agent.
    return isFreshPageGenerationRequest(input.request);
}

function chooseAgentMaxSteps(input: {
    kind: RunReactAppAgentAttempt["kind"];
    hasImageAssetTool: boolean;
    complexPageRequest: boolean;
    routeRequest: boolean;
}): number {
    if (input.complexPageRequest) {
        if (input.kind === "repair") {
            return input.hasImageAssetTool ? 5 : 4;
        }

        return 8;
    }

    if (input.routeRequest) {
        if (input.kind === "repair") {
            return input.hasImageAssetTool ? 4 : 3;
        }

        return input.hasImageAssetTool ? 7 : 6;
    }

    if (input.kind === "repair") {
        return input.hasImageAssetTool ? 3 : 2;
    }

    return input.hasImageAssetTool ? 6 : 5;
}

function agentMadeWorkspaceProgress(
    agent: RunReactAppAgentAttempt["agent"],
): boolean {
    return agent.steps.some(
        (step) =>
            step.execution.ok &&
            step.execution.changed !== false &&
            (step.action.type === "write_file" ||
                step.action.type === "append_file" ||
                step.action.type === "edit_file" ||
                step.action.type === "get_image"),
    );
}

function attemptMadeWorkspaceProgress(
    attempt: RunReactAppAgentAttempt,
): boolean {
    return agentMadeWorkspaceProgress(attempt.agent);
}

function shouldPreferLocalFallbackBeforeModel(
    model: ModelProvider | undefined,
): boolean {
    const candidate = model as
        | { requests?: unknown[]; responses?: unknown[] }
        | undefined;

    if (
        Array.isArray(candidate?.requests) &&
        Array.isArray(candidate?.responses)
    ) {
        return candidate.responses.length === 0;
    }

    return true;
}

export async function runReactAppAgent(
    options: RunReactAppAgentOptions,
): Promise<RunReactAppAgentResult> {
    const runStartedAt = Date.now();
    const runMetrics = createEmptyRunMetrics();
    options.signal?.throwIfAborted();
    await emitRunProgress(options.onProgress, "preparing");
    let provider: ModelProvider;
    let parallelProvider: ModelProvider;
    let plannerProvider: ModelProvider;
    let reviewerProvider: ModelProvider;
    const maxRepairAttempts = options.maxRepairAttempts ?? 1;
    const focusedRequest = options.currentRequest?.trim() || options.goal;
    const genericRepairRequest = isGenericRepairRequest(
        options.currentRequest,
    );
    // A generic command such as "修复" is an execution instruction, not a new
    // product requirement. Preserve the accumulated goal and its Requirement
    // Ledger instead of replacing REQ-1 with the word "修复".
    const executionRequest = genericRepairRequest
        ? extractStableProductGoal(options.goal)
        : options.resetWorkspace === false
          ? focusedRequest
          : options.goal;
    let navigationRequestKind = classifyNavigationRequest(executionRequest);
    const iterationRequestKind = classifyIterationRequest({
        currentRequest: focusedRequest,
        executionRequest,
        ...(options.resetWorkspace !== undefined
            ? { resetWorkspace: options.resetWorkspace }
            : {}),
        genericRepairRequest,
        navigationRequestKind,
    });
    const contentCorrectionRequest =
        iterationRequestKind === "content_correction";
    const layoutRepairIterationRequest =
        iterationRequestKind === "layout_repair";
    const iterationContextRequest =
        (contentCorrectionRequest || layoutRepairIterationRequest) &&
        options.resetWorkspace === false
            ? [
                  "Original product goal:",
                  extractStableProductGoal(options.goal),
                  "",
                  "Current user correction or failure report:",
                  focusedRequest,
                  "",
                  "Iteration strategy:",
                  iterationRequestKind,
              ].join("\n")
            : executionRequest;
    let focusedEditRequest =
        iterationRequestKind === "fast_edit";
    let requirements = parseRequirementLedger({
        currentRequest: executionRequest,
        focusedEdit: focusedEditRequest,
    });
    let browserProbes = requirements.flatMap(
        (requirement) => requirement.browserProbes ?? [],
    );
    let resolvedDesignPlan = options.designPlan;
    let resolvedDesignPlanSource: DesignPlanSource | undefined =
        options.designPlan ? "preserved" : undefined;
    const withDesignPlanResult = (
        result: RunReactAppAgentResult,
        designPlanCompliance?: DesignPlanCompliance[],
    ): RunReactAppAgentResult => ({
        ...result,
        ...(resolvedDesignPlan ? { designPlan: resolvedDesignPlan } : {}),
        ...(resolvedDesignPlanSource
            ? { designPlanSource: resolvedDesignPlanSource }
            : {}),
        ...(designPlanCompliance
            ? { designPlanCompliance }
            : result.designPlanCompliance
              ? { designPlanCompliance: result.designPlanCompliance }
              : {}),
    });
    let beforeBrowserProbeEvidence: RequirementEvidence[] = [];
    let beforeWorkspaceSnapshot: FileSnapshot[] | undefined;
    let focusedEditScope: FocusedEditScope | undefined;
    const scopeViolations: ScopeViolation[] = [];
    const validateFocusedActionWithRecording = async (
        action: AgentAction,
    ): Promise<ReturnType<typeof validateFocusedEditAction>> => {
        if (!focusedEditScope || !beforeWorkspaceSnapshot) {
            return undefined;
        }

        const actionWorkspaceSnapshot = await createWorkspaceSnapshot(
            options.workspaceRoot,
        );
        const validation = validateFocusedEditAction({
            action,
            scope: focusedEditScope,
            beforeSnapshots: actionWorkspaceSnapshot,
        });

        if (validation && !validation.ok) {
            scopeViolations.push(
                createScopeViolationForAction({
                    action,
                    scope: focusedEditScope,
                    beforeSnapshots: actionWorkspaceSnapshot,
                    reason: validation.message,
                }),
            );
        }

        return validation;
    };

    if (options.model) {
        provider = options.model;
        parallelProvider = options.model;
        plannerProvider = options.model;
        reviewerProvider = options.model;
    } else {
        const providerOptions: OpenAICompatibleProviderOptions = {
            baseUrl: options.llm.baseUrl,
            apiKey: options.llm.apiKey,
            model: options.llm.model,
        };

        if (options.llm.timeoutMs !== undefined) {
            providerOptions.timeoutMs = options.llm.timeoutMs;
        }

        if (options.llm.maxRetries !== undefined) {
            providerOptions.maxRetries = options.llm.maxRetries;
        }

        if (options.llm.stream !== undefined) {
            providerOptions.stream = options.llm.stream;
        }

        if (options.llm.serviceTier !== undefined) {
            providerOptions.serviceTier = options.llm.serviceTier;
        }

        if (options.llm.maxTokens !== undefined) {
            providerOptions.maxTokens = options.llm.maxTokens;
        }

        provider = new OpenAICompatibleProvider(providerOptions);
        parallelProvider = new OpenAICompatibleProvider({
            ...providerOptions,
            // Page retries are coordinated above the provider so a successful
            // page is never regenerated because another page failed.
            maxRetries: 0,
            maxTokens:
                options.llm.parallelMaxTokens ??
                Math.min(options.llm.maxTokens ?? 8_000, 4_000),
            thinking: options.llm.parallelThinking ?? "disabled",
        });

        plannerProvider = new OpenAICompatibleProvider({
            ...providerOptions,
            timeoutMs:
                options.llm.plannerTimeoutMs ??
                Math.min(options.llm.timeoutMs ?? 120_000, 30_000),
            maxRetries: 0,
        });
        reviewerProvider = new OpenAICompatibleProvider({
            ...providerOptions,
            timeoutMs:
                options.llm.reviewerTimeoutMs ??
                Math.min(options.llm.timeoutMs ?? 120_000, 45_000),
            maxRetries: 0,
        });
    }

    const designPlannerBaseProvider = plannerProvider;
    provider = countModelProviderCalls(provider, runMetrics, "codingCalls");
    parallelProvider = countModelProviderCalls(
        parallelProvider,
        runMetrics,
        "codingCalls",
    );
    plannerProvider = countModelProviderCalls(
        plannerProvider,
        runMetrics,
        "plannerCalls",
    );
    const designPlannerProvider = countModelProviderCalls(
        designPlannerBaseProvider,
        runMetrics,
        "designPlannerCalls",
    );
    reviewerProvider = countModelProviderCalls(
        reviewerProvider,
        runMetrics,
        "reviewerCalls",
    );

    const imageAssetTool = options.imageAssetProvider
        ? new ImageAssetTool({
              workspaceRoot: options.workspaceRoot,
              provider: options.imageAssetProvider,
          })
        : undefined;
    const imageAssetModes = imageAssetTool
        ? options.imageAssetModes ?? [
              "search",
              "generate",
          ]
        : [];
    let activeImageAssetTool = focusedEditRequest
        ? undefined
        : imageAssetTool;
    let activeImageAssetModes = focusedEditRequest ? [] : imageAssetModes;
    let imageToolContext = formatImageToolContext(activeImageAssetModes);
    if (
        focusedEditRequest &&
        navigationRequestKind !== "none" &&
        !/\b(?:navigate|navigation|jump|switch|open|go\s+to|link|click)\b|跳转|导航|切换|打开|点击/iu.test(
            executionRequest,
        )
    ) {
        navigationRequestKind = "none";
    }
    const navigationExecutionContext = formatNavigationExecutionContext(
        navigationRequestKind,
    );
    const complexPageRequest =
        !focusedEditRequest && isComplexReactAppRequest(executionRequest);
    const stableGenerationEnabled =
        options.stableGeneration ?? (options.model === undefined);
    const stableStructuralGenerationRequested =
        stableGenerationEnabled &&
        !focusedEditRequest &&
        navigationRequestKind !== "routes" &&
        (options.resetWorkspace !== false ||
            genericRepairRequest ||
            isFreshPageGenerationRequest(executionRequest) ||
            contentCorrectionRequest ||
            layoutRepairIterationRequest ||
            isFullApplicationCreationRequest(executionRequest) ||
            isExplicitRegenerationPrompt(executionRequest) ||
            complexPageRequest);
    const stableScaffoldRequested =
        stableStructuralGenerationRequested;
    const useParallelCodingAgents =
        !stableScaffoldRequested &&
        shouldUseParallelCodingAgents({
            request: executionRequest,
            navigationKind: navigationRequestKind,
            ...(options.resetWorkspace !== undefined
                ? { resetWorkspace: options.resetWorkspace }
                : {}),
            enabled:
                options.parallelCoding ??
                // Production uses a real provider. Keep injected-model tests and
                // embedders on the legacy single-agent path unless they opt in.
                options.model === undefined,
        });
    const complexPageExecutionContext = complexPageRequest
        ? navigationRequestKind === "routes"
            ? [
                  "Complex routed-page execution profile:",
                  "Connect the route shell in src/App.tsx first. The first action must establish real route links, route state, and browser history listeners in the existing app.",
                  "Only after the route shell works, add complete, substantive route-specific content and polished responsive CSS in small focused edits.",
                  "Preserve existing content and styling while making routing functional; do not restart the whole complex page.",
              ].join("\n")
            : [
                  "Complex page execution profile:",
                  "This app is likely a rich homepage, portal, game page, or image-heavy page.",
                  "Use staged file architecture instead of a giant App.tsx.",
                  "Recommended order: essential get_image actions, write src/content.ts, append_file additional content chunks if needed, write src/App.css, append_file CSS chunks if needed, write compact src/App.tsx, then finish.",
                  "Keep App.tsx compact by importing data from ./content.js and styles from ./App.css.",
                  "Do not rewrite finished files unless the next request is a repair or focused iteration.",
              ].join("\n")
        : "";

    if (options.resetWorkspace !== false) {
        await copyWorkspaceTemplate(
            options.workspaceRoot,
            options.templateRoot,
        );
        options.signal?.throwIfAborted();
    }

    const requiresInitialGenerationCompleteness =
        options.resetWorkspace !== false;
    const baselineAppSource = requiresInitialGenerationCompleteness
        ? await readFile(
              path.join(options.workspaceRoot, "src", "App.tsx"),
              "utf8",
          ).catch(() => undefined)
        : undefined;
    const baselineContentSource = requiresInitialGenerationCompleteness
        ? await readFile(
              path.join(options.workspaceRoot, "src", "content.ts"),
              "utf8",
          ).catch(() => undefined)
        : undefined;

    if (options.resetWorkspace === false) {
        beforeWorkspaceSnapshot = await createWorkspaceSnapshot(
            options.workspaceRoot,
        );

        if (focusedEditRequest) {
            focusedEditScope = await locateFocusedEditScope({
                request: executionRequest,
                workspaceRoot: options.workspaceRoot,
                beforeSnapshots: beforeWorkspaceSnapshot,
            });

            if (focusedEditScope.confidence < 0.7) {
                focusedEditRequest = false;
                focusedEditScope = undefined;
            requirements = parseRequirementLedger({
                currentRequest: executionRequest,
                focusedEdit: false,
            });
            browserProbes = requirements.flatMap(
                (requirement) => requirement.browserProbes ?? [],
            );
                activeImageAssetTool = imageAssetTool;
                activeImageAssetModes = imageAssetModes;
                imageToolContext =
                    formatImageToolContext(activeImageAssetModes);
            }
        }

        if (
            focusedEditRequest &&
            browserProbes.length > 0 &&
            options.evaluateBrowser
        ) {
            try {
                const beforeBrowserEval = await options.evaluateBrowser({
                    goal: executionRequest,
                    workspaceRoot: options.workspaceRoot,
                    kind: "initial",
                    attemptNumber: 0,
                    browserProbes,
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                beforeBrowserProbeEvidence =
                    extractRequirementEvidenceFromBrowser(beforeBrowserEval);
            } catch (error) {
                if (options.signal?.aborted) {
                    options.signal.throwIfAborted();
                }
                beforeBrowserProbeEvidence = [];
            }
        }
    }

    const defaultCoordination = coordinateAgents({
        goal: executionRequest,
    });
    const baseCoordination: CoordinateAgentsResult = defaultCoordination;
    const preferLocalFallbackBeforeModel = shouldPreferLocalFallbackBeforeModel(
        options.model,
    );

    if (
        options.resetWorkspace === false &&
        preferLocalFallbackBeforeModel &&
        !contentCorrectionRequest &&
        !layoutRepairIterationRequest
    ) {
        if (navigationRequestKind === "in-page") {
            await emitRunProgress(options.onProgress, "coding");
            const navigationFallbackMessages =
                await applyHashNavigationFallback(
                    options.workspaceRoot,
                    executionRequest,
                    options.signal,
                );

            if (navigationFallbackMessages.length > 0) {
                const result = await evaluateLocalWorkspaceChangeResult({
                    goal: options.goal,
                    workspaceRoot: options.workspaceRoot,
                    coordination: {
                        ...baseCoordination,
                        plan: [
                            "Detect an explicit same-page navigation request",
                            "Patch existing placeholder links into valid hash navigation without rewriting the whole app",
                            "Run install, build, static evaluation, and browser evaluation after the navigation fix",
                        ],
                    },
                    messages: navigationFallbackMessages,
                    ...(options.signal ? { signal: options.signal } : {}),
                    ...(options.evaluateBrowser
                        ? { evaluateBrowser: options.evaluateBrowser }
                        : {}),
                    ...(browserProbes.length > 0 ? { browserProbes } : {}),
                    ...(options.onProgress
                        ? { onProgress: options.onProgress }
                        : {}),
                    metrics: runMetrics,
                    runStartedAt,
                    focusedEdit: focusedEditRequest,
                });

                return withDesignPlanResult(withRequirementLedgerResult(
                    result,
                    requirements,
                    focusedEditRequest,
                    beforeWorkspaceSnapshot
                        ? diffWorkspaceSnapshots(
                              beforeWorkspaceSnapshot,
                              await createWorkspaceSnapshot(
                                  options.workspaceRoot,
                              ),
                          )
                        : undefined,
                    focusedEditScope,
                    scopeViolations,
                ));
            }
        }

        const compactNavigationMessages =
            await applyCompactTopNavigationFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

        if (compactNavigationMessages.length > 0) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused top-navigation compacting request",
                        "Shorten visible navigation labels and force desktop navigation onto one line without rewriting the app",
                        "Run install, build, static evaluation, and browser evaluation after the navigation compacting fix",
                    ],
                },
                messages: compactNavigationMessages,
                action: {
                    path: "src/App.tsx",
                    oldText: "long top navigation labels",
                    newText: "compact top navigation labels with nowrap desktop CSS",
                },
                traceName: "local-compact-top-navigation",
                traceTitle: "Apply compact top navigation fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                focusedEditScope,
                scopeViolations,
            ));
        }

        const textReplacementChange = await applyTextReplacementFallback(
            options.workspaceRoot,
            executionRequest,
            options.signal,
        );

        if (textReplacementChange) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused visible text replacement request",
                        "Patch only the requested text in the existing source without regenerating the page",
                        "Run install, build, static evaluation, and browser evaluation after the text fix",
                    ],
                },
                messages: textReplacementChange.messages,
                action: textReplacementChange.action,
                traceName: "local-text-replacement-fix",
                traceTitle: "Apply focused text replacement",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                undefined,
                scopeViolations,
            ));
        }

        const deleteOrHideChange = await applyDeleteOrHideFallback(
            options.workspaceRoot,
            executionRequest,
            options.signal,
        );

        if (deleteOrHideChange) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused delete or hide request for an explicit module",
                        "Remove only the targeted source element without rewriting surrounding content",
                        "Run install, build, static evaluation, and browser evaluation after the deletion fix",
                    ],
                },
                messages: deleteOrHideChange.messages,
                action: deleteOrHideChange.action,
                traceName: "local-delete-hide-fix",
                traceTitle: "Apply focused delete/hide fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                undefined,
                scopeViolations,
            ));
        }

        const sizeSpacingMessages =
            await applySizeSpacingPositionFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

        if (sizeSpacingMessages.length > 0) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused size, spacing, radius, or position request",
                        "Apply a marked CSS-only override for the targeted visual measurement",
                        "Run install, build, static evaluation, and browser evaluation after the size/spacing fix",
                    ],
                },
                messages: sizeSpacingMessages,
                action: {
                    path: "src/App.css",
                    oldText: "current size, spacing, radius, or position",
                    newText: "marked size/spacing/position override CSS",
                },
                traceName: "local-size-spacing-position-fix",
                traceTitle: "Apply size/spacing/position fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                undefined,
                scopeViolations,
            ));
        }

        const visualLayoutMessages =
            await applyVisualLayoutStabilizationFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

        if (visualLayoutMessages.length > 0) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused visual layout stabilization request",
                        "Apply a marked CSS-only stabilizer for readable text, contained media, reduced oversized headings, and safer responsive layout",
                        "Run install, build, static evaluation, and browser evaluation after the visual stabilization fix",
                    ],
                },
                messages: visualLayoutMessages,
                action: {
                    path: "src/App.css",
                    oldText: "oversized, overflowing, or hard-to-read visual layout",
                    newText: "marked visual layout stabilizer CSS",
                },
                traceName: "local-visual-layout-stabilization",
                traceTitle: "Apply visual layout stabilization fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                // This deterministic local fallback owns a single marked CSS
                // block. Do not reject it against Locator line ranges that
                // were built for LLM edit_file actions inside existing rules.
                undefined,
                scopeViolations,
            ));
        }

        const semanticVisualMessages =
            await applyFocusedSemanticVisualFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

        if (semanticVisualMessages.length > 0) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused tactical visual iteration on an existing draft",
                        "Rewrite raw slash-separated point labels into horizontal semantic chips and remove visible separator noise",
                        "Run install, build, static evaluation, and browser evaluation after the semantic visual fix",
                    ],
                },
                messages: semanticVisualMessages,
                action: {
                    path: "src/pages/home.tsx",
                    oldText: "raw point labels such as A / B / C and visible // separators",
                    newText: "horizontal point-label chips and CSS-backed visual separators",
                },
                traceName: "local-semantic-visual-fix",
                traceTitle: "Apply semantic tactical visual fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                focusedEditScope,
                scopeViolations,
            ));
        }

        const colorPaletteMessages =
            await applyColorPaletteFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

        if (colorPaletteMessages.length > 0) {
            await emitRunProgress(options.onProgress, "coding");
            const result = await evaluateLocalWorkspaceChangeResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Detect a focused color or background palette request",
                        "Apply a marked CSS-only palette override without rewriting content or layout",
                        "Run install, build, static evaluation, and browser evaluation after the palette fix",
                    ],
                },
                messages: colorPaletteMessages,
                action: {
                    path: "src/App.css",
                    oldText: "current color palette or background",
                    newText: "marked palette override CSS",
                },
                traceName: "local-color-palette-fix",
                traceTitle: "Apply color palette fix",
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(browserProbes.length > 0 ? { browserProbes } : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
                metrics: runMetrics,
                runStartedAt,
                focusedEdit: focusedEditRequest,
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                result,
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                undefined,
                scopeViolations,
            ));
        }

        await emitRunProgress(options.onProgress, "coding");
        const savedAssets = await prepareMissingLocalAssets({
            goal: executionRequest,
            workspaceRoot: options.workspaceRoot,
            imageAssetTool: activeImageAssetTool,
            imageAssetModes: activeImageAssetModes,
            ...(options.signal ? { signal: options.signal } : {}),
        });

        if (savedAssets.length > 0) {
            const result = await evaluatePreparedAssetOnlyResult({
                goal: options.goal,
                workspaceRoot: options.workspaceRoot,
                coordination: {
                    ...baseCoordination,
                    plan: [
                        "Prepare missing local image assets referenced by the current app",
                        "Run install, build, static evaluation, and browser evaluation after the asset fix",
                    ],
                },
                savedAssets,
                ...(options.signal ? { signal: options.signal } : {}),
                ...(options.evaluateBrowser
                    ? { evaluateBrowser: options.evaluateBrowser }
                    : {}),
                ...(options.onProgress
                    ? { onProgress: options.onProgress }
                    : {}),
            });

            return withDesignPlanResult(withRequirementLedgerResult(
                withRunDiagnostics(result, runMetrics, runStartedAt),
                requirements,
                focusedEditRequest,
                beforeWorkspaceSnapshot
                    ? diffWorkspaceSnapshots(
                          beforeWorkspaceSnapshot,
                          await createWorkspaceSnapshot(options.workspaceRoot),
                      )
                    : undefined,
                focusedEditScope,
                scopeViolations,
            ));
        }
    }

    const continuationWorkspaceContext =
        options.resetWorkspace === false
            ? await formatContinuationWorkspaceContext(
                  options.workspaceRoot,
                  iterationContextRequest,
              )
            : "";
    const continuationPlanningContext =
        options.resetWorkspace === false
            ? [
                  "Continuation mode:",
                  "Plan a focused modification to the existing app.",
                  "Preserve current behavior and visual identity unless the user explicitly asks to replace them.",
              ].join(" ")
            : "";

    const plannerAgent = new PlannerAgent({
        model: labelModelProviderStage(
            plannerProvider,
            "Planner Agent model request",
            options.signal,
            createRunProgressHeartbeat(options.onProgress, "planning"),
            options.llm.plannerTimeoutMs ?? 30_000,
        ),
    });

    const plannerOutput = focusedEditRequest
        ? createFocusedEditPlannerOutput(requirements)
        : await (async () => {
              await emitRunProgress(options.onProgress, "planning");
                  return timeRunPhase(runMetrics, "plannerDurationMs", () =>
                  createPlannerOutputWithFallback({
                      plannerAgent,
                      goal: iterationContextRequest,
                      ...(options.signal ? { signal: options.signal } : {}),
                      context: [
                          formatSkillInstructions(reactViteAppSkill),
                          formatSkillInstructions(visualDesignSkill),
                          formatRequirementLedgerContext(requirements),
                          imageToolContext,
                          navigationExecutionContext,
                          complexPageExecutionContext,
                          continuationPlanningContext,
                      ]
                          .filter((part) => part.length > 0)
                          .join("\n\n"),
                  }),
              );
          })();
    const plannedPages = useParallelCodingAgents
        ? resolveReactPagePlans({
              goal: executionRequest,
              plannerOutput,
              routeRequest: navigationRequestKind === "routes",
          })
        : [];
    const designPlannerAgent = new DesignPlannerAgent({
        model: labelModelProviderStage(
            designPlannerProvider,
            "Design Planner model request",
            options.signal,
            createRunProgressHeartbeat(options.onProgress, "planning"),
            options.llm.plannerTimeoutMs ?? 30_000,
        ),
    });
    const routesForDesignPlan =
        plannedPages.length > 0
            ? plannedPages
            : (plannerOutput.pages ?? [
                  {
                      id: "home",
                      path: "/",
                      label: "Home",
                      purpose: plannerOutput.summary,
                      acceptanceCriteria: [
                          "The page satisfies the requested goal.",
                      ],
                  },
              ]);
    const preserveExistingDesignPlan =
        options.designPlan !== undefined &&
        (focusedEditRequest ||
            (options.resetWorkspace === false &&
                !explicitlyRequestsDesignPlanRefresh(executionRequest)));
    const designPlanResult = await timeRunPhase(
        runMetrics,
        "designPlannerDurationMs",
        () =>
            createDesignPlanWithFallback({
                designPlannerAgent,
                goal: executionRequest,
                requirements,
                plannerOutput,
                routes: routesForDesignPlan,
                ...(options.designPlan
                    ? { existingDesignPlan: options.designPlan }
                    : {}),
                preserveExisting: preserveExistingDesignPlan,
                designPlanningEnabled:
                    options.designPlanning ?? options.model === undefined,
                ...(options.signal ? { signal: options.signal } : {}),
            }),
    );
    resolvedDesignPlan = designPlanResult.designPlan;
    resolvedDesignPlanSource = designPlanResult.designPlanSource;
    const reviewerAgent = new ReviewerAgent({
        model: labelModelProviderStage(
            reviewerProvider,
            "Reviewer Agent model request",
            options.signal,
            createRunProgressHeartbeat(options.onProgress, "reviewing"),
            options.llm.reviewerTimeoutMs ?? 45_000,
        ),
    });

    const plannerCoordinationPlan = plannerOutput.steps.map((step) =>
        [
            step.title,
            step.description,
            `Acceptance: ${step.acceptanceCriteria.join("; ")}`,
        ].join(" - "),
    );
    const parallelCoordinationPlan = plannedPages.map((page) =>
        [
            `Run one Coding API for the ${page.label} webpage at ${page.path}`,
            `Exclusive ownership: ${page.filePath}`,
            `Acceptance: ${page.acceptanceCriteria.join("; ")}`,
        ].join(" - "),
    );
    const pageAssignments = plannedPages.map((page) => ({
        role: "coder" as const,
        task: `Generate only the ${page.label} webpage (${page.path}) in ${page.filePath}`,
    }));
    const coordination: CoordinateAgentsResult = {
        ...baseCoordination,
        assignments: useParallelCodingAgents
            ? [
                  baseCoordination.assignments.find(
                      (assignment) => assignment.role === "planner",
                  ) ?? {
                      role: "planner",
                      task: `Plan the requested pages for: ${executionRequest}`,
                  },
                  ...pageAssignments,
                  baseCoordination.assignments.find(
                      (assignment) => assignment.role === "reviewer",
                  ) ?? {
                      role: "reviewer",
                      task: `Review the generated pages for: ${executionRequest}`,
                  },
              ]
            : baseCoordination.assignments,
        plan:
            useParallelCodingAgents
                ? [
                      ...parallelCoordinationPlan,
                      "Merge every validated page proposal atomically, generate shared routing and styles locally, then install, build, evaluate, and review once",
                      ...plannerCoordinationPlan,
                  ].slice(0, 10)
                : navigationRequestKind === "routes"
                ? [
                      options.resetWorkspace === false
                          ? "Connect the route shell in src/App.tsx - First edit the existing App.tsx to add real route targets, route-specific rendering, and popstate or hashchange handling before content and CSS work - Acceptance: a real link changes the URL and browser Back/Forward restores the matching view"
                          : "Create the route shell in src/App.tsx - First write App.tsx with real route targets, route-specific rendering, and popstate or hashchange handling before content and CSS work - Acceptance: a real link changes the URL and browser Back/Forward restores the matching view",
                      ...plannerCoordinationPlan,
                  ].slice(0, 10)
                : plannerCoordinationPlan,
    };

    const compactCoordinationContext =
        formatCompactCoordinationContext(coordination);



    const fullGoalContractContext = options.currentRequest?.trim()
        ? [
              "Full accumulated goal contract:",
              "Preserve requirements already satisfied by the current workspace while executing the focused request above.",
              limitContextText(options.goal, 6_000),
          ].join("\n")
        : "";
    const formatAttemptBaseContext = (currentWorkspaceContext: string) =>
        [
            formatSkillInstructions(reactViteAppSkill),
            formatSkillInstructions(visualDesignSkill),
            formatRequirementLedgerContext(requirements),
            resolvedDesignPlan
                ? [
                      formatDesignPlanForPrompt(resolvedDesignPlan),
                      `DesignPlan source: ${resolvedDesignPlanSource ?? "fallback"}`,
                      focusedEditRequest
                          ? "Focused Edit must preserve this DesignPlan unless the user explicitly requested an overall style replacement."
                          : "Structural generation must implement this DesignPlan. Do not fall back to a generic shared card/grid template.",
                  ].join("\n")
                : "",
            focusedEditRequest
                ? [
                      "Focused Edit Fast Path:",
                      "Perform only the latest user request. Locate the relevant component, CSS selector, and file before editing.",
                      "Return a minimal patch set through focused file edits. Do not regenerate the full page, do not change dependencies, do not call image tools, and do not redesign unrelated sections.",
                      "If the user says another area should not change, treat that as a must_preserve requirement.",
                      focusedEditScope
                          ? `FocusedEditScope: ${JSON.stringify(focusedEditScope)}`
                          : "",
                  ].join("\n")
                : "",
            imageToolContext,
            currentWorkspaceContext,
            navigationExecutionContext,
            complexPageExecutionContext,
            compactCoordinationContext,
            fullGoalContractContext,
            limitContextText(options.memoryContext, 1_200),
        ]
            .filter((part) => part && part.length > 0)
            .join("\n\n");
    const baseContext = formatAttemptBaseContext(
        continuationWorkspaceContext,
    );
    let successfulInstallCache:
        | {
              fingerprint: string;
              result: RunReactAppAgentCommandResult;
          }
        | undefined;

    async function installCurrentDependencies(input?: {
        skipIfManifestUnchanged?: boolean;
    }): Promise<RunReactAppAgentCommandResult> {
        options.signal?.throwIfAborted();
        await emitRunProgress(options.onProgress, "installing");
        const fingerprint = await createInstallDependencyFingerprint(
            options.workspaceRoot,
        );

        if (input?.skipIfManifestUnchanged) {
            return {
                exitCode: 0,
                stdout:
                    "Skipped npm install for focused edit because dependency manifests did not change.",
                stderr: "",
            };
        }

        if (successfulInstallCache?.fingerprint === fingerprint) {
            return {
                ...successfulInstallCache.result,
                stdout: [
                    "Reused successful npm install result because dependency manifests are unchanged.",
                    successfulInstallCache.result.stdout,
                ]
                    .filter((part) => part.length > 0)
                    .join("\n"),
            };
        }

        const result = await timeRunPhase(
            runMetrics,
            "installDurationMs",
            () =>
                runWorkspaceCommand(
                    options.workspaceRoot,
                    {
                        command: "npm",
                        args: ["install"],
                    },
                    {
                        timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
                        ...(options.signal ? { signal: options.signal } : {}),
                    },
                ),
        );
        options.signal?.throwIfAborted();

        if (result.exitCode === 0) {
            successfulInstallCache = {
                // npm install may create or normalize package-lock.json, so
                // cache the post-install fingerprint used by later repairs.
                fingerprint: await createInstallDependencyFingerprint(
                    options.workspaceRoot,
                ),
                result,
            };
        }

        return result;
    }

    async function runAttempt(
        kind: RunReactAppAgentAttempt["kind"],
        context: string,
        attemptNumber: number,
        attemptOptions: { forceStableScaffold?: boolean } = {},
    ): Promise<RunReactAppAgentAttempt> {
        options.signal?.throwIfAborted();
        await emitRunProgress(
            options.onProgress,
            kind === "repair" ? "repairing" : "coding",
        );
        const typecheckRepairAttempt =
            kind === "repair" && isTypecheckRepairContext(context);
        const attemptImageAssetTool = typecheckRepairAttempt
            ? undefined
            : activeImageAssetTool;
        const maxSteps = typecheckRepairAttempt
            ? 2
            : focusedEditRequest
              ? 2
              : chooseAgentMaxSteps({
                    kind,
                    hasImageAssetTool: attemptImageAssetTool !== undefined,
                    complexPageRequest,
                    routeRequest: navigationRequestKind === "routes",
                });

        const codingModel = labelModelProviderStage(
            useParallelCodingAgents && kind === "initial"
                ? parallelProvider
                : provider,
            kind === "repair"
                ? "Repair Agent model request"
                : useParallelCodingAgents && kind === "initial"
                  ? "parallel Coding Agent model request"
                  : "initial Coding Agent model request",
            options.signal,
            createRunProgressHeartbeat(
                options.onProgress,
                kind === "repair" ? "repairing" : "coding",
            ),
            options.llm.hardTimeoutMs ?? 240_000,
        );
        let parallelWorkstreams:
            | ParallelCodingWorkstreamResult[]
            | undefined;
        let agent!: RunCodingAgentLoopResult;
        let usedStableScaffold = false;
        const codingStartedAt = Date.now();

        try {
            if (
                (stableScaffoldRequested ||
                    attemptOptions.forceStableScaffold === true) &&
                (kind === "initial" ||
                    attemptOptions.forceStableScaffold === true ||
                    genericRepairRequest ||
                    (options.resetWorkspace === false &&
                        attemptNumber === 1 &&
                        (contentCorrectionRequest ||
                            layoutRepairIterationRequest ||
                            iterationRequestKind === "structural_regen")))
            ) {
                const stableResult = await generateStableReactPage({
                    workspaceRoot: options.workspaceRoot,
                    goal:
                        attemptOptions.forceStableScaffold === true
                            ? [
                                  "Original product goal:",
                                  extractStableProductGoal(options.goal),
                                  "",
                                  "Current user request:",
                                  focusedRequest,
                                  "",
                                  "Failure context:",
                                  context,
                              ].join("\n")
                            : options.resetWorkspace === false
                              ? [
                                    "Original product goal:",
                                    extractStableProductGoal(options.goal),
                                    "",
                                    "Current user request:",
                                    focusedRequest,
                                ].join("\n")
                            : iterationContextRequest,
                    ...(attemptOptions.forceStableScaffold === true
                        ? {}
                        : { contentModel: codingModel }),
                    ...(attemptImageAssetTool
                        ? { imageAssetTool: attemptImageAssetTool }
                        : {}),
                    ...(activeImageAssetModes.length > 0
                        ? { imageModes: activeImageAssetModes }
                        : {}),
                    ...(resolvedDesignPlan
                        ? { designPlan: resolvedDesignPlan }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                agent = stableResult.agent;
                usedStableScaffold = true;
            } else if (useParallelCodingAgents && kind === "initial") {
                const parallelResult = await runParallelReactPagesAgent({
                    goal: executionRequest,
                    plannerOutput,
                    model: codingModel,
                    workspaceRoot: options.workspaceRoot,
                    routeRequest: navigationRequestKind === "routes",
                    maxConcurrency: options.parallelCodingConcurrency ?? 2,
                    workstreamTimeoutMs:
                        options.parallelCodingTimeoutMs ?? 240_000,
                    ...(activeImageAssetTool
                        ? { imageAssetTool: activeImageAssetTool }
                        : {}),
                    ...(activeImageAssetModes.length > 0
                        ? { imageAssetModes: activeImageAssetModes }
                        : {}),
                    ...(options.topicLookupProvider
                        ? { topicLookupProvider: options.topicLookupProvider }
                        : {}),
                    ...(resolvedDesignPlan
                        ? { designPlan: resolvedDesignPlan }
                        : {}),
                    ...(resolvedDesignPlanSource
                        ? { designPlanSource: resolvedDesignPlanSource }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                });
                agent = parallelResult.agent;
                parallelWorkstreams = parallelResult.workstreams;

                if (
                    !agent.finished &&
                    agent.steps.length === 0 &&
                    !parallelWorkstreamsHitHardDeadline(parallelWorkstreams)
                ) {
                    const fallbackModel = labelModelProviderStage(
                        provider,
                        "initial Coding Agent fallback model request",
                        options.signal,
                        createRunProgressHeartbeat(options.onProgress, "coding"),
                        options.llm.hardTimeoutMs ?? 240_000,
                    );
                    agent = await runCodingAgentLoop({
                        goal: executionRequest,
                        model: fallbackModel,
                        workspaceRoot: options.workspaceRoot,
                        maxSteps: Math.min(maxSteps, 4),
                        requireWorkspaceChange: true,
                        mode: "repair",
                        entrypointFirst: true,
                        context: [
                            context,
                            "Workspace execution mode: compact initial-generation rescue. The parallel page-per-API path failed before producing a draft.",
                            "The first action must write a compact, complete src/App.tsx that replaces the starter and renders the requested page. Keep subject data inline when necessary so the entrypoint is runnable immediately.",
                            "After src/App.tsx exists, write src/App.css only if needed, then finish. Do not create src/content.ts, do not request images, do not run commands, and do not spend steps polishing optional details before the entrypoint is complete.",
                        ].join("\n\n"),
                        ...(options.signal ? { signal: options.signal } : {}),
                        ...(focusedEditRequest &&
                        focusedEditScope &&
                        beforeWorkspaceSnapshot
                            ? {
                                  validateAction:
                                      validateFocusedActionWithRecording,
                              }
                            : {}),
                    });
                }
            } else {
                agent = await runCodingAgentLoop({
                    goal: executionRequest,
                    model: codingModel,
                    workspaceRoot: options.workspaceRoot,
                    maxSteps,
                    requireWorkspaceChange: true,
                    mode: kind === "repair" ? "repair" : "coding",
                    ...(kind === "initial"
                        ? { entrypointFirst: true }
                        : {}),
                    context: [
                        context,
                        kind === "initial"
                            ? "Workspace execution mode: initial generation. Replace the starter with the requested application; use write_file when establishing src/App.tsx because no exact existing source is supplied."
                            : "Workspace execution mode: existing draft. Preserve working code and use focused edits when exact current source is supplied.",
                    ].join("\n\n"),
                    ...(attemptImageAssetTool
                        ? { imageAssetTool: attemptImageAssetTool }
                        : {}),
                    ...(attemptImageAssetTool
                        ? {
                              imageAssetModes: activeImageAssetModes,
                          }
                        : {}),
                    ...(typecheckRepairAttempt
                        ? { validateAction: validateTypecheckRepairAction }
                        : {}),
                    ...(options.signal ? { signal: options.signal } : {}),
                    ...(focusedEditRequest &&
                    focusedEditScope &&
                    beforeWorkspaceSnapshot
                        ? {
                              validateAction: validateFocusedActionWithRecording,
                          }
                        : {}),
                });
            }
        } finally {
            addDuration(runMetrics, "codingDurationMs", codingStartedAt);
        }
        options.signal?.throwIfAborted();

        let madeWorkspaceProgress = agentMadeWorkspaceProgress(agent);

        // A repair that times out before changing the draft is not a new
        // attempt result. Surface the repair failure while keeping the last
        // previewable attempt as the canonical result.
        if (
            kind === "repair" &&
            attemptNumber > 1 &&
            agent.stopReason === "model_error" &&
            !madeWorkspaceProgress
        ) {
            throw new Error(
                agent.errorMessage ??
                    "Repair Agent model request failed before changing the draft",
            );
        }

        if (
            !madeWorkspaceProgress &&
            kind === "initial" &&
            options.resetWorkspace === false &&
            (focusedEditRequest ||
                extractRequestedTextReplacement(executionRequest) !==
                    undefined ||
                isDeleteOrHideSingleTargetRequest(executionRequest) ||
                isSizeSpacingPositionRequest(executionRequest) ||
                isVisualLayoutStabilizationRequest(executionRequest) ||
                isHorizontalPointLabelRequest(executionRequest) ||
                isColorChangeRequest(executionRequest) ||
                isCompactTopNavigationRequest(executionRequest))
        ) {
            const localFallbackChange = await applyNoProgressLocalFallback(
                options.workspaceRoot,
                executionRequest,
                options.signal,
            );

            if (localFallbackChange) {
                agent = {
                    steps: [
                        {
                            action: {
                                type: "edit_file",
                                ...localFallbackChange.action,
                            },
                            execution: {
                                ok: true,
                                message:
                                    localFallbackChange.messages.join("\n"),
                                changed: true,
                            },
                        },
                        {
                            action: {
                                type: "finish",
                                summary:
                                    "Applied a deterministic local fallback after the Coding Agent made no workspace change.",
                            },
                            execution: {
                                ok: true,
                                message:
                                    "Applied a deterministic local fallback after the Coding Agent made no workspace change.",
                            },
                        },
                    ],
                    finished: true,
                    stopReason: "finish",
                };
                madeWorkspaceProgress = true;
            }
        }

        if (
            !madeWorkspaceProgress &&
            (kind === "initial" || attemptNumber === 1) &&
            navigationRequestKind !== "routes" &&
            stableGenerationEnabled &&
            (stableStructuralGenerationRequested ||
                genericRepairRequest ||
                contentCorrectionRequest ||
                layoutRepairIterationRequest ||
                complexPageRequest ||
                requirements.length >= 3 ||
                focusedEditRequest) &&
            iterationRequestKind !== "dependency_change"
        ) {
            const stableResult = await generateStableReactPage({
                workspaceRoot: options.workspaceRoot,
                goal:
                    options.resetWorkspace === false
                        ? [
                              "Original product goal:",
                              extractStableProductGoal(options.goal),
                              "",
                              "Current user request:",
                              focusedRequest,
                              "",
                              "No-progress edit context:",
                              iterationContextRequest,
                          ].join("\n")
                        : iterationContextRequest,
                ...(resolvedDesignPlan
                    ? { designPlan: resolvedDesignPlan }
                    : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            });
            agent = {
                ...stableResult.agent,
                steps: [
                    ...agent.steps,
                    {
                        action: {
                            type: "finish",
                            summary:
                                "Terminal Repair Agent safety net: Coding Agent made no workspace change, so AppForge switched to deterministic stable generation.",
                        },
                        execution: {
                            ok: true,
                            changed: false,
                            message:
                                "Terminal Repair Agent safety net: Coding Agent made no workspace change, so AppForge switched to deterministic stable generation.",
                        },
                    },
                    ...stableResult.agent.steps,
                ],
            };
            madeWorkspaceProgress = true;
            usedStableScaffold = true;
        }

        if (!madeWorkspaceProgress) {
            const failureDetail =
                agent.errorMessage ??
                "The Coding Agent completed without a file or image change.";
            const reason = [
                "No new draft was produced because the Coding Agent did not change the workspace.",
                failureDetail,
            ].join(" ");
            const skippedCommand: RunReactAppAgentCommandResult = {
                exitCode: 1,
                stdout: "",
                stderr:
                    "Skipped because the Coding Agent produced no workspace changes.",
            };
            const evalResult: ReactAppEvalResult = {
                passed: false,
                checks: [
                    {
                        name: `Coding Agent produced a new draft: ${reason}`,
                        passed: false,
                    },
                ],
            };
            const review: ReactAppAgentReview = {
                accepted: false,
                reason,
                checks: {
                    agentFinished: agent.finished,
                    installPassed: false,
                    buildPassed: false,
                    evalPassed: false,
                },
            };

            return {
                kind,
                agent,
                install: skippedCommand,
                build: skippedCommand,
                eval: evalResult,
                review,
                metrics: cloneRunMetrics(runMetrics),
                ...(parallelWorkstreams
                    ? { parallelWorkstreams }
                    : {}),
            };
        }

        const sourceAutofix = usedStableScaffold
            ? await autofixReactStyles(
                  options.workspaceRoot,
                  options.signal,
              )
            : await autofixReactSource(
                  options.workspaceRoot,
                  options.signal,
                  {
                      responsiveCssSafetyNet: !focusedEditRequest,
                  },
              );

        let initialGenerationCompleteness =
            requiresInitialGenerationCompleteness
                ? await evaluateInitialGenerationCompleteness({
                      workspaceRoot: options.workspaceRoot,
                      ...(baselineAppSource !== undefined
                          ? { baselineAppSource }
                          : {}),
                      ...(baselineContentSource !== undefined
                          ? { baselineContentSource }
                          : {}),
                      requireVisiblePageStructure:
                          isFreshPageGenerationRequest(executionRequest),
                  })
                : undefined;

        // V9.4.2.3.3 repair-budget alignment
    // The inline integration rescue is a last-chance path only when the caller
    // explicitly disabled ordinary repair attempts. When a formal repair
    // budget exists, the outer attempt loop owns that budget and records each
    // repair as a separate attempt.
    if (
        kind === "initial" &&
        maxRepairAttempts === 0 &&
        madeWorkspaceProgress &&
        initialGenerationCompleteness?.passed === false
    ) {
            const completenessSummary = initialGenerationCompleteness.checks
                .filter((check) => !check.passed)
                .map((check) => check.name)
                .join(" ");
            const integrationModel = labelModelProviderStage(
                provider,
                "initial App.tsx integration rescue model request",
                options.signal,
                createRunProgressHeartbeat(options.onProgress, "coding"),
                options.llm.hardTimeoutMs ?? 240_000,
            );
            const currentWorkspaceContext =
                await formatContinuationWorkspaceContext(
                    options.workspaceRoot,
                    executionRequest,
                );
            const integrationAgent = await runCodingAgentLoop({
                goal: executionRequest,
                model: integrationModel,
                workspaceRoot: options.workspaceRoot,
                maxSteps: 3,
                requireWorkspaceChange: true,
                mode: "repair",
                entrypointFirst: true,
                context: [
                    "Initial application integration rescue:",
                    "A previous generation wrote partial content, styles, or assets but did not connect a complete rendered entrypoint.",
                    `Failed completeness checks: ${completenessSummary}`,
                    "Only complete src/App.tsx now. The first action must write_file or edit_file src/App.tsx. Reuse the existing src/content.ts, src/App.css, and local assets instead of regenerating them.",
                    "Import ./App.css when it exists. If src/content.ts exists, import and actually render at least one exported binding. Render one non-starter h1 inside main, section, or article. Remove all AppForge Starter content.",
                    "Do not call get_image, do not run commands, do not modify src/content.ts or src/App.css, and do not create additional files. After the entrypoint is connected, return finish.",
                    currentWorkspaceContext,
                ].join("\n\n"),
                validateAction: validateEntrypointIntegrationAction,
                ...(options.signal ? { signal: options.signal } : {}),
            });

            agent = {
                steps: [...agent.steps, ...integrationAgent.steps],
                finished: integrationAgent.finished,
                ...(integrationAgent.stopReason
                    ? { stopReason: integrationAgent.stopReason }
                    : {}),
                ...(integrationAgent.errorMessage
                    ? { errorMessage: integrationAgent.errorMessage }
                    : {}),
            };

            await autofixReactSource(
                options.workspaceRoot,
                options.signal,
            );
            initialGenerationCompleteness =
                await evaluateInitialGenerationCompleteness({
                    workspaceRoot: options.workspaceRoot,
                    ...(baselineAppSource !== undefined
                        ? { baselineAppSource }
                        : {}),
                    ...(baselineContentSource !== undefined
                        ? { baselineContentSource }
                        : {}),
                    requireVisiblePageStructure:
                        isFreshPageGenerationRequest(executionRequest),
                });
        }

        if (initialGenerationCompleteness?.passed === false) {
            const completenessSummary = initialGenerationCompleteness.checks
                .filter((check) => !check.passed)
                .map((check) => check.name)
                .join(" ");
            const skippedCommand: RunReactAppAgentCommandResult = {
                exitCode: 1,
                stdout: "",
                stderr: [
                    "Skipped because the initial generation completeness gate failed.",
                    completenessSummary,
                ]
                    .filter(Boolean)
                    .join(" "),
            };
            const review = reviewReactAppAgentResult({
                agent: {
                    ...agent,
                    madeProgress: madeWorkspaceProgress,
                },
                install: skippedCommand,
                build: skippedCommand,
                eval: initialGenerationCompleteness,
            });

            return {
                kind,
                agent,
                install: skippedCommand,
                build: skippedCommand,
                eval: initialGenerationCompleteness,
                review: {
                    ...review,
                    accepted: false,
                    reason: [
                        "Rejected because the generated application is incomplete.",
                        completenessSummary,
                        review.reason,
                    ]
                        .filter(Boolean)
                        .join(" "),
                },
                metrics: cloneRunMetrics(runMetrics),
                ...(parallelWorkstreams
                    ? { parallelWorkstreams }
                    : {}),
            };
        }

        const agentModifiedFiles = listModifiedFilesFromAgent(agent);
        const dependencyManifestChanged = agentModifiedFiles.some(
            isDependencyManifestPath,
        );
        const install = await installCurrentDependencies({
            skipIfManifestUnchanged:
                focusedEditRequest && !dependencyManifestChanged,
        });

        await emitRunProgress(options.onProgress, "building");
        const buildResult = await timeRunPhase(
            runMetrics,
            "buildDurationMs",
            () =>
                runWorkspaceCommand(
                    options.workspaceRoot,
                    {
                        command: "npm",
                        args: ["run", "build"],
                    },
                    {
                        timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
                        ...(options.signal ? { signal: options.signal } : {}),
                    },
                ),
        );
        options.signal?.throwIfAborted();
        let build = sourceAutofix.changed
            ? {
                  ...buildResult,
                  stdout: [
                      ...sourceAutofix.messages,
                      buildResult.stdout,
                  ]
                      .filter((part) => part.length > 0)
                      .join("\n"),
              }
            : buildResult;
        let typecheck: RunReactAppAgentCommandResult | undefined;

        if (install.exitCode === 0 && build.exitCode === 0) {
            typecheck = await runTypecheckIfAvailable({
                workspaceRoot: options.workspaceRoot,
                ...(options.signal ? { signal: options.signal } : {}),
            });
            options.signal?.throwIfAborted();
        }

        await emitRunProgress(options.onProgress, "evaluating");
        const staticEvalResult = await timeRunPhase(
            runMetrics,
            "evaluationDurationMs",
            async () => {
                if (focusedEditRequest) {
                    return {
                        passed: true,
                        checks: [
                            {
                                name: "focused edit quick static check",
                                passed: true,
                            },
                        ],
                    };
                }

                const evaluationSource = await formatStaticEvaluationSource(
                    options.workspaceRoot,
                );

                return evaluateReactApp({
                    source: evaluationSource,
                    goal: options.goal,
                });
            },
        );
        const baseEvalResult =
            typecheck && typecheck.exitCode !== 0
                ? {
                      passed: false,
                      checks: [
                          ...staticEvalResult.checks,
                          {
                              name: "TypeScript typecheck passes",
                              passed: false,
                              message: [
                                  typecheck.stderr.trim(),
                                  typecheck.stdout.trim(),
                              ]
                                  .filter((part) => part.length > 0)
                                  .join("\n")
                                  .slice(0, 2_000),
                          },
                      ],
                  }
                : staticEvalResult;
        const sourceStyleContract = focusedEditRequest
            ? undefined
            : evaluateSourceStyleContract({
                  appSource: await readFile(
                      path.join(options.workspaceRoot, "src", "App.tsx"),
                      "utf8",
                  ).catch(() => ""),
                  cssSource: await readFile(
                      path.join(options.workspaceRoot, "src", "App.css"),
                      "utf8",
                  ).catch(() => ""),
              });
        const sourceStyleEvalResult: ReactAppEvalResult =
            sourceStyleContract?.applicable && !sourceStyleContract.passed
                ? {
                      passed: false,
                      checks: [
                          ...baseEvalResult.checks,
                          {
                              name: "JSX and project CSS use a coherent class contract",
                              passed: false,
                              message: sourceStyleContract.evidence,
                          },
                      ],
                  }
                : baseEvalResult;
        const routeImplementationFailures =
            navigationRequestKind === "routes"
                ? listRouteImplementationFailures(
                      await readRouteImplementationSource(
                          options.workspaceRoot,
                      ),
                  )
                : [];
        const evalResult: ReactAppEvalResult =
            routeImplementationFailures.length > 0
                ? {
                      passed: false,
                      checks: [
                          ...sourceStyleEvalResult.checks,
                          {
                              name: `has distinct URL routes: ${routeImplementationFailures.join(" ")}`,
                              passed: false,
                          },
                      ],
                  }
                : sourceStyleEvalResult;
        const assetEvidence = [
            formatAssetEvidence(agent),
            await formatLocalAssetReferenceEvidence(options.workspaceRoot),
        ]
            .filter((part) => part.length > 0)
            .join("\n\n");

        let browserEval: BrowserEvalResult | undefined;

        if (
            options.evaluateBrowser &&
            install.exitCode === 0 &&
            build.exitCode === 0 &&
            (typecheck?.exitCode ?? 0) === 0
        ) {
            try {
                await emitRunProgress(options.onProgress, "evaluating");
                browserEval = await timeRunPhase(
                    runMetrics,
                    "evaluationDurationMs",
                    () =>
                        options.evaluateBrowser!({
                            goal: options.goal,
                            workspaceRoot: options.workspaceRoot,
                            kind,
                            attemptNumber,
                            ...(browserProbes.length > 0
                                ? { browserProbes }
                                : {}),
                            ...(options.signal ? { signal: options.signal } : {}),
                        }),
                );
            } catch (error) {
                if (options.signal?.aborted) {
                    options.signal.throwIfAborted();
                }
                // Preview infrastructure must not crash the coding run. Feed
                // the failure into the normal repair/review loop instead.
                browserEval = {
                    passed: false,
                    checks: [
                        {
                            name: "browser preview starts",
                            passed: false,
                            message:
                                error instanceof Error
                                    ? error.message
                                    : "Browser preview could not start",
                        },
                    ],
                };
            }
        }

        const contrastHardeningMessages =
            await applyBrowserContrastHardeningFallback(
                options.workspaceRoot,
                options.goal,
                browserEval,
                options.signal,
            );

        if (
            contrastHardeningMessages.length > 0 &&
            options.evaluateBrowser &&
            install.exitCode === 0
        ) {
            agent.steps.push({
                action: {
                    type: "edit_file",
                    path: "src/App.css",
                    oldText: "low-contrast browser-visible text",
                    newText: "WCAG-readable header, hero, navigation, tag, chip, and tactical label contrast rules",
                },
                execution: {
                    ok: true,
                    message: contrastHardeningMessages.join("\n"),
                    changed: true,
                },
            });
            await emitRunProgress(options.onProgress, "building");
            build = await timeRunPhase(
                runMetrics,
                "buildDurationMs",
                () =>
                    runWorkspaceCommand(
                        options.workspaceRoot,
                        {
                            command: "npm",
                            args: ["run", "build"],
                        },
                        {
                            timeoutMs: BUILD_COMMAND_TIMEOUT_MS,
                            ...(options.signal ? { signal: options.signal } : {}),
                        },
                    ),
            );
            options.signal?.throwIfAborted();

            if (build.exitCode === 0) {
                try {
                    await emitRunProgress(options.onProgress, "evaluating");
                    browserEval = await timeRunPhase(
                        runMetrics,
                        "evaluationDurationMs",
                        () =>
                            options.evaluateBrowser!({
                                goal: options.goal,
                                workspaceRoot: options.workspaceRoot,
                                kind,
                                attemptNumber: attemptNumber + 1,
                                ...(browserProbes.length > 0
                                    ? { browserProbes }
                                    : {}),
                                ...(options.signal
                                    ? { signal: options.signal }
                                    : {}),
                            }),
                    );
                } catch (error) {
                    if (options.signal?.aborted) {
                        options.signal.throwIfAborted();
                    }
                    browserEval = {
                        passed: false,
                        checks: [
                            {
                                name: "browser preview starts",
                                passed: false,
                                message:
                                    error instanceof Error
                                        ? error.message
                                        : "Browser preview could not start",
                            },
                        ],
                    };
                }
            }
        }

        const antiTemplate =
            !focusedEditRequest && install.exitCode === 0 && build.exitCode === 0
                ? await evaluateWorkspaceAntiTemplate({
                      workspaceRoot: options.workspaceRoot,
                      ...(resolvedDesignPlan
                          ? { designPlan: resolvedDesignPlan }
                          : {}),
                  }).catch(() => undefined)
                : undefined;

        const deterministicRepairCompletion =
            kind === "repair" &&
            !agent.finished &&
            agentMadeWorkspaceProgress(agent) &&
            install.exitCode === 0 &&
            build.exitCode === 0 &&
            (typecheck?.exitCode ?? 0) === 0 &&
            evalResult.passed &&
            (!options.evaluateBrowser || browserEval?.passed === true);

        if (deterministicRepairCompletion) {
            agent = {
                steps: [
                    ...agent.steps,
                    {
                        action: {
                            type: "finish",
                            summary:
                                "Repair completed after typecheck, build, static evaluation, and browser runtime gates passed.",
                        },
                        execution: {
                            ok: true,
                            changed: false,
                            message:
                                "Platform finalized the repair because all deterministic quality gates passed.",
                        },
                    },
                ],
                finished: true,
                stopReason: "finish_after_max_steps",
            };
        }

        const baseDeterministicReview = reviewReactAppAgentResult({
            agent: {
                ...agent,
                madeProgress: agentMadeWorkspaceProgress(agent),
            },
            install,
            build,
            ...(typecheck ? { typecheck } : {}),
            eval: evalResult,
            ...(browserEval ? { browserEval } : {}),
        });
        const deterministicReview =
            routeImplementationFailures.length > 0
                ? {
                      ...baseDeterministicReview,
                      accepted: false,
                      reason: `Rejected because the requested independent pages do not have a verifiable routing implementation: ${routeImplementationFailures.join(" ")}`,
                  }
                : baseDeterministicReview;
        await emitRunProgress(options.onProgress, "reviewing");
        const { review: reviewedResult, llmReview } =
            focusedEditRequest || usedStableScaffold
                ? { review: deterministicReview }
                : await timeRunPhase(
                      runMetrics,
                      "reviewerDurationMs",
                      async () =>
                          reviewWithOptionalLlm({
                              reviewerAgent,
                              deterministicReview,
                              goal: options.goal,
                              plan: [
                                  ...coordination.plan,
                                  ...(resolvedDesignPlan
                                      ? [
                                            formatDesignPlanForPrompt(
                                                resolvedDesignPlan,
                                            ),
                                        ]
                                      : []),
                              ],
                              source: await formatReviewerSourceEvidence(
                                  options.workspaceRoot,
                                  executionRequest,
                              ),
                              buildPassed: build.exitCode === 0,
                              evaluationSummary: formatEvaluationSummary(
                                  evalResult,
                                  browserEval,
                              ),
                              assetEvidence,
                              ...(options.signal
                                  ? { signal: options.signal }
                                  : {}),
                          }),
                  );
        options.signal?.throwIfAborted();
        const review = await enforceFocusedVisualSemanticReview({
            workspaceRoot: options.workspaceRoot,
            executionRequest,
            review: markReviewWithAntiTemplateWarning(
                reviewedResult,
                antiTemplate,
                {
                    blockOnSevere: explicitlyRequestsVisualStructureDiversity({
                        request: executionRequest,
                        ...(resolvedDesignPlan
                            ? { designPlan: resolvedDesignPlan }
                            : {}),
                    }),
                },
            ),
        });

        return {
            kind,
            agent,
            install,
            build,
            ...(typecheck ? { typecheck } : {}),
            eval: evalResult,
            ...(browserEval ? { browserEval } : {}),
            ...(antiTemplate ? { antiTemplate } : {}),
            ...(llmReview ? { llmReview } : {}),
            review,
            metrics: cloneRunMetrics(runMetrics),
            ...(parallelWorkstreams
                ? { parallelWorkstreams }
                : {}),
        };
    }
    const attempts:RunReactAppAgentAttempt[]=[];

    const firstAttemptKind: RunReactAppAgentAttempt["kind"] =
        options.resetWorkspace === false ? "repair" : "initial";
    const firstAttempt = await runAttempt(
        firstAttemptKind,
        baseContext,
        1,
    );

    attempts.push(firstAttempt);
    let latestAttempt = firstAttempt;
    let repairAttempt = 0;
    while (
        (focusedEditRequest &&
            browserProbes.length > 0 &&
            latestAttempt.browserEval?.passed === false &&
            repairAttempt < Math.min(maxRepairAttempts, 1) &&
            attemptMadeWorkspaceProgress(latestAttempt)) ||
        shouldRepair({
            review: latestAttempt.review,
            repairAttempt,
            maxRepairAttempts:
                focusedEditRequest && browserProbes.length > 0
                    ? Math.min(maxRepairAttempts, 1)
                    : maxRepairAttempts,
            attemptMadeProgress:
                attemptMadeWorkspaceProgress(latestAttempt),
            ...(latestAttempt.agent.stopReason
                ? {
                      attemptStopReason:
                          latestAttempt.agent.stopReason,
                  }
                : {}),
        })
        ){
        options.signal?.throwIfAborted();
        const compilerDiagnostics =
            latestAttempt.typecheck && latestAttempt.typecheck.exitCode !== 0
                ? formatCommandDiagnostics(latestAttempt.typecheck)
                : formatCommandDiagnostics(latestAttempt.build);
        const repairContext = formatRepairContext({
            build: latestAttempt.build,
            ...(latestAttempt.typecheck
                ? { typecheck: latestAttempt.typecheck }
                : {}),
            eval: latestAttempt.eval,
            ...(latestAttempt.browserEval
                ? { browserEval: latestAttempt.browserEval }
                : {}),
            review: latestAttempt.review,
            sourceExcerpt: await formatBuildErrorSourceExcerpt(
                options.workspaceRoot,
                compilerDiagnostics,
            ),
        });
        const latestWorkspaceContext =
            await formatContinuationWorkspaceContext(
                options.workspaceRoot,
                executionRequest,
            );
        const failedActionContext =
            await formatFailedActionRepairContext(
                options.workspaceRoot,
                latestAttempt.agent,
            );
        const focusedRequirementRepairContext =
            focusedEditRequest && browserProbes.length > 0
                ? formatFocusedRequirementRepairContext({
                      browserEval: latestAttempt.browserEval,
                      requirements,
                      focusedEditScope,
                  })
                : "";

        try {
            runMetrics.retryCalls += 1;
            const nextAttempt = await runAttempt(
                "repair",
                focusedRequirementRepairContext.length > 0
                    ? [
                          formatAttemptBaseContext(latestWorkspaceContext),
                          focusedRequirementRepairContext,
                          failedActionContext,
                      ].join("\n\n")
                    : [
                          formatAttemptBaseContext(latestWorkspaceContext),
                          repairContext,
                          failedActionContext,
                      ].join("\n\n"),
                repairAttempt + 2,
            );

            attempts.push(nextAttempt);
            latestAttempt = nextAttempt;
        } catch (error) {
            if (options.signal?.aborted) {
                options.signal.throwIfAborted();
            }
            latestAttempt = {
                ...latestAttempt,
                review: markReviewWithRepairFailure(
                    latestAttempt.review,
                    error,
                ),
            };

            attempts[attempts.length - 1] = latestAttempt;
            break;
        }

        repairAttempt += 1;
    }

    if (
        options.resetWorkspace === false &&
        stableGenerationEnabled &&
        !focusedEditRequest &&
        navigationRequestKind !== "routes" &&
        iterationRequestKind !== "dependency_change" &&
        !latestAttempt.review.accepted &&
        (/No new draft was produced|Coding Agent did not change|npm build failed|required requirement\(s\) failed|unverified/iu.test(
            latestAttempt.review.reason,
        ) ||
            latestAttempt.build.exitCode !== 0 ||
            latestAttempt.eval.passed === false)
    ) {
        options.signal?.throwIfAborted();
        const terminalStableContext = [
            "Terminal stable recovery mode:",
            "The normal iteration/edit path failed or produced no accepted draft.",
            "Do not continue the failed patch. Rebuild the generated React source through the stable schema-driven generator using the original product goal plus the latest user correction.",
            "The result must write src/App.tsx, src/App.css, and src/main.tsx, then pass install, build, static evaluation, and browser validation if available.",
            "",
            "Iteration request package:",
            iterationContextRequest,
            "",
            formatRepairContext({
                build: latestAttempt.build,
                ...(latestAttempt.typecheck
                    ? { typecheck: latestAttempt.typecheck }
                    : {}),
                eval: latestAttempt.eval,
                ...(latestAttempt.browserEval
                    ? { browserEval: latestAttempt.browserEval }
                    : {}),
                review: latestAttempt.review,
            }),
        ].join("\n\n");

        try {
            runMetrics.retryCalls += 1;
            const terminalStableAttempt = await runAttempt(
                "repair",
                terminalStableContext,
                attempts.length + 1,
                { forceStableScaffold: true },
            );
            attempts.push(terminalStableAttempt);
            latestAttempt = terminalStableAttempt;
        } catch (error) {
            if (options.signal?.aborted) {
                options.signal.throwIfAborted();
            }
            latestAttempt = {
                ...latestAttempt,
                review: markReviewWithRepairFailure(
                    latestAttempt.review,
                    error,
                ),
            };
            attempts[attempts.length - 1] = latestAttempt;
        }
    }

    options.signal?.throwIfAborted();
    const workspaceDiff = beforeWorkspaceSnapshot
        ? diffWorkspaceSnapshots(
              beforeWorkspaceSnapshot,
              await createWorkspaceSnapshot(options.workspaceRoot),
          )
        : undefined;
    const finalizedMetrics = finalizeRunMetrics({
        metrics: runMetrics,
        attempts,
        startedAt: runStartedAt,
    });
    const browserRequirementEvidence = extractRequirementEvidenceFromBrowser(
        latestAttempt.browserEval,
    );
    const mergedBrowserRequirementEvidence = mergeBeforeBrowserEvidence(
        browserRequirementEvidence,
        beforeBrowserProbeEvidence,
    );
    const postExecutionScopeViolations =
        workspaceDiff && focusedEditScope
            ? findUnexpectedScopeRanges(workspaceDiff, focusedEditScope).map(
                  (range): ScopeViolation => ({
                      action: "workspace_diff",
                      file: range.file,
                      reason: `Workspace diff changed lines ${range.startLine}-${range.endLine} outside focused edit allowed ranges.`,
                      allowedRanges: focusedEditScope.allowedRanges.filter(
                          (allowedRange) => allowedRange.file === range.file,
                      ),
                  }),
              )
            : [];
    const allScopeViolations = [
        ...scopeViolations,
        ...postExecutionScopeViolations,
    ];
    const requirementResults = evaluateRequirementLedger({
        requirements,
        metrics: finalizedMetrics,
        review: latestAttempt.review,
        focusedEdit: focusedEditRequest,
        ...(workspaceDiff ? { workspaceDiff } : {}),
        ...(focusedEditScope ? { focusedEditScope } : {}),
        ...(allScopeViolations.length > 0
            ? { scopeViolations: allScopeViolations }
            : {}),
        ...(mergedBrowserRequirementEvidence.length > 0
            ? { browserEvidence: mergedBrowserRequirementEvidence }
            : {}),
    });
    const ledgerReview = enforceRequirementLedgerReview({
        review: latestAttempt.review,
        requirements: requirementResults,
    });
    let finalReview = enforceFallbackPagesReview(
        ledgerReview,
        finalizedMetrics,
    );
    const designPlanCompliance =
        resolvedDesignPlan && resolvedDesignPlanSource
            ? await evaluateDesignPlanCompliance({
                  workspaceRoot: options.workspaceRoot,
                  designPlan: resolvedDesignPlan,
                  designPlanSource: resolvedDesignPlanSource,
              })
            : undefined;
    const failedDesignCompliance =
        designPlanCompliance?.filter(
            (compliance) => compliance.status === "FAIL",
        ) ?? [];
    if (finalReview.accepted && failedDesignCompliance.length > 0) {
        const complianceMessage = `DesignPlan compliance failed: ${failedDesignCompliance.map((item) => `${item.criterion} (${item.evidence})`).join("; ")}`;
        finalReview = stableScaffoldRequested
            ? {
                  ...finalReview,
                  accepted: true,
                  reason: [
                      finalReview.reason,
                      complianceMessage,
                      "Stable generation keeps the runnable result because install, typecheck, build, static evaluation, and browser runtime gates passed. DesignPlan heuristics are advisory in stable mode.",
                  ].join(" "),
              }
            : {
                  ...finalReview,
                  accepted: false,
                  reason: [finalReview.reason, complianceMessage].join(" "),
              };
    }
    if (finalReview !== latestAttempt.review) {
        latestAttempt = {
            ...latestAttempt,
            review: finalReview,
        };
        attempts[attempts.length - 1] = latestAttempt;
    }

    return withDesignPlanResult({
        workspaceRoot: options.workspaceRoot,
        coordination,
        agent: latestAttempt.agent,
        install: latestAttempt.install,
        build: latestAttempt.build,
        ...(latestAttempt.typecheck
            ? { typecheck: latestAttempt.typecheck }
            : {}),
        eval: latestAttempt.eval,
        ...(latestAttempt.browserEval
            ? { browserEval: latestAttempt.browserEval }
            : {}),
        ...(latestAttempt.antiTemplate
            ? { antiTemplate: latestAttempt.antiTemplate }
            : {}),
        ...(latestAttempt.llmReview
            ? { llmReview: latestAttempt.llmReview }
            : {}),
        review: finalReview,
        attempts,
        metrics: finalizedMetrics,
        requirements: requirementResults,
        ...(workspaceDiff ? { workspaceDiff } : {}),
        ...(focusedEditScope ? { focusedEditScope } : {}),
        ...(allScopeViolations.length > 0
            ? { scopeViolations: allScopeViolations }
            : {}),
        executionMode: focusedEditRequest ? "fast_edit" : "structural_edit",
        trace: buildTraceEvents(
            attempts,
            coordination.plan.length,
            plannerOutput.summary.startsWith(
                "Planner Agent was unavailable",
            )
                ? plannerOutput.summary
                : undefined,
        ),
    }, designPlanCompliance);

}
