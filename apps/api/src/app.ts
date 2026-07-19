import path from "node:path";
import {
    access,
    readdir,
    readFile,
    rm,
    stat,
} from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { RunRepository, type RunRepositoryLike } from "./run-repository.js";
import {
    CreateRunInputSchema,
    RunReportSchema,
    type DesignPlan,
    type Run,
    type RunOperationStage,
    type RunReport,
    type RunVersion,
} from "@appforge/protocol";
import {
    listWorkspaceFiles,
    readWorkspaceFile,
    WorkspaceManager,
} from "@appforge/workspace";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";
import { PreviewManager } from "./preview-manager.js";
import { coordinateAgents } from "@appforge/agent-core";
import { containsLikelyMojibake } from "@appforge/harness";
import {
    PlaywrightBrowserEvaluator,
    type BrowserEvaluator,
} from "@appforge/harness";
import {
    formatAgentMemoryContext,
    MemoryRepository,
    type MemoryEntry,
    type MemoryRepositoryLike,
} from "./memory-repository.js";
import {
    deleteRunVersionSnapshot,
    getRunVersionSnapshotDirectoryName,
    restoreRunVersionSnapshot,
    saveRunVersionSnapshot,
} from "./run-version-snapshot.js";
import {
    compactMemoryEntries,
    shouldCompactMemory,
} from "./memory-compactor.js";
import { retrieveRelevantMemory } from "./memory-retrieval.js";
import {
    isRunExecutionAbortError,
    RunExecutionCancelledError,
    RunExecutionManager,
    type RunExecutionLease,
    type RunExecutionManagerOptions,
} from "./run-execution-manager.js";
import { normalizeStepLimitOnlyReview } from "./review-react-app-agent.js";
import { executeWithWorkspaceRollback } from "./workspace-execution-transaction.js";

const RepairRequestSchema = z.object({
    feedback: z.string().trim().min(1).max(2000),
    background: z.boolean().optional().default(false),
});
const IterateRunInputSchema = z.object({
    prompt: z.string().trim().min(1).max(2000),
    background: z.boolean().optional().default(false),
});
export type ExecuteRun = (input:{
    goal:string;
    currentRequest?: string | undefined;
    workspaceRoot:string;
    maxRepairAttempts?:number;
    memoryContext?: string;
    designPlan?: DesignPlan;
    resetWorkspace?: boolean;
    signal?: AbortSignal;
    onProgress?: (
        stage: RunOperationStage,
    ) => void | Promise<void>;
})=>Promise<RunReactAppAgentResult>;

const MAX_EXECUTION_CONTRACT_CHARACTERS = 12_000;
const MAX_REQUIREMENT_CHARACTERS = 3_500;

type ExecutionContractEntry = {
    key: string;
    label: string;
    value: string;
    order: number;
    initial: boolean;
};

function normalizeRequirementText(value: string | undefined): string | undefined {
    const normalized = value?.trim().replace(/\r\n?/gu, "\n");

    return normalized && normalized.length > 0 ? normalized : undefined;
}

function truncateRequirement(value: string, maxCharacters: number): string {
    if (value.length <= maxCharacters) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxCharacters - 28)).trimEnd()}\n[older details truncated]`;
}

function isAcceptedContractVersion(version: RunVersion): boolean {
    if (version.summary.startsWith("Human-approved version")) {
        return true;
    }

    if (version.review) {
        return version.review.accepted;
    }

    // Legacy snapshots did not always persist structured review evidence.
    // Keep ordinary historical versions, but never promote an explicitly
    // failed or still-pending attempt into the cumulative requirement contract.
    return !/\b(?:needs? review|failed|rejected|did not finish|unfinished)\b|待审核|待审|失败|拒绝|未完成/iu.test(
        version.summary,
    );
}

/**
 * Builds the bounded requirement contract used by every continuation path.
 * Entries are ordered oldest to newest; a newer explicit request wins only
 * when it conflicts with an older requirement, while non-conflicting details
 * remain part of the contract.
 */
export function resolveExecutionContract(input: {
    initialGoal: string;
    versions?: RunVersion[];
    pendingRequest?: string | undefined;
    currentRequest?: string | undefined;
    maxCharacters?: number;
}): string {
    const entries: ExecutionContractEntry[] = [];
    let order = 0;
    const addEntry = (
        label: string,
        value: string | undefined,
        initial = false,
    ) => {
        const normalized = normalizeRequirementText(value);

        if (!normalized) {
            return;
        }

        const key = normalized.replace(/\s+/gu, " ").toLocaleLowerCase();
        const existingIndex = entries.findIndex((entry) => entry.key === key);
        const inheritedInitial =
            existingIndex >= 0 && entries[existingIndex]?.initial === true;

        if (existingIndex >= 0) {
            entries.splice(existingIndex, 1);
        }

        entries.push({
            key,
            label: inheritedInitial ? "Initial requirement" : label,
            value: normalized,
            order: order++,
            initial: initial || inheritedInitial,
        });
    };

    addEntry("Initial requirement", input.initialGoal, true);
    [...(input.versions ?? [])]
        .filter(isAcceptedContractVersion)
        .sort((left, right) => left.versionNumber - right.versionNumber)
        .forEach((version) =>
            addEntry(
                `Accepted requirement from v${version.versionNumber}`,
                version.goal,
            ),
        );
    addEntry("Pending request from the current draft", input.pendingRequest);
    addEntry("Current request (highest priority)", input.currentRequest);

    if (entries.length === 0) {
        return "";
    }

    if (entries.length === 1 && entries[0]?.initial) {
        return entries[0].value;
    }

    const maxCharacters = Math.max(
        1_000,
        input.maxCharacters ?? MAX_EXECUTION_CONTRACT_CHARACTERS,
    );
    const header = [
        "Requirement contract (oldest to newest):",
        "Keep every non-conflicting requirement. The newest explicit request has highest priority and explicitly overrides an older requirement only when they conflict.",
        "Do not silently drop an accepted requirement.",
    ].join("\n");
    const initialEntry = entries.find((entry) => entry.initial);
    const newerEntries = entries.filter((entry) => !entry.initial);
    const selected: ExecutionContractEntry[] = [];
    let remaining = maxCharacters - header.length - 4;

    if (initialEntry) {
        const initialValue = truncateRequirement(
            initialEntry.value,
            Math.min(MAX_REQUIREMENT_CHARACTERS, Math.max(300, remaining / 3)),
        );
        selected.push({ ...initialEntry, value: initialValue });
        remaining -= initialEntry.label.length + initialValue.length + 6;
    }

    for (const entry of [...newerEntries].reverse()) {
        if (remaining < 120) {
            break;
        }

        const value = truncateRequirement(
            entry.value,
            Math.min(
                MAX_REQUIREMENT_CHARACTERS,
                Math.max(80, remaining - entry.label.length - 6),
            ),
        );
        selected.push({ ...entry, value });
        remaining -= entry.label.length + value.length + 6;
    }

    selected.sort((left, right) => left.order - right.order);
    const contract = [
        header,
        ...selected.map((entry) => `${entry.label}:\n${entry.value}`),
    ].join("\n\n");

    return contract.slice(0, maxCharacters);
}

// Complex routed/visual apps can require several streamed model actions plus
// one bounded repair. Keep a hard ceiling, but do not kill a run that is still
// receiving model chunks and making progress at the old 15-minute boundary.
const DEFAULT_RUN_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;

function resolveRunExecutionTimeoutMs(): number {
    const configuredTimeout = Number(
        process.env.APPFORGE_RUN_TIMEOUT_MS ??
            DEFAULT_RUN_EXECUTION_TIMEOUT_MS,
    );

    return Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_RUN_EXECUTION_TIMEOUT_MS;
}

function shouldPreserveCancelledRunState(
    signal: AbortSignal,
): boolean {
    return (
        signal.aborted &&
        signal.reason instanceof RunExecutionCancelledError
    );
}

type OperationScopedRunResult = RunReactAppAgentResult & {
    operationId?: string;
};

function scopeResultToOperation(
    result: RunReactAppAgentResult,
    operationId: string | undefined,
): OperationScopedRunResult {
    return operationId === undefined
        ? result
        : {
            ...result,
            operationId,
        };
}

function resultMatchesRunOperation(
    run: Run,
    result: RunReactAppAgentResult,
): boolean {
    const resultOperationId = (result as OperationScopedRunResult).operationId;

    return (
        run.operationId !== undefined &&
        resultOperationId !== undefined &&
        run.operationId === resultOperationId
    );
}
const ExecuteRunInputSchema = z.object({
    maxRepairAttempts: z.number().int().min(0).max(3).optional(),
    background: z.boolean().optional().default(false),
    resetWorkspace: z.boolean().optional(),
});
const PreviewRunInputSchema = z.object({
    versionNumber: z.number().int().min(1).optional(),
});

function formatRunErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : "Unknown run execution error";
}

function markRunAfterExecutionError(
    run: Run,
    error: unknown,
): void {
    delete run.operation;
    clearRunOperationProgress(run);
    run.errorMessage = formatRunErrorMessage(error);
    run.status = "failed";
}

async function workspaceHasDraft(workspaceRoot: string): Promise<boolean> {
    try {
        const appSource = await stat(path.join(workspaceRoot, "src", "App.tsx"));

        return appSource.isFile();
    } catch {
        return false;
    }
}

const RUNNABLE_WORKSPACE_FILES = [
    "package.json",
    "index.html",
    path.join("src", "main.tsx"),
    path.join("src", "App.tsx"),
];

async function workspaceHasRunnableApplication(
    workspaceRoot: string,
): Promise<boolean> {
    const checks = await Promise.all(
        RUNNABLE_WORKSPACE_FILES.map(async (filePath) => {
            try {
                return (await stat(path.join(workspaceRoot, filePath))).isFile();
            } catch {
                return false;
            }
        }),
    );

    return checks.every(Boolean);
}

async function prepareContinuationWorkspace(input: {
    workspaceRoot: string;
    versions: RunVersion[];
}): Promise<{ resetWorkspace: boolean; restoredVersion?: RunVersion }> {
    if (await workspaceHasRunnableApplication(input.workspaceRoot)) {
        return { resetWorkspace: false };
    }

    const latestVersion = findLatestVersion(input.versions);

    if (latestVersion) {
        try {
            await restoreRunVersionSnapshot({
                workspaceRoot: input.workspaceRoot,
                versionNumber: latestVersion.versionNumber,
                snapshotId: latestVersion.snapshotId,
            });

            if (await workspaceHasRunnableApplication(input.workspaceRoot)) {
                return {
                    resetWorkspace: false,
                    restoredVersion: latestVersion,
                };
            }
        } catch {
            // A missing or damaged legacy snapshot cannot serve as a safe
            // continuation baseline. Regenerate from the starter while the
            // accumulated requirement contract preserves accepted requests.
        }
    }

    return { resetWorkspace: true };
}

async function markRunAfterDraftExecutionError(
    run: Run,
    workspaceRoot: string,
    error: unknown,
    latestVersion?: RunVersion,
            workspaceFingerprintBeforeExecution?: WorkspaceFingerprint,
): Promise<void> {
    const hasDraft = await workspaceHasDraft(workspaceRoot);
    const errorMessage = formatRunErrorMessage(error);
    const unchangedFromBeforeExecution =
        hasDraft &&
        workspaceFingerprintBeforeExecution !== undefined &&
        workspaceFingerprintEquals(
            workspaceFingerprintBeforeExecution,
            await createUserVisibleWorkspaceFingerprint(workspaceRoot),
        );
    const unchangedFromLatestVersion =
        hasDraft &&
        latestVersion !== undefined &&
        await safeUserVisibleWorkspaceMatchesVersion({
            workspaceRoot,
            version: latestVersion,
        });
    const unchangedDraft = unchangedFromBeforeExecution || unchangedFromLatestVersion;

    delete run.operation;
    clearRunOperationProgress(run);
    run.errorMessage = unchangedDraft
        ? unchangedFromLatestVersion
            ? `${errorMessage}. No new draft was produced because the workspace still matches the latest saved version.`
            : `${errorMessage}. No new draft was produced for this request.`
        : errorMessage;
    run.status = hasDraft && !unchangedDraft
        ? "waiting_for_human"
        : "failed";
}

function isUnchangedWorkspaceReview(reason: string): boolean {
    return (
        reason.startsWith("Iteration did not change the workspace") ||
        reason.includes("No new draft was produced")
    );
}

function markRunAfterExecutionResult(
    run: Run,
    result: RunReactAppAgentResult,
    options: { workspaceRolledBack?: boolean } = {},
): MemoryEntry["outcome"] {
    if (
        !result.review.accepted &&
        (options.workspaceRolledBack ||
            isUnchangedWorkspaceReview(result.review.reason))
    ) {
        run.status = "failed";
        delete run.operation;
        clearRunOperationProgress(run);
        run.errorMessage = options.workspaceRolledBack
            ? `${result.review.reason} The rejected workspace changes were rolled back to the complete runnable baseline.`
            : result.review.reason;

        return "failed";
    }

    const settledStatus: MemoryEntry["outcome"] = result.review.accepted
        ? "succeeded"
        : "waiting_for_human";

    run.status = settledStatus;
    delete run.operation;
    clearRunOperationProgress(run);

    if (result.review.accepted) {
        delete run.operationPrompt;
    }

    delete run.errorMessage;

    return settledStatus;
}

function isActiveRunStatus(status: Run["status"]): boolean {
    return status === "running" || status === "repairing";
}

function startRunOperationProgress(
    run: Run,
    stage: RunOperationStage = "preparing",
): void {
    const now = new Date().toISOString();

    delete run.errorMessage;
    run.operationStage = stage;
    run.operationStartedAt = now;
    run.operationUpdatedAt = now;
}

function shouldRetryFromFreshWorkspace(input: {
    runStatus: Run["status"];
    versionsBeforeExecution: RunVersion[];
}): boolean {
    return (
        input.versionsBeforeExecution.length === 0 &&
        (input.runStatus === "failed" || input.runStatus === "cancelled")
    );
}

function clearRunOperationProgress(run: Run): void {
    delete run.operationStage;
    delete run.operationStartedAt;
    delete run.operationUpdatedAt;
}

function markRunAfterVersionSaveFailure(
    run: Run,
    error: unknown,
    pendingRequest?: string | undefined,
): void {
    run.status = "waiting_for_human";
    delete run.operation;
    delete run.operationId;
    clearRunOperationProgress(run);

    if (pendingRequest !== undefined) {
        run.operationPrompt = pendingRequest;
    }

    run.errorMessage = [
        "Generation completed and passed validation, but the version could not be saved.",
        "The validated workspace and its full execution result were preserved for human review.",
        `Version save error: ${formatRunErrorMessage(error)}`,
    ].join(" ");
}

function createPersistedOperationProgressReporter(input: {
    runRepository: RunRepositoryLike;
    runId: string;
    operationId: string;
}): (stage: RunOperationStage) => Promise<void> {
    return async (stage) => {
        const latestRun = await input.runRepository.findById(input.runId);

        if (
            !latestRun ||
            latestRun.operationId !== input.operationId ||
            !isActiveRunStatus(latestRun.status)
        ) {
            return;
        }

        const now = new Date().toISOString();
        latestRun.operationStage = stage;
        latestRun.operationStartedAt ??= now;
        latestRun.operationUpdatedAt = now;
        await input.runRepository.save(latestRun);
    };
}

async function saveRunIfChanged(
    runRepository: RunRepositoryLike,
    run: Run,
    changed: boolean,
): Promise<void> {
    if (changed) {
        await runRepository.save(run);
    }
}

function cleanSucceededRunState(run: Run): boolean {
    if (run.status !== "succeeded") {
        return false;
    }

    let changed = false;

    if (run.operation !== undefined) {
        delete run.operation;
        changed = true;
    }

    if (run.operationPrompt !== undefined) {
        delete run.operationPrompt;
        changed = true;
    }

    if (run.errorMessage !== undefined) {
        delete run.errorMessage;
        changed = true;
    }

    if (run.operationId !== undefined) {
        delete run.operationId;
        changed = true;
    }

    if (
        run.operationStage !== undefined ||
        run.operationStartedAt !== undefined ||
        run.operationUpdatedAt !== undefined
    ) {
        clearRunOperationProgress(run);
        changed = true;
    }

    return changed;
}

function cleanErroredWaitingRunState(run: Run): boolean {
    if (
        run.status !== "waiting_for_human" ||
        run.errorMessage === undefined
    ) {
        return false;
    }

    let changed = false;

    if (run.operation !== undefined) {
        delete run.operation;
        changed = true;
    }

    if (run.operationId !== undefined) {
        delete run.operationId;
        changed = true;
    }

    if (
        run.operationStage !== undefined ||
        run.operationStartedAt !== undefined ||
        run.operationUpdatedAt !== undefined
    ) {
        clearRunOperationProgress(run);
        changed = true;
    }

    return changed;
}

function cleanPersistedRunState(run: Run): boolean {
    return cleanSucceededRunState(run) || cleanErroredWaitingRunState(run);
}

function isRegenerationPrompt(prompt: string): boolean {
    return isExplicitRegenerationPrompt(prompt);
}

function isExplicitRegenerationPrompt(prompt: string): boolean {
    return /\u91cd\u65b0\u751f\u6210|\u91cd\u65b0\u7ed9\u6211\u751f\u6210|\u91cd\u65b0\u505a|\u91cd\u505a|\u4ece\u5934\u751f\u6210|\u4ece\u5934\u505a|\u5b8c\u5168\u91cd\u65b0|\u6362\u4e00\u4e2a\u754c\u9762|\u6362\u4e2a\u754c\u9762|new design|regenerate|start over|from scratch/iu.test(
        prompt,
    );
}

function summarizeRunMemory(result: RunReactAppAgentResult): string {
    const passedChecks = result.eval.checks.filter((check) => check.passed).length;

    return [
        `Review: ${result.review.reason}`,
        `Attempts: ${result.attempts.length}`,
        `Eval: ${passedChecks}/${result.eval.checks.length} checks passed`,
        `Build exit code: ${result.build.exitCode}`,
    ].join(" ");
}

function createVersionRestoreResult(
    workspaceRoot: string,
    version: RunVersion,
): RunReactAppAgentResult {
    const review = {
        accepted: true,
        reason: `Restored version v${version.versionNumber} as the current workspace baseline.`,
        checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
        },
    };

    return {
        workspaceRoot,
        coordination: coordinateAgents({
            goal: version.goal,
        }),
        agent: {
            finished: true,
            stopReason: "finish",
            steps: [],
        },
        install: {
            exitCode: 0,
            stdout: "",
            stderr: "",
        },
        build: {
            exitCode: 0,
            stdout: "",
            stderr: "",
        },
        eval: {
            passed: true,
            checks: [],
        },
        review,
        attempts: [],
    };
}

function createDraftExecutionErrorResult(input: {
    run: Run;
    workspaceRoot: string;
    goal?: string | undefined;
}): RunReactAppAgentResult {
    const reason = input.run.errorMessage ?? "Run execution failed";
    const review = {
        accepted: false,
        reason,
        checks: {
            agentFinished: false,
            installPassed: false,
            buildPassed: false,
            evalPassed: false,
        },
    };

    return {
        workspaceRoot: input.workspaceRoot,
        coordination: coordinateAgents({
            goal: input.goal ?? input.run.operationPrompt ?? input.run.goal,
        }),
        agent: {
            finished: false,
            stopReason: "action_failed",
            steps: [],
        },
        install: {
            exitCode: -1,
            stdout: "",
            stderr: "",
        },
        build: {
            exitCode: -1,
            stdout: "",
            stderr: "",
        },
        eval: {
            passed: false,
            checks: [],
        },
        review,
        attempts: [],
    };
}

function hasWorkspaceChangingAction(result: RunReactAppAgentResult): boolean {
    const agents = [
        result.agent,
        ...result.attempts.map((attempt) => attempt.agent),
    ];

    return agents.some((agent) =>
        agent.steps.some(
            (step) =>
                step.execution.ok &&
                step.execution.changed !== false &&
                [
                    "write_file",
                    "append_file",
                    "edit_file",
                    "get_image",
                ].includes(step.action.type),
        ),
    );
}

function requireIterationChange(
    result: RunReactAppAgentResult,
    workspaceChanged: boolean,
): RunReactAppAgentResult {
    if (workspaceChanged) {
        return result;
    }

    const actionSummary = hasWorkspaceChangingAction(result)
        ? " The agent reported a mutating action, but the user-visible workspace fingerprint stayed unchanged."
        : "";

    return {
        ...result,
        review: {
            ...result.review,
            accepted: false,
            reason:
                "Iteration did not change the workspace. The agent returned without writing files or assets for the requested update." +
                actionSummary,
        },
    };
}

const VERSION_COMPARISON_ENTRIES = [
    "src",
    "public",
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
];
const USER_VISIBLE_ROOT_FILES = [
    "index.html",
    "package.json",
    "tsconfig.json",
];

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function collectVersionFiles(
    root: string,
    relativePath: string,
): Promise<string[]> {
    const absolutePath = path.join(root, relativePath);

    if (!(await pathExists(absolutePath))) {
        return [];
    }

    const stats = await stat(absolutePath);

    if (stats.isFile()) {
        return [relativePath];
    }

    if (!stats.isDirectory()) {
        return [];
    }

    const entries = await readdir(absolutePath, {
        withFileTypes: true,
    });
    const files = await Promise.all(
        entries.map((entry) =>
            collectVersionFiles(root, path.join(relativePath, entry.name)),
        ),
    );

    return files.flat();
}

async function listVersionComparableFiles(root: string): Promise<string[]> {
    const files = await Promise.all(
        VERSION_COMPARISON_ENTRIES.map((entry) =>
            collectVersionFiles(root, entry),
        ),
    );

    return [...new Set(files.flat())].sort();
}

async function fileContentsMatch(
    leftRoot: string,
    rightRoot: string,
    relativePath: string,
): Promise<boolean> {
    try {
        const [left, right] = await Promise.all([
            readFile(path.join(leftRoot, relativePath)),
            readFile(path.join(rightRoot, relativePath)),
        ]);

        return left.equals(right);
    } catch {
        return false;
    }
}

type WorkspaceFingerprint = Array<{
    path: string;
    hash: string;
}>;

async function createWorkspaceFingerprint(
    workspaceRoot: string,
): Promise<WorkspaceFingerprint> {
    const files = await listVersionComparableFiles(workspaceRoot);
    const fingerprints = await Promise.all(
        files.map(async (filePath) => {
            const content = await readFile(path.join(workspaceRoot, filePath));

            return {
                path: filePath,
                hash: createHash("sha256").update(content).digest("hex"),
            };
        }),
    );

    return fingerprints;
}

function extractLocalAssetReferences(source: string): string[] {
    const assetExtensions =
        "avif|bmp|gif|ico|jpe?g|json|mp3|mp4|ogg|pdf|png|svg|webm|webp|woff2?|ttf";
    const localAssetPattern = new RegExp(
        `["'\`(]((?:\\./|/)?(?:assets/)?[^\\s"'\`)<>?#]+\\.(?:${assetExtensions})(?:[?#][^\\s"'\`)<>]*)?)`,
        "giu",
    );

    return [
        ...new Set(
            Array.from(source.matchAll(localAssetPattern))
                .map((match) => match[1] ?? "")
                .map((assetPath) => assetPath.split(/[?#]/u, 1)[0] ?? "")
                .map((assetPath) => assetPath.replace(/^\.\//u, ""))
                .map((assetPath) => assetPath.replace(/^\/+/, ""))
                .filter(
                    (assetPath) =>
                        assetPath.length > 0 &&
                        !assetPath.startsWith("../"),
                )
                .map((assetPath) => `public/${assetPath}`),
        ),
    ].sort();
}

async function readOptionalFile(
    root: string,
    relativePath: string,
): Promise<Buffer | undefined> {
    try {
        return await readFile(path.join(root, relativePath));
    } catch {
        return undefined;
    }
}

async function createUserVisibleWorkspaceFingerprint(
    workspaceRoot: string,
): Promise<WorkspaceFingerprint> {
    const sourceFiles = [
        ...await collectVersionFiles(workspaceRoot, "src"),
        ...USER_VISIBLE_ROOT_FILES,
    ];
    const sourceEntries = await Promise.all(
        [...new Set(sourceFiles)].sort().map(async (filePath) => {
            const content = await readOptionalFile(workspaceRoot, filePath);

            return {
                path: filePath,
                content,
            };
        }),
    );
    const sourceText = sourceEntries
        .map((entry) => entry.content?.toString("utf8") ?? "")
        .join("\n");
    const referencedAssets = extractLocalAssetReferences(sourceText);
    const assetEntries = await Promise.all(
        referencedAssets.map(async (filePath) => ({
            path: filePath,
            content: await readOptionalFile(workspaceRoot, filePath),
        })),
    );

    return [...sourceEntries, ...assetEntries]
        .map((entry) => ({
            path: entry.path,
            hash: entry.content
                ? createHash("sha256").update(entry.content).digest("hex")
                : "missing",
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
}

function workspaceFingerprintEquals(
    left: WorkspaceFingerprint,
    right: WorkspaceFingerprint,
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function workspaceMatchesVersion(input: {
    workspaceRoot: string;
    version: RunVersion;
}): Promise<boolean> {
    const snapshotRoot = path.join(
        input.workspaceRoot,
        "versions",
        getRunVersionSnapshotDirectoryName(input.version),
    );

    if (!(await pathExists(snapshotRoot))) {
        return false;
    }

    const [workspaceFiles, snapshotFiles] = await Promise.all([
        listVersionComparableFiles(input.workspaceRoot),
        listVersionComparableFiles(snapshotRoot),
    ]);

    if (workspaceFiles.length !== snapshotFiles.length) {
        return false;
    }

    if (
        workspaceFiles.some((filePath, index) => filePath !== snapshotFiles[index])
    ) {
        return false;
    }

    const comparisons = await Promise.all(
        workspaceFiles.map((filePath) =>
            fileContentsMatch(input.workspaceRoot, snapshotRoot, filePath),
        ),
    );

    return comparisons.every(Boolean);
}

async function safeWorkspaceMatchesVersion(input: {
    workspaceRoot: string;
    version: RunVersion;
}): Promise<boolean> {
    try {
        return await workspaceMatchesVersion(input);
    } catch {
        return false;
    }
}

async function safeUserVisibleWorkspaceMatchesVersion(input: {
    workspaceRoot: string;
    version: RunVersion;
}): Promise<boolean> {
    try {
        const snapshotRoot = path.join(
            input.workspaceRoot,
            "versions",
            getRunVersionSnapshotDirectoryName(input.version),
        );

        if (!(await pathExists(snapshotRoot))) {
            return false;
        }

        const [workspaceFingerprint, snapshotFingerprint] =
            await Promise.all([
                createUserVisibleWorkspaceFingerprint(input.workspaceRoot),
                createUserVisibleWorkspaceFingerprint(snapshotRoot),
            ]);

        return workspaceFingerprintEquals(
            workspaceFingerprint,
            snapshotFingerprint,
        );
    } catch {
        return false;
    }
}

function rejectUnchangedIteration(
    result: RunReactAppAgentResult,
): RunReactAppAgentResult {
    return {
        ...result,
        review: {
            ...result.review,
            accepted: false,
            reason:
                "Iteration did not change the workspace compared with the latest saved version.",
        },
    };
}

function rejectUnchangedWorkspace(
    result: RunReactAppAgentResult,
): RunReactAppAgentResult {
    return {
        ...result,
        review: {
            ...result.review,
            accepted: false,
            reason:
                "No new draft was produced because the workspace still matches the latest saved version.",
        },
    };
}

function rejectUnchangedCurrentDraft(
    result: RunReactAppAgentResult,
): RunReactAppAgentResult {
    return {
        ...result,
        review: {
            ...result.review,
            accepted: false,
            reason:
                "No new draft was produced because the workspace did not change after the repair feedback.",
        },
    };
}

function findLatestVersion(versions: RunVersion[]): RunVersion | undefined {
    return [...versions].sort(
        (left, right) => right.versionNumber - left.versionNumber,
    )[0];
}

function normalizeRunResult(
    result: RunReactAppAgentResult,
): RunReactAppAgentResult {
    let normalizedReview = normalizeStepLimitOnlyReview(result.review);

    if (
        !normalizedReview.accepted &&
        normalizedReview.reason === "Rejected because agent did not finish." &&
        !normalizedReview.checks.agentFinished &&
        normalizedReview.checks.installPassed &&
        normalizedReview.checks.buildPassed &&
        normalizedReview.checks.evalPassed &&
        normalizedReview.checks.browserPassed === true &&
        hasWorkspaceChangingAction(result)
    ) {
        normalizedReview = {
            ...normalizedReview,
            accepted: true,
            reason:
                "The agent did not emit finish, but the changed workspace passed install/build/eval/browser validation.",
            checks: {
                ...normalizedReview.checks,
                agentFinished: true,
            },
        };
    }

    if (
        result.agent.stopReason === "model_error" &&
        !hasWorkspaceChangingAction(result)
    ) {
        const agentError = result.agent.errorMessage?.trim();
        const reason = [
            "No new draft was produced because the coding model failed before changing the workspace.",
            agentError ? `Agent error: ${agentError}` : "",
        ]
            .filter((part) => part.length > 0)
            .join(" ");

        if (
            normalizedReview.accepted ||
            normalizedReview.reason !== reason
        ) {
            normalizedReview = {
                ...normalizedReview,
                accepted: false,
                reason,
            };
        }
    }

    if (normalizedReview === result.review) {
        return result;
    }

    return {
        ...result,
        review: normalizedReview,
    };
}

function countPassedChecks(checks: { passed: boolean }[] = []): number {
    return checks.filter((check) => check.passed).length;
}

function buildRunReport(input: {
    run: Run;
    result?: RunReactAppAgentResult;
    versions: RunVersion[];
    files: string[];
    memory: MemoryEntry[];
}): RunReport {
    const evalChecks = input.result?.eval.checks ?? [];
    const browserChecks = input.result?.browserEval?.checks ?? [];
    const attempts = input.result?.attempts.length ?? 0;
    const reviewReason = input.result?.review.reason;
    const evalPassedChecks = countPassedChecks(evalChecks);
    const browserPassedChecks = countPassedChecks(browserChecks);

    const statusLine = input.result
        ? `Run ${input.run.status}: ${attempts} attempt(s), ${evalPassedChecks}/${evalChecks.length} eval checks, ${browserPassedChecks}/${browserChecks.length} browser checks.`
        : `Run ${input.run.status}: execution has not produced an agent result yet.`;

    const narrative = [
        `Goal: ${input.run.goal}`,
        statusLine,
        reviewReason ? `Review: ${reviewReason}` : "",
        input.versions.length > 0
            ? `Versions: ${input.versions.length} snapshot(s) saved.`
            : "Versions: no snapshots saved yet.",
        input.files.length > 0
            ? `Files: ${input.files.slice(0, 6).join(", ")}`
            : "Files: no generated files listed yet.",
    ]
        .filter((part) => part.length > 0)
        .join("\n");

    const report: RunReport = {
        run: input.run,
        generatedAt: new Date().toISOString(),
        statusLine,
        summary: {
            attempts,
            evalPassedChecks,
            evalTotalChecks: evalChecks.length,
            browserPassedChecks,
            browserTotalChecks: browserChecks.length,
            ...(input.result
                ? {
                    agentFinished: input.result.agent.finished,
                    buildExitCode: input.result.build.exitCode,
                    evalPassed: input.result.eval.passed,
                    reviewAccepted: input.result.review.accepted,
                    reviewReason: input.result.review.reason,
                }
                : {}),
            ...(input.result?.browserEval
                ? {
                    browserPassed: input.result.browserEval.passed,
                }
                : {}),
        },
        ...(input.result?.coordination
            ? {
                coordination: {
                    plan: input.result.coordination.plan,
                    assignments: input.result.coordination.assignments,
                },
            }
            : {}),
        trace: input.result?.trace ?? [],
        versions: input.versions,
        files: input.files,
        memory: input.memory.map((entry) => ({
            outcome: entry.outcome,
            summary: entry.summary,
            createdAt: entry.createdAt,
        })),
        narrative,
    };

    return RunReportSchema.parse(report);
}

async function listReportFiles(workspaceRoot: string): Promise<string[]> {
    const files = new Set<string>();

    for (const directory of [".", "src", "public/assets"]) {
        try {
            const directoryFiles = await listWorkspaceFiles(
                workspaceRoot,
                directory,
            );

            directoryFiles.forEach((filePath) =>
                files.add(filePath.replaceAll("\\", "/")),
            );
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

    return [...files].sort();
}

async function removeWorkspaceWhenAvailable(workspaceRoot: string): Promise<void> {
    try {
        await rm(workspaceRoot, {
            recursive: true,
            force: true,
        });
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            (error.code === "EBUSY" || error.code === "EPERM")
        ) {
            // Old local preview processes can temporarily lock Windows files.
            // The run has already been deleted from the product data store.
            return;
        }

        throw error;
    }
}

async function maybeCompactMemory(
    memoryRepository: MemoryRepositoryLike,
): Promise<void> {
    const memories = await memoryRepository.list();
    const summaries = await memoryRepository.listSummaries();

    if (
        !shouldCompactMemory({
            memoryCount: memories.length,
            summaryCount: summaries.length,
        })
    ) {
        return;
    }

    const summary = compactMemoryEntries({
        entries: memories,
    });

    if (summary === undefined) {
        return;
    }

    await memoryRepository.saveSummary(summary);
}
export  function buildApp(
    runRepository: RunRepositoryLike = new RunRepository(),
    workspaceManager = new WorkspaceManager(
        path.resolve(".appforge", "workspaces"),
    ),
    executeRun?:ExecuteRun,
    previewManager=new PreviewManager(),
    memoryRepository: MemoryRepositoryLike = new MemoryRepository(),
    browserEvaluator: BrowserEvaluator = new PlaywrightBrowserEvaluator(),
    runExecutionManagerOptions: RunExecutionManagerOptions = {},
) {
    const app = Fastify();
    const runExecutionManager = new RunExecutionManager({
        timeoutMs: resolveRunExecutionTimeoutMs(),
        ...runExecutionManagerOptions,
    });

    async function runOperationIsAuthoritative(
        runId: string,
        operationId: string,
    ): Promise<boolean> {
        const latestRun = await runRepository.findById(runId);

        return latestRun?.operationId === operationId;
    }

    async function assertRunOperationAuthority(
        runId: string,
        operationId: string,
    ): Promise<void> {
        if (!(await runOperationIsAuthoritative(runId, operationId))) {
            throw new Error(
                `Run operation ${operationId} is no longer authoritative`,
            );
        }
    }

    async function settleManagedOperationFailure(input: {
        runId: string;
        operationId: string;
        error: unknown;
    }): Promise<void> {
        const latestRun = await runRepository.findById(input.runId);

        if (
            !latestRun ||
            latestRun.operationId !== input.operationId
        ) {
            return;
        }

        latestRun.status =
            input.error instanceof RunExecutionCancelledError
                ? "cancelled"
                : "failed";
        delete latestRun.operation;
        delete latestRun.operationId;
        clearRunOperationProgress(latestRun);
        latestRun.errorMessage = formatRunErrorMessage(input.error);
        await runRepository.save(latestRun);
    }

    async function runManagedOperation<T>(input: {
        lease: RunExecutionLease;
        runId: string;
        operationId: string | (() => string | undefined);
        task: (signal: AbortSignal) => Promise<T>;
    }): Promise<T> {
        try {
            return await input.lease.run(input.task);
        } catch (error) {
            const operationId =
                typeof input.operationId === "function"
                    ? input.operationId()
                    : input.operationId;
            try {
                if (operationId) {
                    await settleManagedOperationFailure({
                        runId: input.runId,
                        operationId,
                        error,
                    });
                }
            } catch (settlementError) {
                app.log.error(settlementError);
            }

            throw error;
        }
    }

    app.addHook("onClose", async () => {
        runExecutionManager.cancelAll();
        await runExecutionManager.waitForIdle();
    });

    async function restoreLatestSavedVersion(run: Run): Promise<boolean> {
        const latestVersion = findLatestVersion(
            await runRepository.listVersions(run.id),
        );

        if (!latestVersion) {
            return false;
        }

        await previewManager.stopRun(run.id);
        await restoreRunVersionSnapshot({
            workspaceRoot: workspaceManager.resolve(run.id),
            versionNumber: latestVersion.versionNumber,
            snapshotId: latestVersion.snapshotId,
        });

        return true;
    }

    async function saveNextRunVersion(input: {
        run: Run;
        goal: string;
        summaryForVersion: (versionNumber: number) => string;
        review?: RunReactAppAgentResult["review"];
        designPlan?: RunReactAppAgentResult["designPlan"];
        designPlanSource?: RunReactAppAgentResult["designPlanSource"];
        signal?: AbortSignal;
        operationId?: string;
    }): Promise<RunVersion> {
        input.signal?.throwIfAborted();
        if (input.operationId !== undefined) {
            await assertRunOperationAuthority(
                input.run.id,
                input.operationId,
            );
        }
        const existingVersions = await runRepository.listVersions(input.run.id);
        if (input.operationId !== undefined) {
            await assertRunOperationAuthority(
                input.run.id,
                input.operationId,
            );
        }
        const nextVersionNumber =
            existingVersions.reduce(
                (highestVersion, version) =>
                    Math.max(highestVersion, version.versionNumber),
                0,
            ) + 1;
        const versionId = randomUUID();
        const version: RunVersion = {
            id: versionId,
            runId: input.run.id,
            versionNumber: nextVersionNumber,
            snapshotId: versionId,
            goal: input.goal,
            summary: input.summaryForVersion(nextVersionNumber),
            ...(input.review ? { review: input.review } : {}),
            ...(input.designPlan ? { designPlan: input.designPlan } : {}),
            ...(input.designPlanSource
                ? { designPlanSource: input.designPlanSource }
                : {}),
            createdAt: new Date().toISOString(),
        };

        let snapshotSaved = false;

        try {
            input.signal?.throwIfAborted();
            if (input.operationId !== undefined) {
                await assertRunOperationAuthority(
                    input.run.id,
                    input.operationId,
                );
            }
            await saveRunVersionSnapshot({
                workspaceRoot: workspaceManager.resolve(input.run.id),
                versionNumber: nextVersionNumber,
                snapshotId: versionId,
            });
            snapshotSaved = true;
            input.signal?.throwIfAborted();
            if (input.operationId !== undefined) {
                await assertRunOperationAuthority(
                    input.run.id,
                    input.operationId,
                );
            }
            await runRepository.saveVersion(version);
            input.signal?.throwIfAborted();
            if (input.operationId !== undefined) {
                await assertRunOperationAuthority(
                    input.run.id,
                    input.operationId,
                );
            }
        } catch (error) {
            await runRepository.replaceVersions(
                input.run.id,
                existingVersions,
            );

            if (snapshotSaved) {
                await deleteRunVersionSnapshot({
                    workspaceRoot: workspaceManager.resolve(input.run.id),
                    versionNumber: nextVersionNumber,
                    snapshotId: versionId,
                });
            }

            throw error;
        }

        return version;
    }

    async function preserveValidatedResultAfterVersionSaveFailure(input: {
        run: Run;
        operationId: string;
        error: unknown;
        signal: AbortSignal;
        pendingRequest?: string | undefined;
    }): Promise<void> {
        if (
            input.signal.aborted ||
            isRunExecutionAbortError(input.error)
        ) {
            throw input.error;
        }

        await assertRunOperationAuthority(input.run.id, input.operationId);
        markRunAfterVersionSaveFailure(
            input.run,
            input.error,
            input.pendingRequest,
        );
        // The operation-id check above is deliberately performed immediately
        // before this terminal save. A detached or late operation must never
        // replace state belonging to a newer retry.
        await runRepository.save(input.run);
    }

    async function buildExecutionMemoryContext(goal: string): Promise<string> {
        const memoryEntries = await memoryRepository.list();
        const memorySummaries = await memoryRepository.listSummaries();
        const relevantMemoryEntries = retrieveRelevantMemory({
            goal,
            entries: memoryEntries,
            maxEntries: 5,
        });

        return formatAgentMemoryContext({
            entries: relevantMemoryEntries,
            summaries: memorySummaries,
            maxEntries: 5,
            maxCharacters: 2000,
        });
    }

    async function loadRunResult(run: Run): Promise<RunReactAppAgentResult | undefined> {
        const result = await runRepository.findResultByRunId(run.id);

        if (
            run.errorMessage !== undefined &&
            run.operation === undefined &&
            run.operationPrompt !== undefined &&
            !result?.review.accepted &&
            result?.review.reason !== run.errorMessage
        ) {
            const versions = await runRepository.listVersions(run.id);
            const errorResult = createDraftExecutionErrorResult({
                run,
                workspaceRoot: workspaceManager.resolve(run.id),
                goal: resolveExecutionContract({
                    initialGoal: run.goal,
                    versions,
                    pendingRequest: run.operationPrompt,
                }),
            });
            const scopedErrorResult = scopeResultToOperation(
                errorResult,
                run.operationId,
            );
            await runRepository.saveResult(run.id, scopedErrorResult);

            return scopedErrorResult;
        }

        if (!result) {
            return undefined;
        }

        if (
            run.status === "queued" ||
            (isActiveRunStatus(run.status) &&
                runExecutionManager.isRunning(run.id))
        ) {
            return result;
        }

        if (
            result.review.accepted &&
            run.status !== "succeeded" &&
            !(
                isActiveRunStatus(run.status) &&
                resultMatchesRunOperation(run, result)
            )
        ) {
            // The repository stores one latest result per run. During a new
            // retry/iteration that value can still belong to the previous
            // operation, so an accepted legacy result is not authority for
            // the current persisted status unless the operation ids match.
            return result;
        }

        const normalizedResult = normalizeRunResult(result);

        if (normalizedResult !== result) {
            await runRepository.saveResult(run.id, normalizedResult);

            if (normalizedResult.review.accepted) {
                const existingVersions = await runRepository.listVersions(run.id);

                if (run.status !== "succeeded" || existingVersions.length === 0) {
                    const pendingRequest = run.operationPrompt;
                    await saveNextRunVersion({
                        run,
                        goal: pendingRequest ?? run.goal,
                        summaryForVersion: (versionNumber) =>
                            versionNumber === 1
                                ? "Initial generated version"
                                : `Accepted version ${versionNumber}`,
                        review: normalizedResult.review,
                        designPlan: normalizedResult.designPlan,
                        designPlanSource: normalizedResult.designPlanSource,
                    });
                }
            }
        }

        if (
            !normalizedResult.review.accepted &&
            isUnchangedWorkspaceReview(normalizedResult.review.reason)
        ) {
            const changed =
                run.status !== "failed" ||
                run.operation !== undefined ||
                run.operationId !== undefined ||
                run.operationStage !== undefined ||
                run.operationStartedAt !== undefined ||
                run.operationUpdatedAt !== undefined ||
                run.errorMessage !== normalizedResult.review.reason;

            run.status = "failed";
            delete run.operation;
            delete run.operationId;
            clearRunOperationProgress(run);
            run.errorMessage = normalizedResult.review.reason;
            await saveRunIfChanged(runRepository, run, changed);

            return normalizedResult;
        }

        if (run.status === "waiting_for_human") {
            const latestVersion = findLatestVersion(
                await runRepository.listVersions(run.id),
            );

            if (
                latestVersion &&
                await safeUserVisibleWorkspaceMatchesVersion({
                    workspaceRoot: workspaceManager.resolve(run.id),
                    version: latestVersion,
                })
            ) {
                const reason =
                    "No new draft was produced because the workspace still matches the latest saved version.";
                const changed =
                    run.operation !== undefined ||
                    run.errorMessage !== reason;

                run.status = "failed";
                delete run.operation;
                run.errorMessage = reason;
                await saveRunIfChanged(runRepository, run, changed);

                return {
                    ...normalizedResult,
                    review: {
                        ...normalizedResult.review,
                        accepted: false,
                        reason,
                    },
                };
            }
        }

        if (normalizedResult.review.accepted) {
            const changedStatus = run.status !== "succeeded";

            if (changedStatus) {
                run.status = "succeeded";
            }

            const changedCleanup = cleanSucceededRunState(run);
            await saveRunIfChanged(
                runRepository,
                run,
                changedStatus || changedCleanup,
            );
        }

        return normalizedResult;
    }

    async function loadLatestDesignPlan(run: Run): Promise<DesignPlan | undefined> {
        const result = await runRepository.findResultByRunId(run.id);
        if (result?.designPlan) {
            return result.designPlan;
        }

        const latestVersion = findLatestVersion(
            await runRepository.listVersions(run.id),
        );
        return latestVersion?.designPlan;
    }

    void app.register(cors, {
        origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
        methods: ["GET", "POST", "DELETE", "OPTIONS"],
    });

    app.get("/health", async () => {
        return {
            status: "ok",
        };

    });
    app.get("/memory", async () => {
        return {
            memories: await memoryRepository.list(),
        };
    });
    app.get("/runs", async () => {
        const runs = await runRepository.list();
        const runsWithVersions = [];

        for (const run of runs) {
            await loadRunResult(run);
            await saveRunIfChanged(
                runRepository,
                run,
                cleanPersistedRunState(run),
            );
            runsWithVersions.push({
                ...run,
                latestVersion: findLatestVersion(
                    await runRepository.listVersions(run.id),
                ),
            });
        }

        return {
            runs: runsWithVersions,
        };
    });
    app.post("/runs", async (request, reply) => {
  const result = CreateRunInputSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid create run input",
    });
  }

  if (containsLikelyMojibake(result.data.goal)) {
    return reply.status(400).send({
      error: "Goal appears to be garbled text",
      message: "Please re-enter the goal using UTF-8 text.",
    });
  }

  const run = {
    id: randomUUID(),
    goal: result.data.goal,
    status: "queued" as const,
    createdAt: new Date().toISOString(),
  };
  await workspaceManager.create(run.id);
  await runRepository.save(run);

  return reply.status(201).send(run);
});
    app.post<{Params:{ id:string}}>(
        "/runs/:id/execute",
        async  (request,reply)=>{
            const run = await runRepository.findById(request.params.id);
            if (!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            if(!executeRun){
                return reply.status(501).send({
                  error:"Run execution is not configured",
                });
            }
            const input = ExecuteRunInputSchema.safeParse(request.body ?? {});

            if (!input.success) {
                return reply.status(400).send({
                    error: "Invalid execute run input",
                });
            }

            if (isActiveRunStatus(run.status)) {
                return reply.status(409).send({
                    error: "Run is already executing",
                });
            }
            const runStatusAtExecutionRequest = run.status;

            const executionLease = runExecutionManager.tryAcquire(run.id);

            if (!executionLease) {
                return reply.status(409).send({
                    error: "Run is already executing",
                });
            }

            const performExecution = async (
                signal: AbortSignal,
                markRunning = true,
            ): Promise<{
                run: Run;
                result: RunReactAppAgentResult;
                versions: RunVersion[];
            }> => {
                const workspaceRoot = workspaceManager.resolve(run.id);
                let versionsBeforeExecution: RunVersion[] = [];
                let workspaceFingerprintBeforeExecution:
                    | WorkspaceFingerprint
                    | undefined;
                let executionContract: string | undefined;
                let executionAttemptStarted = false;
                let operationId = run.operationId;
                let resultToPreserveOnError:
                    | RunReactAppAgentResult
                    | undefined;
                let preservedResultWorkspaceRolledBack = false;

                try {
                signal.throwIfAborted();
                versionsBeforeExecution = await runRepository.listVersions(run.id);
                const requestedResetWorkspace =
                    input.data.resetWorkspace ?? run.status === "queued";
                const requestedContinuation =
                    !requestedResetWorkspace;
                let effectiveResetWorkspace = requestedResetWorkspace;

                if (requestedContinuation) {
                    const previousResult =
                        await runRepository.findResultByRunId(run.id);
                    const previousExecutionProducedDraft =
                        previousResult !== undefined &&
                        hasWorkspaceChangingAction(previousResult);
                    const retryFromFreshWorkspace =
                        shouldRetryFromFreshWorkspace({
                            runStatus: runStatusAtExecutionRequest,
                            versionsBeforeExecution,
                        });

                    if (retryFromFreshWorkspace) {
                        effectiveResetWorkspace = true;
                    } else if (
                        versionsBeforeExecution.length === 0 &&
                        previousResult !== undefined &&
                        !previousExecutionProducedDraft
                    ) {
                        effectiveResetWorkspace = true;
                    } else {
                        effectiveResetWorkspace = (
                            await prepareContinuationWorkspace({
                                workspaceRoot,
                                versions: versionsBeforeExecution,
                            })
                        ).resetWorkspace;
                    }
                }

                workspaceFingerprintBeforeExecution =
                    await createUserVisibleWorkspaceFingerprint(workspaceRoot);
                const hasRecoveryBaseline =
                    await workspaceHasRunnableApplication(workspaceRoot);
                const currentRequest =
                    requestedContinuation
                        ? normalizeRequirementText(run.operationPrompt)
                        : undefined;
                executionContract = resolveExecutionContract({
                    initialGoal: run.goal,
                    versions: versionsBeforeExecution,
                    pendingRequest: run.operationPrompt,
                    currentRequest,
                });

                if (markRunning) {
                    run.status = "running";
                    run.operation = requestedContinuation
                        ? "retry"
                        : "initial_generation";
                    operationId = randomUUID();
                    run.operationId = operationId;
                    startRunOperationProgress(run);
                    await runRepository.save(run);
                    signal.throwIfAborted();
                }

                if (operationId === undefined) {
                    throw new Error("Run execution has no operation id");
                }

                const executeRunInput: Parameters<ExecuteRun>[0] = {
                    goal: executionContract,
                    workspaceRoot,
                    signal,
                };
                if (operationId) {
                    executeRunInput.onProgress =
                        createPersistedOperationProgressReporter({
                            runRepository,
                            runId: run.id,
                            operationId,
                        });
                }
                if (currentRequest) {
                    executeRunInput.currentRequest = currentRequest;
                }
                const latestDesignPlan = await loadLatestDesignPlan(run);
                if (latestDesignPlan) {
                    executeRunInput.designPlan = latestDesignPlan;
                }
                const memoryContext =
                    await buildExecutionMemoryContext(executionContract);
                signal.throwIfAborted();

                if (memoryContext.length > 0) {
                    executeRunInput.memoryContext = memoryContext;
                }

                if (input.data.maxRepairAttempts !== undefined) {
                    executeRunInput.maxRepairAttempts =
                        input.data.maxRepairAttempts;
                }

                if (effectiveResetWorkspace !== undefined) {
                    executeRunInput.resetWorkspace = effectiveResetWorkspace;
                }

                const result = await executeWithWorkspaceRollback({
                    workspaceRoot: executeRunInput.workspaceRoot,
                    preserveWorkspaceOnError: (error) =>
                        !hasRecoveryBaseline &&
                        !isRunExecutionAbortError(error),
                    execute: async () => {
                        executionAttemptStarted = true;
                        const executionResult =
                            await executeRun(executeRunInput);
                        signal.throwIfAborted();
                        return executionResult;
                    },
                    rollbackWhen: (executionResult) => {
                        signal.throwIfAborted();
                        return (
                            hasRecoveryBaseline &&
                            !executionResult.review.accepted
                        );
                    },
                });
                resultToPreserveOnError = result;
                preservedResultWorkspaceRolledBack =
                    hasRecoveryBaseline && !result.review.accepted;
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);

                const requestForVersion = currentRequest ?? run.operationPrompt;
                const completedRun: Run = { ...run };
                const outcome = markRunAfterExecutionResult(completedRun, result, {
                    workspaceRolledBack:
                        hasRecoveryBaseline && !result.review.accepted,
                });
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.saveResult(
                    run.id,
                    scopeResultToOperation(result, operationId),
                );
                delete completedRun.operationId;
                await assertRunOperationAuthority(run.id, operationId);
                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: executionContract,
                    outcome,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);
                if (result.review.accepted) {
                    try {
                        await saveNextRunVersion({
                            run: completedRun,
                            goal: requestForVersion ?? completedRun.goal,
                            summaryForVersion: (versionNumber) =>
                                versionNumber === 1
                                    ? result.agent.finished
                                        ? "Initial generated version"
                                        : "Initial attempt did not finish"
                                    : `Execution version ${versionNumber}`,
                            review: result.review,
                            designPlan: result.designPlan,
                            designPlanSource: result.designPlanSource,
                            signal,
                            operationId,
                        });
                    } catch (error) {
                        await preserveValidatedResultAfterVersionSaveFailure({
                            run: completedRun,
                            operationId,
                            error,
                            signal,
                            ...(requestForVersion
                                ? { pendingRequest: requestForVersion }
                                : {}),
                        });
                        throw error;
                    }
                }
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.save(completedRun);
                signal.throwIfAborted();

                return {
                    run: completedRun,
                    result,
                    versions: await runRepository.listVersions(run.id),
                };
                } catch (error) {
                    if (shouldPreserveCancelledRunState(signal)) {
                        throw error;
                    }
                    if (
                        operationId === undefined ||
                        !(await runOperationIsAuthoritative(
                            run.id,
                            operationId,
                        ))
                    ) {
                        throw error;
                    }
                    if (
                        resultToPreserveOnError !== undefined &&
                        !resultToPreserveOnError.review.accepted
                    ) {
                        const failedRunWithResult: Run = { ...run };
                        markRunAfterExecutionResult(
                            failedRunWithResult,
                            resultToPreserveOnError,
                            {
                                workspaceRolledBack:
                                    preservedResultWorkspaceRolledBack,
                            },
                        );
                        delete failedRunWithResult.operationId;
                        await runRepository.saveResult(
                            run.id,
                            scopeResultToOperation(
                                resultToPreserveOnError,
                                operationId,
                            ),
                        );
                        await assertRunOperationAuthority(run.id, operationId);
                        await runRepository.save(failedRunWithResult);
                        throw error;
                    }
                    const failedRun: Run = { ...run };
                    // Establish a safe terminal state synchronously first. The
                    // draft inspection below can then refine this to
                    // waiting_for_human without risking a permanently-running
                    // task if inspection itself fails.
                    markRunAfterExecutionError(failedRun, error);
                    if (executionAttemptStarted) {
                        try {
                            await markRunAfterDraftExecutionError(
                                failedRun,
                                workspaceRoot,
                                error,
                                findLatestVersion(versionsBeforeExecution),
                                workspaceFingerprintBeforeExecution,
                            );
                        } catch {
                            // Keep the failed fallback produced above. The original
                            // execution error remains the meaningful failure cause.
                        }
                    }
                    if (
                        !(await runOperationIsAuthoritative(
                            run.id,
                            operationId,
                        ))
                    ) {
                        throw error;
                    }
                    delete failedRun.operationId;
                    await runRepository.saveResult(
                        run.id,
                        scopeResultToOperation(
                            createDraftExecutionErrorResult({
                                run: failedRun,
                                workspaceRoot,
                                goal: executionContract,
                            }),
                            operationId,
                        ),
                    );
                    await assertRunOperationAuthority(run.id, operationId);
                    await runRepository.save(failedRun);
                    throw error;
                }
            };

            if (input.data.background) {
                try {
                    const wasQueued = run.status === "queued";
                    run.status = "running";
                    run.operation =
                        input.data.resetWorkspace === false ||
                        (input.data.resetWorkspace === undefined &&
                            !wasQueued)
                        ? "retry"
                        : "initial_generation";
                    run.operationId = randomUUID();
                    startRunOperationProgress(run);
                    await runRepository.save(run);
                    executionLease.signal.throwIfAborted();
                    void runManagedOperation({
                        lease: executionLease,
                        runId: run.id,
                        operationId: run.operationId,
                        task: (signal) => performExecution(signal, false),
                    })
                        .catch(() => undefined);
                } catch (error) {
                    executionLease.release();
                    throw error;
                }

                return reply.status(202).send({ run });
            }

            try {
                return reply.send(
                    await runManagedOperation({
                        lease: executionLease,
                        runId: run.id,
                        operationId: () => run.operationId,
                        task: (signal) => performExecution(signal),
                    }),
                );
            } catch (error) {
                if (isRunExecutionAbortError(error)) {
                    return reply.status(409).send({
                        error: "Run execution stopped",
                        message: formatRunErrorMessage(error),
                    });
                }
                return reply.status(500).send({
                    error: "Run execution failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown execution error",
                });
            }
        },
    );

    app.post<{Params:{ id:string}}>(
        "/runs/:id/approve",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (run.status !== "waiting_for_human") {
                return reply.status(409).send({
                    error: "Run is not waiting for human review",
                });
            }

            const result = await runRepository.findResultByRunId(run.id);
            const approvedGoal = run.operationPrompt ?? run.goal;

            run.status = "succeeded";
            cleanSucceededRunState(run);
            await runRepository.save(run);

            if (result) {
                await saveNextRunVersion({
                    run,
                    goal: approvedGoal,
                    summaryForVersion: (versionNumber) =>
                        `Human-approved version ${versionNumber}`,
                    review: {
                        ...result.review,
                        accepted: true,
                        reason: `Human approved after automated review: ${result.review.reason}`,
                    },
                });
            }

            return reply.send({
                run,
                versions: await runRepository.listVersions(run.id),
            });
        },
    );

    app.post<{Params:{ id:string}}>(
        "/runs/:id/request-repair",
        async (request, reply) => {
            const body = RepairRequestSchema.safeParse(request.body);

            if (!body.success) {
                return reply.status(400).send({
                    error: "Invalid repair request input",
                });
            }

            if (containsLikelyMojibake(body.data.feedback)) {
                return reply.status(400).send({
                    error: "Repair feedback appears to be garbled text",
                    message: "Please re-enter the repair feedback using UTF-8 text.",
                });
            }

            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (run.status !== "waiting_for_human") {
                return reply.status(409).send({
                    error: "Run is not waiting for human review",
                });
            }

            if (!executeRun) {
                return reply.status(501).send({
                    error: "Run execution is not configured",
                });
            }
            const pendingRequestBeforeRepair = run.operationPrompt?.trim();
            const repairFeedback = body.data.feedback.trim();
            const versionsBeforeRepair =
                await runRepository.listVersions(run.id);
            const latestSavedVersionBeforeRepair =
                findLatestVersion(versionsBeforeRepair);
            const repairContract = resolveExecutionContract({
                initialGoal: run.goal,
                versions: versionsBeforeRepair,
                pendingRequest: pendingRequestBeforeRepair,
                currentRequest: repairFeedback,
            });
            const workspaceRoot = workspaceManager.resolve(run.id);
            const continuationPreparation =
                await prepareContinuationWorkspace({
                    workspaceRoot,
                    versions: versionsBeforeRepair,
                });
            const workspaceFingerprintBeforeRepair =
                await createUserVisibleWorkspaceFingerprint(workspaceRoot);
            const hasRecoveryBaseline =
                await workspaceHasRunnableApplication(workspaceRoot);

            const performRepair = async (signal: AbortSignal): Promise<{
                run: Run;
                result: RunReactAppAgentResult;
                versions: RunVersion[];
            }> => {
                const operationId = run.operationId;

                if (operationId === undefined) {
                    throw new Error("Run repair has no operation id");
                }

                signal.throwIfAborted();
                try {
                const repairGoal = [
                    repairContract,
                    "Continuation repair request:",
                    continuationPreparation.resetWorkspace
                        ? "No runnable workspace draft is available, so rebuild from the starter and the complete requirement contract."
                        : "Start from the current workspace draft shown in preview.",
                    "Apply the newest human feedback below as the highest-priority required change.",
                    ...(pendingRequestBeforeRepair
                        ? [
                            `Previous human-review context, keep only if still relevant:\n${pendingRequestBeforeRepair}`,
                        ]
                        : []),
                    `Newest human feedback to apply now:\n${repairFeedback}`,
                ].join("\n\n");
                const executeRunInput: Parameters<ExecuteRun>[0] = {
                    goal: repairGoal,
                    currentRequest: repairFeedback,
                    workspaceRoot,
                    resetWorkspace: continuationPreparation.resetWorkspace,
                    signal,
                };
                if (operationId) {
                    executeRunInput.onProgress =
                        createPersistedOperationProgressReporter({
                            runRepository,
                            runId: run.id,
                            operationId,
                        });
                }
                const latestDesignPlan = await loadLatestDesignPlan(run);
                if (latestDesignPlan) {
                    executeRunInput.designPlan = latestDesignPlan;
                }
                const memoryContext =
                    await buildExecutionMemoryContext(repairGoal);
                signal.throwIfAborted();

                if (memoryContext.length > 0) {
                    executeRunInput.memoryContext = memoryContext;
                }

                const result = await executeWithWorkspaceRollback({
                    workspaceRoot: executeRunInput.workspaceRoot,
                    preserveWorkspaceOnError: (error) =>
                        !hasRecoveryBaseline &&
                        !isRunExecutionAbortError(error),
                    execute: async () => {
                        const executionResult =
                            await executeRun(executeRunInput);
                        signal.throwIfAborted();
                        const workspaceFingerprintAfterRepair =
                            await createUserVisibleWorkspaceFingerprint(
                                workspaceRoot,
                            );
                        let validatedResult = executionResult;

                        if (
                            workspaceFingerprintEquals(
                                workspaceFingerprintBeforeRepair,
                                workspaceFingerprintAfterRepair,
                            )
                        ) {
                            validatedResult =
                                rejectUnchangedCurrentDraft(executionResult);
                        } else if (
                            latestSavedVersionBeforeRepair &&
                            await safeUserVisibleWorkspaceMatchesVersion({
                                workspaceRoot,
                                version: latestSavedVersionBeforeRepair,
                            })
                        ) {
                            validatedResult =
                                rejectUnchangedWorkspace(executionResult);
                        }

                        return validatedResult;
                    },
                    rollbackWhen: (validatedResult) => {
                        signal.throwIfAborted();
                        return (
                            hasRecoveryBaseline &&
                            !validatedResult.review.accepted
                        );
                    },
                });
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);
                const completedRun: Run = { ...run };
                const workspaceRolledBack =
                    hasRecoveryBaseline && !result.review.accepted;
                const outcome = markRunAfterExecutionResult(completedRun, result, {
                    workspaceRolledBack,
                });
                if (workspaceRolledBack) {
                    if (pendingRequestBeforeRepair) {
                        completedRun.operationPrompt = pendingRequestBeforeRepair;
                    } else {
                        delete completedRun.operationPrompt;
                    }
                }
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.saveResult(
                    run.id,
                    scopeResultToOperation(result, operationId),
                );
                delete completedRun.operationId;
                await assertRunOperationAuthority(run.id, operationId);
                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: repairContract,
                    outcome,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);

                if (result.review.accepted) {
                    try {
                        await saveNextRunVersion({
                            run: completedRun,
                            goal: repairFeedback,
                            summaryForVersion: (versionNumber) =>
                                `Repair version ${versionNumber}`,
                            review: result.review,
                            designPlan: result.designPlan,
                            designPlanSource: result.designPlanSource,
                            signal,
                            operationId,
                        });
                    } catch (error) {
                        await preserveValidatedResultAfterVersionSaveFailure({
                            run: completedRun,
                            operationId,
                            error,
                            signal,
                            pendingRequest: repairFeedback,
                        });
                        throw error;
                    }
                }
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.save(completedRun);
                signal.throwIfAborted();
                return {
                    run: completedRun,
                    result,
                    versions: await runRepository.listVersions(run.id),
                };
                } catch (error) {
                if (shouldPreserveCancelledRunState(signal)) {
                    throw error;
                }
                if (
                    !(await runOperationIsAuthoritative(
                        run.id,
                        operationId,
                    ))
                ) {
                    throw error;
                }
                const failedRun: Run = { ...run };
                await markRunAfterDraftExecutionError(
                    failedRun,
                    workspaceRoot,
                    error,
                    latestSavedVersionBeforeRepair,
                    workspaceFingerprintBeforeRepair,
                );
                if (
                    !(await runOperationIsAuthoritative(
                        run.id,
                        operationId,
                    ))
                ) {
                    throw error;
                }
                await runRepository.saveResult(
                    run.id,
                    scopeResultToOperation(
                        createDraftExecutionErrorResult({
                            run: failedRun,
                            workspaceRoot,
                            goal: repairContract,
                        }),
                        operationId,
                    ),
                );
                delete failedRun.operationId;
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.save(failedRun);
                throw error;
                }
            };

            const executionLease = runExecutionManager.tryAcquire(run.id);

            if (!executionLease) {
                return reply.status(409).send({
                    error: "Run is already executing",
                });
            }

            run.status = "repairing";
            run.operation = "repair";
            run.operationId = randomUUID();
            startRunOperationProgress(run, "repairing");
            run.operationPrompt = repairFeedback;
            try {
                await runRepository.save(run);
                executionLease.signal.throwIfAborted();
            } catch (error) {
                executionLease.release();
                throw error;
            }

            if (body.data.background) {
                void runManagedOperation({
                    lease: executionLease,
                    runId: run.id,
                    operationId: run.operationId,
                    task: (signal) => performRepair(signal),
                })
                    .catch(() => undefined);

                return reply.status(202).send({ run });
            }

            try {
                return reply.send(
                    await runManagedOperation({
                        lease: executionLease,
                        runId: run.id,
                        operationId: () => run.operationId,
                        task: (signal) => performRepair(signal),
                    }),
                );
            } catch (error) {
                if (isRunExecutionAbortError(error)) {
                    return reply.status(409).send({
                        error: "Run execution stopped",
                        message: formatRunErrorMessage(error),
                    });
                }
                return reply.status(500).send({
                    error: "Run repair failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown repair error",
                });
            }
        },
    );
    app.post<{ Params:{ id:string } }>(
        "/runs/:id/iterate",
        async (request,reply)=>{
            const body = IterateRunInputSchema.safeParse(request.body);
            if(!body.success){
                return reply.status(400).send({
                    error: "Invalid iterate run input",
                });
            }

            if (containsLikelyMojibake(body.data.prompt)) {
                return reply.status(400).send({
                    error: "Iteration prompt appears to be garbled text",
                    message: "Please re-enter the iteration prompt using UTF-8 text.",
                });
            }

            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (run.status === "waiting_for_human") {
                return reply.status(409).send({
                    error:
                        "Run is waiting for human review. Approve it or use request-repair.",
                });
            }

            if (isActiveRunStatus(run.status)) {
                return reply.status(409).send({
                    error: "Run is already executing",
                });
            }

            if(!executeRun) {
                return reply.status(501).send({
                    error: "Run execution is not configured",
                });
            }
            // A new iteration is a new explicit request. Prompts from failed
            // or cancelled operations remain available to /execute retry, but
            // must not silently become requirements of a different iteration.
            const pendingRequestBeforeIteration = undefined;
            const performIteration = async (signal: AbortSignal): Promise<{
                run: Run;
                result: RunReactAppAgentResult;
                versions: RunVersion[];
            }> => {
                const operationId = run.operationId;

                if (operationId === undefined) {
                    throw new Error("Run iteration has no operation id");
                }

                signal.throwIfAborted();
                let comparisonVersion: RunVersion | undefined;
                let workspaceFingerprintBeforeIteration:
                    | WorkspaceFingerprint
                    | undefined;
                let iterationContract: string | undefined;

                try{
                const existingVersionsBeforeIteration =
                    await runRepository.listVersions(run.id);
                const existingResult =
                    await runRepository.findResultByRunId(run.id);

                if (
                    existingVersionsBeforeIteration.length === 0 &&
                    existingResult?.review.accepted
                ) {
                    await saveNextRunVersion({
                        run,
                        goal: run.goal,
                        summaryForVersion: () => "Initial generated version",
                        review: existingResult.review,
                        designPlan: existingResult.designPlan,
                        designPlanSource: existingResult.designPlanSource,
                        signal,
                        operationId,
                    });
                }

                comparisonVersion = findLatestVersion(
                    await runRepository.listVersions(run.id),
                );
                const versionsForContract =
                    await runRepository.listVersions(run.id);
                const workspaceRoot = workspaceManager.resolve(run.id);
                const continuationPreparation =
                    await prepareContinuationWorkspace({
                        workspaceRoot,
                        versions: versionsForContract,
                    });
                workspaceFingerprintBeforeIteration =
                    await createUserVisibleWorkspaceFingerprint(workspaceRoot);
                const hasRecoveryBaseline =
                    await workspaceHasRunnableApplication(workspaceRoot);
                const resetWorkspaceForIteration =
                    isRegenerationPrompt(body.data.prompt);
                const previousExecutionProducedDraft =
                    existingResult !== undefined &&
                    hasWorkspaceChangingAction(existingResult);
                const hasNoGeneratedBaseline =
                    versionsForContract.length === 0 &&
                    !previousExecutionProducedDraft;
                iterationContract = resolveExecutionContract({
                    initialGoal: run.goal,
                    versions: versionsForContract,
                    pendingRequest: pendingRequestBeforeIteration,
                    currentRequest: body.data.prompt,
                });
                const executeRunInput: Parameters<ExecuteRun>[0] = {
                    goal: iterationContract,
                    currentRequest: body.data.prompt,
                    workspaceRoot,
                    resetWorkspace:
                        resetWorkspaceForIteration ||
                        continuationPreparation.resetWorkspace ||
                        hasNoGeneratedBaseline,
                    signal,
                };
                if (operationId) {
                    executeRunInput.onProgress =
                        createPersistedOperationProgressReporter({
                            runRepository,
                            runId: run.id,
                            operationId,
                        });
                }
                const latestDesignPlan = await loadLatestDesignPlan(run);
                if (latestDesignPlan) {
                    executeRunInput.designPlan = latestDesignPlan;
                }
                const memoryContext =
                    await buildExecutionMemoryContext(iterationContract);
                signal.throwIfAborted();

                if (memoryContext.length > 0) {
                    executeRunInput.memoryContext = memoryContext;
                }

                const result = await executeWithWorkspaceRollback({
                    workspaceRoot: executeRunInput.workspaceRoot,
                    preserveWorkspaceOnError: (error) =>
                        !hasRecoveryBaseline &&
                        !isRunExecutionAbortError(error),
                    execute: async () => {
                        const executionResult =
                            await executeRun(executeRunInput);
                        signal.throwIfAborted();
                        const workspaceFingerprintAfterIteration =
                            await createUserVisibleWorkspaceFingerprint(
                                workspaceRoot,
                            );
                        let validatedResult = requireIterationChange(
                            executionResult,
                            workspaceFingerprintBeforeIteration !== undefined &&
                                !workspaceFingerprintEquals(
                                    workspaceFingerprintBeforeIteration,
                                    workspaceFingerprintAfterIteration,
                                ),
                        );

                        if (
                            comparisonVersion &&
                            await safeUserVisibleWorkspaceMatchesVersion({
                                workspaceRoot,
                                version: comparisonVersion,
                            })
                        ) {
                            validatedResult =
                                rejectUnchangedIteration(validatedResult);
                        }

                        return validatedResult;
                    },
                    rollbackWhen: (validatedResult) => {
                        signal.throwIfAborted();
                        return (
                            hasRecoveryBaseline &&
                            !validatedResult.review.accepted
                        );
                    },
                });
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);
                const completedRun: Run = { ...run };
                const outcome = markRunAfterExecutionResult(completedRun, result, {
                    workspaceRolledBack:
                        hasRecoveryBaseline && !result.review.accepted,
                });
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.saveResult(
                    run.id,
                    scopeResultToOperation(result, operationId),
                );
                delete completedRun.operationId;

                await assertRunOperationAuthority(run.id, operationId);
                await memoryRepository.save({
                    id: randomUUID(),
                    runId: run.id,
                    goal: iterationContract,
                    outcome,
                    summary: summarizeRunMemory(result),
                    createdAt: new Date().toISOString(),
                });
                await maybeCompactMemory(memoryRepository);

                if (result.review.accepted) {
                    try {
                        await saveNextRunVersion({
                            run: completedRun,
                            goal: body.data.prompt,
                            summaryForVersion: (versionNumber) =>
                                `Iteration version ${versionNumber}`,
                            review: result.review,
                            designPlan: result.designPlan,
                            designPlanSource: result.designPlanSource,
                            signal,
                            operationId,
                        });
                    } catch (error) {
                        await preserveValidatedResultAfterVersionSaveFailure({
                            run: completedRun,
                            operationId,
                            error,
                            signal,
                            pendingRequest: body.data.prompt,
                        });
                        throw error;
                    }
                }
                signal.throwIfAborted();
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.save(completedRun);
                signal.throwIfAborted();
                return {
                    run: completedRun,
                    result,
                    versions: await runRepository.listVersions(run.id),
                };
            }
            catch (error){
                if (shouldPreserveCancelledRunState(signal)) {
                    throw error;
                }
                if (
                    !(await runOperationIsAuthoritative(
                        run.id,
                        operationId,
                    ))
                ) {
                    throw error;
                }
                const failedRun: Run = { ...run };
                await markRunAfterDraftExecutionError(
                    failedRun,
                    workspaceManager.resolve(run.id),
                    error,
                    comparisonVersion,
                    workspaceFingerprintBeforeIteration,
                );
                if (
                    !(await runOperationIsAuthoritative(
                        run.id,
                        operationId,
                    ))
                ) {
                    throw error;
                }
                await runRepository.saveResult(
                    run.id,
                    scopeResultToOperation(
                        createDraftExecutionErrorResult({
                            run: failedRun,
                            workspaceRoot: workspaceManager.resolve(run.id),
                            goal: iterationContract,
                        }),
                        operationId,
                    ),
                );
                delete failedRun.operationId;
                await assertRunOperationAuthority(run.id, operationId);
                await runRepository.save(failedRun);
                throw error;
            }
            };

            const executionLease = runExecutionManager.tryAcquire(run.id);

            if (!executionLease) {
                return reply.status(409).send({
                    error: "Run is already executing",
                });
            }

            run.status = "running";
            run.operation = "iteration";
            run.operationId = randomUUID();
            startRunOperationProgress(run);
            run.operationPrompt = body.data.prompt;
            try {
                await runRepository.save(run);
                executionLease.signal.throwIfAborted();
            } catch (error) {
                executionLease.release();
                throw error;
            }

            if (body.data.background) {
                void runManagedOperation({
                    lease: executionLease,
                    runId: run.id,
                    operationId: run.operationId,
                    task: (signal) => performIteration(signal),
                })
                    .catch(() => undefined);

                return reply.status(202).send({ run });
            }

            try {
                return reply.send(
                    await runManagedOperation({
                        lease: executionLease,
                        runId: run.id,
                        operationId: () => run.operationId,
                        task: (signal) => performIteration(signal),
                    }),
                );
            } catch (error) {
                if (isRunExecutionAbortError(error)) {
                    return reply.status(409).send({
                        error: "Run execution stopped",
                        message: formatRunErrorMessage(error),
                    });
                }
                return reply.status(500).send({
                    error: "Run iteration failed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unknown iteration error",
                });
            }
        },
    );
    app.get<{Params:{ id:string }}>(
        "/runs/:id/coordination",
        async (request,reply)=>{
            const run = await runRepository.findById(request.params.id);
            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }
            return reply.send(
                coordinateAgents({
                    goal:run.goal,
                }),
            );
        },
    );

    app.post<{ Params: { id: string } }>(
        "/runs/:id/cancel",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            const isManagedExecution = runExecutionManager.isRunning(run.id);
            const operationId = run.operationId;
            const operationPrompt = run.operationPrompt;

            if (!isManagedExecution && !isActiveRunStatus(run.status)) {
                return reply.status(409).send({
                    error: "Run is not executing",
                });
            }

            if (isManagedExecution) {
                runExecutionManager.cancel(
                    run.id,
                    new RunExecutionCancelledError(
                        "Run execution was cancelled by the user",
                    ),
                );
                await runExecutionManager.waitForRun(run.id);
            }

            const latestRun =
                await runRepository.findById(run.id) ?? run;
            latestRun.status = "cancelled";
            delete latestRun.operation;
            if (operationId !== undefined) {
                latestRun.operationId = operationId;
            }
            clearRunOperationProgress(latestRun);
            if (operationPrompt !== undefined) {
                latestRun.operationPrompt = operationPrompt;
            }
            latestRun.errorMessage =
                "Run execution was cancelled by the user.";
            await runRepository.save(latestRun);

            return reply.send({
                run: latestRun,
            });
        },
    );

    app.delete<{ Params: { id: string } }>(
        "/runs/:id",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            if (runExecutionManager.isRunning(run.id)) {
                return reply.status(409).send({
                    error: "Cannot delete a run while it is executing",
                });
            }

            await previewManager.stopRun(run.id);
            await runRepository.deleteById(run.id);
            await removeWorkspaceWhenAvailable(workspaceManager.resolve(run.id));

            return reply.status(204).send();
        },
    );


    app.get<{ Params:{ id: string }}>(
        "/runs/:id",
        async(request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if(!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            const result = await loadRunResult(run);
            await saveRunIfChanged(
                runRepository,
                run,
                cleanPersistedRunState(run),
            );

            return reply.send({
                run,
                ...(result ? { result } : {}),
                versions: await runRepository.listVersions(run.id),
            });
        },);
    app.get<{ Params: { id: string } }>(
        "/runs/:id/report",
        async (request, reply) => {
            const run = await runRepository.findById(request.params.id);

            if (!run) {
                return reply.status(404).send({
                    error: "Run not found",
                });
            }

            const result = await loadRunResult(run);
            const versions = await runRepository.listVersions(run.id);
            const files = await listReportFiles(workspaceManager.resolve(run.id));
            const memory = (await memoryRepository.list()).filter(
                (entry) => entry.runId === run.id,
            );

            return reply.send(
                buildRunReport({
                    run,
                    ...(result ? { result } : {}),
                    versions,
                    files,
                    memory,
                }),
            );
        },
    );
    app.get<{
        Params: { id: string };
        Querystring: { directory?: string; path?: string };
    }>("/runs/:id/files", async (request, reply) => {
        const run = await runRepository.findById(request.params.id);

        if (!run) {
            return reply.status(404).send({
                error: "Run not found",
            });
        }

        try {
            if (!request.query.path) {
                const directory = request.query.directory ?? ".";
                const files = await listWorkspaceFiles(
                    workspaceManager.resolve(run.id),
                    directory,
                );

                return reply.send({
                    directory,
                    files,
                });
            }

            const content = await readWorkspaceFile(
                workspaceManager.resolve(run.id),
                request.query.path,
            );

            return reply.send({
                path: request.query.path,
                content,
            });
        } catch (error) {
            if (error instanceof Error && error.message === "Path escapes workspace root") {
                return reply.status(400).send({
                    error: "Invalid file path",
                });
            }

            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return reply.status(404).send({
                    error: "File not found",
                });
            }

            throw error;
        }
    });
    app.get<{
        Params:{
            id:string;
            versionNumber:string;
        };
        Querystring:{
          path:string;
        };
    }>(
        "/runs/:id/versions/:versionNumber/files",
        async(request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if(!run){
                return reply.status(404).send({
                    error:"Run not found",
                });
            }
            const versionNumber = Number(request.params.versionNumber);

            if (!Number.isInteger(versionNumber)||versionNumber<1){
                return reply.status(400).send({
                    error: "Invalid version number",
                });
            }
            const versions = await runRepository.listVersions(run.id);
            const version = versions.find(
                (candidate) => candidate.versionNumber === versionNumber,
            );
            const snapshotRoot = path.join(
              workspaceManager.resolve(run.id),
                "versions",
                version
                    ? getRunVersionSnapshotDirectoryName(version)
                    : `v${versionNumber}`,
            );
            const content = await  readWorkspaceFile(
                snapshotRoot,
                request.query.path,
            );
            return reply.send({
                path: request.query.path,
                content,
            });
        },
    );
    app.delete<{
        Params: {
            id: string;
            versionNumber: string;
        };
    }>("/runs/:id/versions/:versionNumber", async (request, reply) => {
        const run = await runRepository.findById(request.params.id);

        if (!run) {
            return reply.status(404).send({
                error: "Run not found",
            });
        }

        if (run.status === "running" || run.status === "repairing") {
            return reply.status(409).send({
                error: "Cannot delete versions while the agent is running",
            });
        }

        const versionNumber = Number(request.params.versionNumber);

        if (!Number.isInteger(versionNumber) || versionNumber < 1) {
            return reply.status(400).send({
                error: "Invalid version number",
            });
        }

        const versions = await runRepository.listVersions(run.id);
        const versionToDelete = versions.find(
            (version) => version.versionNumber === versionNumber,
        );

        if (!versionToDelete) {
            return reply.status(404).send({
                error: "Version not found",
            });
        }

        const remainingVersions = versions
            .filter((version) => version.id !== versionToDelete.id)
            .sort((left, right) => left.versionNumber - right.versionNumber);
        const reindexedVersions = remainingVersions.map((version, index) => ({
            ...version,
            versionNumber: index + 1,
            snapshotId:
                version.snapshotId ?? `v${version.versionNumber}`,
        }));

        await previewManager.stopRun(run.id);
        await deleteRunVersionSnapshot({
            workspaceRoot: workspaceManager.resolve(run.id),
            versionNumber: versionToDelete.versionNumber,
            snapshotId: versionToDelete.snapshotId,
        });
        await runRepository.replaceVersions(run.id, reindexedVersions);

        return reply.send({
            versions: reindexedVersions,
        });
    });
    app.post<{
        Params: {
            id: string;
            versionNumber: string;
        };
    }>("/runs/:id/versions/:versionNumber/continue", async (request, reply) => {
        const run = await runRepository.findById(request.params.id);

        if (!run) {
            return reply.status(404).send({
                error: "Run not found",
            });
        }

        if (run.status === "running" || run.status === "repairing") {
            return reply.status(409).send({
                error: "Cannot restore a version while the agent is running",
            });
        }

        const versionNumber = Number(request.params.versionNumber);
        const version = (await runRepository.listVersions(run.id)).find(
            (candidate) => candidate.versionNumber === versionNumber,
        );

        if (!version) {
            return reply.status(404).send({
                error: "Version not found",
            });
        }

        await previewManager.stopRun(run.id);
        await restoreRunVersionSnapshot({
            workspaceRoot: workspaceManager.resolve(run.id),
            versionNumber: version.versionNumber,
            snapshotId: version.snapshotId,
        });
        run.status = "succeeded";
        delete run.operation;
        delete run.operationId;
        clearRunOperationProgress(run);
        delete run.operationPrompt;
        delete run.errorMessage;
        await runRepository.save(run);
        await runRepository.saveResult(
            run.id,
            createVersionRestoreResult(
                workspaceManager.resolve(run.id),
                version,
            ),
        );

        return reply.send({
            run,
            version,
            versions: await runRepository.listVersions(run.id),
        });
    });
    app.post<{Params:{ id: string}}>(
        "/runs/:id/preview",
        async (request,reply)=>{
            const run = await runRepository.findById(request.params.id);

            if (!run){
                return reply.status(404).send({
                    error: "Run not found",
                });
            }
            const input = PreviewRunInputSchema.safeParse(request.body??{});
            if (!input.success) {
                return reply.status(400).send({
                    error: "Invalid preview input",
                });
            }
            let preview;
            let browserEval;
            let previewWorkspaceRoot = workspaceManager.resolve(run.id);
            const versions = await runRepository.listVersions(run.id);
            let previewGoal = resolveExecutionContract({
                initialGoal: run.goal,
                versions,
                pendingRequest: run.operationPrompt,
            });

            if (input.data.versionNumber !== undefined) {
                const version = versions.find(
                    (candidate) =>
                        candidate.versionNumber === input.data.versionNumber,
                );

                if (!version) {
                    return reply.status(404).send({
                        error: "Version not found",
                    });
                }

                previewGoal = version.goal;

                previewWorkspaceRoot = path.join(
                    workspaceManager.resolve(run.id),
                    "versions",
                    getRunVersionSnapshotDirectoryName(version),
                );

                try {
                    await access(previewWorkspaceRoot);
                } catch {
                    return reply.status(404).send({
                        error: "Version snapshot not found",
                    });
                }
            }

            try {
                preview = await previewManager.start({
                    runId:run.id,
                    workspaceRoot: previewWorkspaceRoot,
                });
                browserEval = await browserEvaluator.evaluate({
                    url: preview.url,
                    goal: previewGoal,
                });
            } catch (error) {
                return reply.status(503).send({
                    error: "Preview is unavailable",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Preview server could not start",
                });
            }

            return reply.send({
                preview,
                browserEval,
            });
        },
    );
    return app;
}
