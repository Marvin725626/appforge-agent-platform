import { useEffect, useRef, useState } from "react";

type Run = {
    id: string;
    goal: string;
    status: string;
    operation?: "initial_generation" | "iteration" | "repair" | "retry";
    operationStage?:
        | "preparing"
        | "planning"
        | "coding"
        | "installing"
        | "building"
        | "evaluating"
        | "reviewing"
        | "repairing";
    operationStartedAt?: string;
    operationUpdatedAt?: string;
    operationPrompt?: string;
    errorMessage?: string;
    latestVersion?: RunVersion;
    createdAt: string;
};

type AgentStep = {
    action: {
        type: string;
        outputPath?: string;
        query?: string;
        mode?: string;
        altText?: string;
    };
    execution: {
        ok: boolean;
        message: string;
        changed?: boolean;
    };
};

type AgentResult = {
    steps: AgentStep[];
    finished: boolean;
    stopReason?: string;
    errorMessage?: string;
};

type CommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

type AgentReview = {
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

type EvalCheck = {
    name: string;
    passed: boolean;
};

type ReactAppEvalResult = {
    passed: boolean;
    checks: EvalCheck[];
};

type BrowserCheck = {
    name: string;
    passed: boolean;
    message?: string;
};

type VisualViewportMetrics = {
    pageOverflowPx: number;
    criticalOverlapCount: number;
    clippedElementCount: number;
    lowContrastCount: number;
    contrastSampleCount: number;
    undersizedControlCount: number;
    controlCount: number;
    tinyTextCount: number;
    textSampleCount: number;
    minimumFontSizePx?: number;
};

type VisualViewportResult = {
    viewport: {
        id: "mobile" | "tablet" | "desktop" | "wide";
        width: number;
        height: number;
    };
    passed: boolean;
    metrics: VisualViewportMetrics;
    screenshotPath?: string;
};

type BrowserEvalResult = {
    passed: boolean;
    checks: BrowserCheck[];
    visualReport?: {
        passed: boolean;
        viewports: VisualViewportResult[];
    };
};

type AgentAttempt = {
    kind: "initial" | "repair";
    agent: AgentResult;
    install: CommandResult;
    build: CommandResult;
    eval: ReactAppEvalResult;
    browserEval?: BrowserEvalResult;
    review: AgentReview;
    parallelWorkstreams?: ParallelCodingWorkstream[];
    metrics?: RunMetrics;
};

type ParallelCodingWorkstream = {
    id: string;
    role: "page";
    path: string;
    routePath: string;
    label: string;
    status: "pending" | "running" | "succeeded" | "fallback" | "failed";
    generationAttempts: number;
    summary: string;
    errorMessage?: string;
};

type TraceEvent = {
    id: string;
    label: string;
    status: "pending" | "running" | "succeeded" | "failed";
    message?: string;
    createdAt: string;
};

type ReactAppAgentResult = {
    agent: AgentResult;
    install: CommandResult;
    build: CommandResult;
    eval?: ReactAppEvalResult;
    review?: AgentReview;
    attempts?: AgentAttempt[];
    trace?: TraceEvent[];
    coordination?: CoordinationResponse;
    browserEval?: BrowserEvalResult;
    metrics?: RunMetrics;
    requirements?: RequirementResult[];
    workspaceDiff?: WorkspaceDiff;
    designPlan?: DesignPlan;
    designPlanSource?: "planner" | "preserved" | "fallback";
    designPlanCompliance?: DesignPlanCompliance[];
    focusedEditScope?: FocusedEditScope;
    scopeViolations?: ScopeViolation[];
    executionMode?: "fast_edit" | "structural_edit";
};

type DesignPlan = {
    version: 1;
    applicationType: string;
    designIntent: {
        audience: string;
        primaryGoal: string;
        emotionalTone: string[];
        brandTraits: string[];
    };
    informationArchitecture: {
        routes: Array<{
            path: string;
            purpose: string;
            primaryContent: string[];
            primaryActions: string[];
        }>;
    };
    visualDNA: {
        composition: string;
        density: "low" | "medium" | "high";
        surfaceStrategy: "open" | "mixed" | "contained";
        navigationPattern: string;
        heroPattern: string;
        sectionRhythm: string[];
        typographyCharacter: string;
        shapeLanguage: string;
        mediaStrategy: string;
        uniqueMotifs: string[];
        forbiddenPatterns: string[];
    };
    designTokens: {
        colorRoles: Record<string, string>;
        radiusScale: number[];
        spacingScale: number[];
    };
    acceptanceCriteria: Array<{
        id: string;
        instruction: string;
        verification: string;
    }>;
};

type DesignPlanCompliance = {
    criterion: string;
    status: "PASS" | "FAIL" | "UNVERIFIED";
    evidence: string;
};

type WorkspaceDiff = {
    addedFiles: string[];
    deletedFiles: string[];
    modifiedFiles: string[];
    unchangedFiles: string[];
    changedRanges: Array<{
        file: string;
        beforeStartLine: number;
        beforeEndLine: number;
        afterStartLine: number;
        afterEndLine: number;
    }>;
};

type FocusedEditScope = {
    intent:
        | "text"
        | "color"
        | "spacing"
        | "size"
        | "position"
        | "visibility"
        | "delete"
        | "responsive"
        | "asset"
        | "interaction";
    allowedFiles: string[];
    allowedSelectorsOrComponents: string[];
    protectedFiles: string[];
    protectedSelectorsOrComponents: string[];
    allowedRanges: FocusedEditRange[];
    confidence: number;
};

type FocusedEditRange = {
    file: string;
    kind: "css_rule" | "component" | "jsx_element" | "text_range";
    symbol?: string;
    selector?: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
};

type ScopeViolation = {
    action: string;
    file: string;
    reason: string;
    attemptedRange?: {
        startOffset: number;
        endOffset: number;
    };
    allowedRanges: FocusedEditRange[];
};

type RunMetrics = {
    plannerCalls: number;
    designPlannerCalls?: number;
    codingCalls: number;
    reviewerCalls: number;
    retryCalls: number;
    fallbackPages: string[];
    plannerDurationMs: number;
    designPlannerDurationMs?: number;
    codingDurationMs: number;
    installDurationMs: number;
    buildDurationMs: number;
    evaluationDurationMs: number;
    reviewerDurationMs: number;
    totalDurationMs: number;
    modifiedFiles: string[];
    dependencyManifestChanged: boolean;
};

type RequirementResult = {
    id: string;
    instruction: string;
    priority: "must" | "should" | "must_preserve";
    target?: string;
    targetFiles?: string[];
    verification: string;
    status: "PASS" | "FAIL" | "UNVERIFIED";
    evidence: string;
    evidences: RequirementEvidence[];
    affectedFiles: string[];
    affectedSelectorsOrComponents: string[];
};

type RequirementEvidence = {
    source: "file_diff" | "browser" | "computed_style" | "build" | "manual" | "scope";
    file?: string;
    requirementId?: string;
    selector?: string;
    property?: string;
    before?: string;
    after?: string;
    expected?: string;
    actual?: string;
    unexpectedFiles?: string[];
    unexpectedSelectors?: string[];
    unexpectedRanges?: Array<{
        file: string;
        startLine: number;
        endLine: number;
    }>;
    beforeElement?: ElementSnapshot;
    afterElement?: ElementSnapshot;
};

type ElementSnapshot = {
    route: string;
    selector: string;
    viewport: {
        width: number;
        height: number;
    };
    exists: boolean;
    visible: boolean;
    text?: string;
    boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    computedStyles: Record<string, string>;
};

type ExecuteResponse = {
    run: Run;
    result: ReactAppAgentResult;
    versions:RunVersion[];
};

type ContinueVersionResponse = {
    run: Run;
    version: RunVersion;
    versions: RunVersion[];
};

type StartExecuteResponse = {
    run: Run;
};

type FileResponse = {
    path: string;
    content: string;
};

type FileListResponse = {
    directory: string;
    files: string[];
};

type PreviewSession = {
    runId: string;
    workspaceRoot: string;
    port: number;
    url: string;
};

type PreviewResponse = {
    preview: PreviewSession;
    browserEval?: BrowserEvalResult;
};

type PreviewStartTarget = {
    runId: string;
    versionNumber: number | null;
};

type RunDetailResponse = {
    run: Run;
    result?: ReactAppAgentResult;
    versions: RunVersion[];
};

type RunReport = {
    run: Run;
    generatedAt: string;
    statusLine: string;
    summary: {
        attempts: number;
        agentFinished?: boolean;
        buildExitCode?: number;
        evalPassed?: boolean;
        evalPassedChecks: number;
        evalTotalChecks: number;
        browserPassed?: boolean;
        browserPassedChecks: number;
        browserTotalChecks: number;
        reviewAccepted?: boolean;
        reviewReason?: string;
    };
    coordination?: {
        plan: string[];
        assignments: AgentAssignment[];
    };
    trace: TraceEvent[];
    versions: RunVersion[];
    files: string[];
    memory: {
        outcome: string;
        summary: string;
        createdAt: string;
    }[];
    narrative: string;
};

type RunsResponse = {
    runs:Run[];
};

type ErrorResponse = {
    error?: string;
    message?: string;
};
type AgentAssignment = {
    role: "planner" | "coder" | "reviewer";
    task: string;
};

type CoordinationResponse = {
    goal: string;
    plan:string[];
    assignments: AgentAssignment[];
};
type Language = "zh" | "en";
type ActivePanel = "overview" | "plan" | "trace" | "report" | "preview" | "files";

type RunVersion = {
    id: string;
    runId: string;
    versionNumber: number;
    goal: string;
    summary: string;
    review?: AgentReview;
    designPlan?: DesignPlan;
    designPlanSource?: "planner" | "preserved" | "fallback";
    createdAt: string;
};

type RunProgress = {
    value: number;
    label: string;
    detail: string;
    live?: boolean;
    elapsed?: string;
};

type ReviewDispositionView = {
    tone: "success" | "info" | "warning" | "danger";
    title: string;
    detail: string;
};


const CURRENT_RUN_ID_STORAGE_KEY = "appforge.currentRunId";
const PREVIEW_STORAGE_KEY = "appforge.preview";
const LANGUAGE_STORAGE_KEY = "appforge.language";
const API_BASE_URL = (
    import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const SHOW_DEV_PANELS = import.meta.env.VITE_SHOW_DEV_PANELS === "true";
const GENERATED_FILE_DIRECTORIES = ["src", "public/assets"];
const IMAGE_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
const WORKSPACE_CHANGE_ACTION_TYPES = new Set([
    "write_file",
    "edit_file",
    "append_file",
    "get_image",
]);
const TERMINAL_RUN_STATUSES_WITHOUT_OUTPUT = new Set([
    "failed",
    "waiting_for_human",
    "cancelled",
]);
const START_REQUEST_TIMEOUT_MS = 15_000;
const PREVIEW_START_REQUEST_TIMEOUT_MS = 60_000;
const RUN_POLL_REQUEST_TIMEOUT_MS = 10_000;
const RUN_WAIT_TIMEOUT_MS = 31 * 60 * 1_000;
const RUN_POLL_INTERVAL_MS = 1_500;
const MAX_CONSECUTIVE_RUN_POLL_FAILURES = 3;

function apiUrl(path: string): string {
    return `${API_BASE_URL}${path}`;
}

async function fetchWithTimeout(
    input: RequestInfo | URL,
    init?: RequestInit,
    timeoutMs = START_REQUEST_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
        controller.abort();
    }, timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(
                "Request timed out. Please check whether the API is still running.",
            );
        }

        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function isImageFilePath(filePath: string): boolean {
    const normalizedPath = filePath.toLowerCase();

    return IMAGE_FILE_EXTENSIONS.some((extension) =>
        normalizedPath.endsWith(extension),
    );
}

function getPreviewAssetUrl(
    preview: PreviewSession | null,
    filePath: string,
): string | undefined {
    if (!preview || !filePath.startsWith("public/")) {
        return undefined;
    }

    return `${preview.url.replace(/\/$/, "")}${filePath.slice("public".length)}`;
}

function parseImageExecutionMessage(message: string): {
    savedPath?: string;
    mediaType?: string;
    source?: string;
    attribution?: string;
    bytes?: string;
} {
    const result: {
        savedPath?: string;
        mediaType?: string;
        source?: string;
        attribution?: string;
        bytes?: string;
    } = {};

    for (const line of message.split("\n")) {
        const [label, ...rest] = line.split(":");
        const value = rest.join(":").trim();

        if (label === "Saved image") {
            result.savedPath = value;
        } else if (label === "Media type") {
            result.mediaType = value;
        } else if (label === "Source") {
            result.source = value;
        } else if (label === "Attribution") {
            result.attribution = value;
        } else if (label === "Bytes") {
            result.bytes = value;
        }
    }

    return result;
}

const UI_COPY = {
    zh: {
        navHome: "首页",
        navRuns: "任务",
        localDemo: "本地演示",
        languageToggle: "EN",
        heroBadge: "真实 LLM + 可追踪流程 + 自动修复闭环",
        heroTitleLine1: "用 Agent 构建应用。",
        heroTitleLine2: "看见每一步。",
        heroSubtitle:
            "AppForge 会创建隔离 workspace，调用真实 Coding Agent，执行构建和评估，自动修复失败，并展示 trace、文件、预览和报告。",
        advantageTrace: "可追踪 Agent 步骤",
        advantageEval: "构建 + 评估 Harness",
        advantageRepair: "自动修复闭环",
        promptLabel: "描述你想生成的应用",
        repairAttempts: "最大修复次数",
        creating: "创建中...",
        forgeApp: "开始生成 ->",
        recentRuns: "最近任务",
        openRunActions: "打开任务操作",
        deleting: "删除中...",
        delete: "删除",
        deleteVersionConfirm: "删除这个版本吗？后面的版本号会自动前移。",
        continueFromVersion: "从此版本继续",
        continueFromVersionConfirm:
            "将当前工作区恢复为这个版本，并以它为基线继续修改吗？未保存为正式版本的最新输出将被替换。",
        restoringVersion: "恢复中...",
        back: "返回",
        runWorkspace: "Run 工作台",
        buildConsole: "Agent 构建控制台",
        appWorkspace: "应用工作台",
        versionHistory: "版本历史",
        versionHelp: "Agent 构建或修复应用时会生成版本快照。",
        draftPreview: "当前草稿",
        draftPreviewBody:
            "中间预览显示的是当前 workspace 输出。只有评审通过或人工批准后，它才会保存成正式版本。",
        draftPreviewStatus: "未保存为版本",
        draftRunCreated: "草稿任务已创建",
        waitingFirstExecution: "等待第一次 Agent 执行",
        run: "任务",
        latest: "最新需求",
        currentRequest: "当前需求",
        latestSavedVersion: "最新保存版本",
        agentRunning: "Agent 执行中...",
        agentRepairing: "Agent 修复中...",
        executeRun: "执行任务",
        cancelRun: "停止任务",
        cancellingRun: "正在停止...",
        cancelRunConfirm: "停止当前 Agent 任务吗？本次未验收改动会回滚，已保存版本不会受影响。",
        cancelled: "已停止",
        cancelledHelp: "任务已停止，本次未验收改动已回滚。你可以预览稳定版本或带着当前需求重试。",
        completed: "已完成",
        needsReview: "需要审核",
        executionUnavailable: "无法执行",
        humanReview: "人工审核",
        humanReviewHelp: "请先查看中间的当前输出，再决定批准还是填写反馈请求修复。",
        pendingRepairRequest: "待修复需求",
        repairFeedback: "修复反馈",
        approve: "批准",
        repairing: "修复中...",
        requestRepair: "请求修复",
        livePreview: "实时预览",
        previewingVersion: "正在预览版本",
        previewingLatest: "正在预览最新输出",
        previewingDraft: "正在预览当前草稿，还没有保存为版本",
        noPreviewServer: "还没有预览服务",
        previewReady: "预览服务已就绪",
        starting: "启动中...",
        refreshPreview: "刷新预览",
        startPreview: "启动预览",
        generatedPreviewTitle: "生成应用预览",
        previewEmptyTitle: "预览会显示在这里",
        previewEmptyBody: "先执行任务，再启动预览服务查看生成应用。",
        noGeneratedOutput:
            "Agent 没有成功写入任何应用文件，因此没有可预览或审核的页面。",
        browserChecks: "浏览器检查",
        browserChecksHelp: "启动预览后，用真实浏览器验证页面行为。",
        passed: "通过",
        pass: "通过",
        fail: "失败",
        iterationPlaceholder: "描述下一次修改，例如：添加深色模式，或者优化布局...",
        iterationHelp: "基于当前最新版本继续修改。",
        iterationSubmitted: "修改请求已提交，Agent 正在后台处理。完成后这里会自动刷新。",
        iterationBlockedForHumanReview:
            "当前结果需要人工审核。请在左侧审核框里批准，或填写修复反馈。",
        iterating: "迭代中...",
        sendIteration: "发送修改",
        overview: "概览",
        plan: "计划",
        trace: "追踪",
        report: "报告",
        files: "文件",
        runSections: "任务面板",
        status: "状态",
        finished: "已结束",
        build: "构建",
        eval: "评估",
        browser: "浏览器",
        yes: "是",
        no: "否",
        checksPassed: "项通过",
        runDetailsPending: "Agent 执行后会显示任务详情。",
        runFailedNoResult:
            "这次执行中断了，但 workspace 可能已经留下部分代码，所以预览仍然可能显示草稿或残留输出。",
        failureReason: "失败原因",
        resultReady: "生成结果已准备好。你可以在预览区查看应用，或继续输入修改需求。",
        versionReviewUnavailable: "这个旧版本没有保存独立评审信息。",
        multiAgentFlow: "多 Agent 协作",
        multiAgentHelp: "Coordinator 将任务分配给 Planner、Coder 和 Reviewer。",
        agentPlan: "Agent 计划",
        agentTracePending: "Agent trace 会在执行后显示。",
        runReport: "任务报告",
        loadingReport: "正在加载报告...",
        attempts: "尝试次数",
        versions: "版本数",
        interviewSummary: "面试讲解摘要",
        review: "Review",
        memoryEvidence: "记忆证据",
        reportPending: "加载任务后会显示报告。",
        directory: "目录",
        imageAsset: "图片资产",
        imagePreviewNeedsServer: "启动预览服务后可查看图片。",
        generatedFilesPending: "执行后会显示生成文件。",
        loadingFile: "正在加载文件...",
        path: "路径",
    },
    en: {
        navHome: "Home",
        navRuns: "Runs",
        localDemo: "Local Demo",
        languageToggle: "中文",
        heroBadge: "Real LLM + traceable workflow + repair loop",
        heroTitleLine1: "Build with Agents.",
        heroTitleLine2: "Watch every step.",
        heroSubtitle:
            "AppForge creates an isolated workspace, calls a real Coding Agent, runs build and evaluation, repairs failures, and shows every trace, file, preview, and report.",
        advantageTrace: "Traceable Agent Steps",
        advantageEval: "Build + Eval Harness",
        advantageRepair: "Repair Loop",
        promptLabel: "Describe the app you want to forge",
        repairAttempts: "Repair attempts",
        creating: "Creating...",
        forgeApp: "Forge App ->",
        recentRuns: "Recent Runs",
        openRunActions: "Open run actions",
        deleting: "Deleting...",
        delete: "Delete",
        deleteVersionConfirm:
            "Delete this version? Later version numbers will move forward.",
        continueFromVersion: "Continue from this version",
        continueFromVersionConfirm:
            "Restore this version as the current workspace and continue from it? The latest output that has not been saved as a version will be replaced.",
        restoringVersion: "Restoring...",
        back: "Back",
        runWorkspace: "Run Workspace",
        buildConsole: "Agent build console",
        appWorkspace: "App workspace",
        versionHistory: "Version History",
        versionHelp: "Versions are created as the agent builds and repairs this app.",
        draftPreview: "Current draft",
        draftPreviewBody:
            "The center preview is showing the current workspace output. It becomes a saved version only after review passes or you approve it.",
        draftPreviewStatus: "Not saved as a version",
        draftRunCreated: "Draft run created",
        waitingFirstExecution: "Waiting for first agent execution",
        run: "Run",
        latest: "Latest request",
        currentRequest: "Current request",
        latestSavedVersion: "Latest saved version",
        agentRunning: "Agent is running...",
        agentRepairing: "Agent is repairing...",
        executeRun: "Execute Run",
        cancelRun: "Stop Run",
        cancellingRun: "Stopping...",
        cancelRunConfirm: "Stop the current agent run? Unaccepted changes will be rolled back and saved versions will stay intact.",
        cancelled: "Stopped",
        cancelledHelp: "The run was stopped and unaccepted changes were rolled back. You can preview the stable version or retry the current request.",
        completed: "Completed",
        needsReview: "Needs review",
        executionUnavailable: "Execution unavailable",
        humanReview: "Human Review",
        humanReviewHelp:
            "Review the current output in the center preview before approving it or requesting a repair.",
        pendingRepairRequest: "Pending request",
        repairFeedback: "Repair feedback",
        approve: "Approve",
        repairing: "Repairing...",
        requestRepair: "Request Repair",
        livePreview: "Live Preview",
        previewingVersion: "Previewing version",
        previewingLatest: "Previewing latest run output",
        previewingDraft: "Previewing the current draft, not a saved version yet",
        noPreviewServer: "No preview server yet",
        previewReady: "Preview server is ready",
        starting: "Starting...",
        refreshPreview: "Refresh Preview",
        startPreview: "Start Preview",
        generatedPreviewTitle: "Generated app preview",
        previewEmptyTitle: "Preview will appear here",
        previewEmptyBody: "Execute the run, then start the preview server to inspect the generated app.",
        noGeneratedOutput:
            "The agent did not successfully write any application files, so there is no generated page to preview or review.",
        browserChecks: "Browser Checks",
        browserChecksHelp: "Real browser validation after starting the preview.",
        passed: "passed",
        pass: "PASS",
        fail: "FAIL",
        iterationPlaceholder: "Describe the next change, for example: add dark mode or improve the layout...",
        iterationHelp: "Continue from the latest generated version.",
        iterationSubmitted:
            "Iteration request submitted. The agent is working in the background and this view will refresh automatically.",
        iterationBlockedForHumanReview:
            "This result needs human review. Approve it or use the repair feedback box on the left.",
        iterating: "Iterating...",
        sendIteration: "Send Iteration",
        overview: "Overview",
        plan: "Plan",
        trace: "Trace",
        report: "Report",
        files: "Files",
        runSections: "Run sections",
        status: "Status",
        finished: "Finished",
        build: "Build",
        eval: "Eval",
        browser: "Browser",
        yes: "yes",
        no: "no",
        checksPassed: "checks passed",
        runDetailsPending: "Run execution details will appear after the agent runs.",
        runFailedNoResult:
            "This execution stopped before saving a result. The workspace may still contain partial generated code, so preview can still show draft output.",
        failureReason: "Failure reason",
        resultReady: "The generated result is ready. Use the preview area or continue iterating.",
        versionReviewUnavailable:
            "This older version does not have saved review metadata.",
        multiAgentFlow: "Multi-Agent Flow",
        multiAgentHelp: "The Coordinator assigns work to Planner, Coder, and Reviewer.",
        agentPlan: "Agent Plan",
        agentTracePending: "Agent trace will appear after execution.",
        runReport: "Run Report",
        loadingReport: "Loading report...",
        attempts: "Attempts",
        versions: "Versions",
        interviewSummary: "Interview Summary",
        review: "Review",
        memoryEvidence: "Memory Evidence",
        reportPending: "Report will appear after this run is loaded.",
        directory: "Directory",
        imageAsset: "Image Asset",
        imagePreviewNeedsServer: "Start the preview server to inspect this image.",
        generatedFilesPending: "Generated files will appear after execution.",
        loadingFile: "Loading generated file...",
        path: "Path",
    },
} satisfies Record<Language, Record<string, string>>;

async function getErrorMessage(response: Response, fallback: string) {
    try {
        const errorResponse = (await response.json()) as ErrorResponse;

        return errorResponse.message ?? errorResponse.error ?? fallback;
    } catch {
        return fallback;
    }
}

function getAgentAttempts(result: ReactAppAgentResult): AgentAttempt[] {
    return result.attempts ?? [
        {
            kind: "initial",
            agent: result.agent,
            install: result.install,
            build: result.build,
            eval: getAgentEval(result),
            review: getAgentReview(result),
        },
    ];
}

function getAgentEval(result: ReactAppAgentResult): ReactAppEvalResult {
    return result.eval ?? {
        passed: false,
        checks: [
            {
                name: "legacy eval unavailable",
                passed: false,
            },
        ],
    };
}

function getAgentReview(result: ReactAppAgentResult): AgentReview {
    const evalResult = getAgentEval(result);

    return result.review ?? {
        accepted: false,
        reason: "Review unavailable for this older run result.",
        checks: {
            agentFinished: result.agent.finished,
            installPassed: result.install.exitCode === 0,
            buildPassed: result.build.exitCode === 0,
            evalPassed: evalResult.passed,
        },
    };
}

function createLegacyTraceEvent(
    id: string,
    label: string,
    status: TraceEvent["status"],
    message?: string,
): TraceEvent {
    return {
        id,
        label,
        status,
        message,
        createdAt: "legacy",
    };
}

function getTraceEvents(result: ReactAppAgentResult): TraceEvent[] {
    if (result.trace && result.trace.length > 0) {
        return result.trace;
    }

    const trace: TraceEvent[] = [
        createLegacyTraceEvent(
            "copy-template",
            "Copy starter template",
            "succeeded",
        ),
        createLegacyTraceEvent(
            "coordinate-agents",
            "Coordinate planner, coder, and reviewer",
            "succeeded",
        ),
    ];

    getAgentAttempts(result).forEach((attempt, index) => {
        const prefix = `${attempt.kind}-${index + 1}`;

        trace.push(
            createLegacyTraceEvent(
                `${prefix}-agent`,
                `${attempt.kind} coding agent`,
                attempt.agent.finished ? "succeeded" : "failed",
                `${attempt.agent.steps.length} agent step(s) executed`,
            ),
            createLegacyTraceEvent(
                `${prefix}-install`,
                "Install dependencies",
                attempt.install.exitCode === 0 ? "succeeded" : "failed",
                `exit code ${attempt.install.exitCode}`,
            ),
            createLegacyTraceEvent(
                `${prefix}-build`,
                "Build generated app",
                attempt.build.exitCode === 0 ? "succeeded" : "failed",
                `exit code ${attempt.build.exitCode}`,
            ),
            createLegacyTraceEvent(
                `${prefix}-eval`,
                "Evaluate generated app",
                attempt.eval.passed ? "succeeded" : "failed",
                `${attempt.eval.checks.filter((check) => check.passed).length}/${attempt.eval.checks.length} checks passed`,
            ),
            createLegacyTraceEvent(
                `${prefix}-review`,
                "Review result",
                attempt.review.accepted ? "succeeded" : "failed",
                attempt.review.reason,
            ),
        );
    });

    return trace;
}

function formatDurationMs(value: number | undefined): string {
    const duration = Math.max(0, Math.round(value ?? 0));

    if (duration >= 1000) {
        return `${(duration / 1000).toFixed(1)}s`;
    }

    return `${duration}ms`;
}

function getFallbackPages(result: ReactAppAgentResult | null): string[] {
    if (!result) {
        return [];
    }

    const fallbackPages = new Set(result.metrics?.fallbackPages ?? []);

    for (const attempt of result.attempts ?? []) {
        for (const workstream of attempt.parallelWorkstreams ?? []) {
            if (workstream.status === "fallback") {
                fallbackPages.add(
                    `${workstream.label} (${workstream.routePath || workstream.path})`,
                );
            }
        }
    }

    return [...fallbackPages];
}

function  findAttemptForTraceEvent(
    result:ReactAppAgentResult,
    eventId:string,
):AgentAttempt|undefined{
    const match = /^(initial|repair)-(\d+)-agent$/.exec(eventId);

    if (!match){
        return undefined;
    }
    const kind = match[1] as AgentAttempt["kind"];
    const attemptIndex = Number(match[2]) - 1;
    const attempt = getAgentAttempts(result)[attemptIndex];

    if (!attempt || attempt.kind !== kind) {
        return undefined;
    }

    return attempt;
}
function formatCommandResult(result:CommandResult):string{
    return [
        `Exit code: ${result.exitCode}`,
        result.stdout.length > 0 ? `stdout:\n${result.stdout}` : "",
        result.stderr.length > 0 ? `stderr:\n${result.stderr}` : "",
    ]
        .filter((part) => part.length > 0)
        .join("\n\n");
}

function hasSuccessfulWorkspaceChange(
    result: ReactAppAgentResult | null | undefined,
): boolean {
    if (!result) {
        return false;
    }

    const agentResults = [
        result.agent,
        ...(result.attempts ?? []).map((attempt) => attempt.agent),
    ];

    return agentResults.some((agent) =>
        agent.steps.some(
            (step) =>
                step.execution.ok &&
                step.execution.changed !== false &&
                WORKSPACE_CHANGE_ACTION_TYPES.has(step.action.type),
        ),
    );
}

function runWorkspaceWasRolledBack(run: Run): boolean {
    return (
        run.status === "failed" &&
        /rolled back|workspace (?:was )?restored|已回滚/iu.test(
            run.errorMessage ?? "",
        )
    );
}

function isTerminalRunWithoutGeneratedOutput(input: {
    run: Run;
    result: ReactAppAgentResult | null | undefined;
    versions: RunVersion[];
}): boolean {
    return (
        TERMINAL_RUN_STATUSES_WITHOUT_OUTPUT.has(input.run.status) &&
        input.versions.length === 0 &&
        (runWorkspaceWasRolledBack(input.run) ||
            !hasSuccessfulWorkspaceChange(input.result))
    );
}

function getLatestPromptBlock(prompt: string | undefined): string | undefined {
    const latestBlock = prompt
        ?.split(/\n{2,}/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .at(-1);

    return latestBlock && latestBlock.length > 0 ? latestBlock : undefined;
}

function getLatestRequestText(run: Run): string | undefined {
    const latestRequest = (
        (run.status === "succeeded"
            ? undefined
            : getLatestPromptBlock(run.operationPrompt)) ??
        run.latestVersion?.goal ??
        ""
    ).trim();

    if (!latestRequest || latestRequest === run.goal.trim()) {
        return undefined;
    }

    return latestRequest;
}

function getReviewChecks(review: AgentReview, language: Language): Array<{
    label: string;
    passed: boolean;
}> {
    return [
        {
            label: language === "zh" ? "Agent 正常结束" : "Agent finished",
            passed: review.checks.agentFinished,
        },
        {
            label:
                language === "zh"
                    ? "依赖安装通过"
                    : "Dependencies installed",
            passed: review.checks.installPassed,
        },
        {
            label: language === "zh" ? "构建通过" : "Build passed",
            passed: review.checks.buildPassed,
        },
        {
            label: language === "zh" ? "静态评测通过" : "Static eval passed",
            passed: review.checks.evalPassed,
        },
        ...(review.checks.browserPassed === undefined
            ? []
            : [
                  {
                      label:
                          language === "zh"
                              ? "浏览器评测通过"
                              : "Browser eval passed",
                      passed: review.checks.browserPassed,
                  },
              ]),
    ];
}

function hasQualityGateFailure(review: AgentReview): boolean {
    return (
        !review.checks.installPassed ||
        !review.checks.buildPassed ||
        !review.checks.evalPassed
    );
}

function formatReviewReason(reason: string, language: Language): string {
    if (
        language === "zh" &&
        reason === "Rejected because agent did not finish."
    ) {
        return "旧评审结果：Agent 没有显式返回 finish。若构建和评测都通过，刷新任务详情后会自动修正。";
    }

    if (
        language === "zh" &&
        reason.includes("without an explicit finish action")
    ) {
        return "生成结果已通过构建和评测；Agent 只是没有显式返回 finish，已按质量通过处理。";
    }

    return reason;
}

function isReviewerOnlyFailureMessage(message: string | undefined): boolean {
    if (!message) {
        return false;
    }

    return (
        message.includes("Reviewer Agent model request failed") ||
        message.includes("LLM reviewer was unavailable") ||
        message.includes("LLM reviewer") && message.includes("timed out") ||
        message.includes("Reviewer") && message.includes("timed out")
    );
}

function isUnchangedIterationMessage(message: string | undefined): boolean {
    return (
        message?.startsWith("Iteration did not change the workspace") ||
        message?.includes("No new draft was produced")
    ) ?? false;
}

function formatStatusClass(status: string): string {
    return `status-pill status-${status.replaceAll("_", "-")}`;
}

function DesignPlanPanel({
    designPlan,
    source,
    compliance,
    language,
}: {
    designPlan?: DesignPlan;
    source?: "planner" | "preserved" | "fallback";
    compliance?: DesignPlanCompliance[];
    language: Language;
}) {
    if (!designPlan) {
        return null;
    }

    return (
        <details className="design-plan-panel" open>
            <summary>
                Design Plan / VisualDNA
                {source ? <span>{source}</span> : null}
            </summary>
            <dl className="design-plan-list">
                <div>
                    <dt>{language === "zh" ? "类型" : "Type"}</dt>
                    <dd>{designPlan.applicationType}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "受众" : "Audience"}</dt>
                    <dd>{designPlan.designIntent.audience}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "目标" : "Primary goal"}</dt>
                    <dd>{designPlan.designIntent.primaryGoal}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "构图" : "Composition"}</dt>
                    <dd>{designPlan.visualDNA.composition}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "表面策略" : "Surface"}</dt>
                    <dd>{designPlan.visualDNA.surfaceStrategy}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "节奏" : "Rhythm"}</dt>
                    <dd>{designPlan.visualDNA.sectionRhythm.join(" → ")}</dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "独特母题" : "Unique motifs"}</dt>
                    <dd className="tag-row">
                        {designPlan.visualDNA.uniqueMotifs.map((motif) => (
                            <span key={motif}>{motif}</span>
                        ))}
                    </dd>
                </div>
                <div>
                    <dt>{language === "zh" ? "禁止模式" : "Forbidden"}</dt>
                    <dd className="tag-row warning-tags">
                        {designPlan.visualDNA.forbiddenPatterns.length > 0
                            ? designPlan.visualDNA.forbiddenPatterns.map((pattern) => (
                                  <span key={pattern}>{pattern}</span>
                              ))
                            : "—"}
                    </dd>
                </div>
            </dl>
            <ul className="design-criteria-list">
                {designPlan.acceptanceCriteria.map((criterion) => (
                    <li key={criterion.id}>
                        <strong>{criterion.id}</strong>
                        <span>{criterion.instruction}</span>
                        <small>{criterion.verification}</small>
                    </li>
                ))}
            </ul>
            {compliance && compliance.length > 0 ? (
                <table className="design-compliance-table">
                    <thead>
                        <tr>
                            <th>{language === "zh" ? "检查项" : "Criterion"}</th>
                            <th>{language === "zh" ? "状态" : "Status"}</th>
                            <th>{language === "zh" ? "证据" : "Evidence"}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {compliance.map((item) => (
                            <tr key={item.criterion}>
                                <td>{item.criterion}</td>
                                <td>{item.status}</td>
                                <td>{item.evidence}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </details>
    );
}

function isRunActive(status: string): boolean {
    return [
        "planning",
        "running",
        "executing",
        "validating",
        "repairing",
        "evaluating",
    ].includes(status);
}

function formatRunOperation(run: Run, language: Language): string | null {
    if (!isRunActive(run.status)) {
        return null;
    }

    if (language === "zh") {
        if (run.operation === "iteration") {
            return "正在根据本次修改需求迭代应用...";
        }

        if (run.operation === "repair") {
            return "正在根据人工反馈修复应用...";
        }

        if (run.operation === "retry") {
            return "正在保留现有代码并重新修复应用...";
        }

        return "正在生成、构建并评测应用...";
    }

    if (run.operation === "iteration") {
        return "Applying the requested iteration...";
    }

    if (run.operation === "repair") {
        return "Applying the requested repair...";
    }

    if (run.operation === "retry") {
        return "Retrying while preserving the existing workspace...";
    }

    return "Generating, building, and evaluating the app...";
}

function formatElapsedTime(startedAt: string, language: Language): string {
    const elapsedSeconds = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
    );
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    if (language === "zh") {
        return minutes > 0
            ? `已运行 ${minutes} 分 ${seconds} 秒`
            : `已运行 ${seconds} 秒`;
    }

    return minutes > 0
        ? `Elapsed ${minutes}m ${seconds}s`
        : `Elapsed ${seconds}s`;
}

function formatLastActivity(updatedAt: string, language: Language): string {
    const seconds = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(updatedAt)) / 1000),
    );

    if (language === "zh") {
        return seconds < 10 ? "刚刚有新进展。" : `${seconds} 秒前有新进展。`;
    }

    return seconds < 10 ? "Progress updated just now." : `Progress updated ${seconds}s ago.`;
}

function getLiveOperationProgress(
    run: Run,
    language: Language,
): RunProgress | undefined {
    if (
        !isRunActive(run.status) ||
        !run.operationStage ||
        !run.operationStartedAt
    ) {
        return undefined;
    }

    const stageCopy = language === "zh"
        ? {
              preparing: ["正在准备", "正在准备或恢复独立工作区。"],
              planning: ["正在规划", "Planner 正在拆解需求和验收标准。"],
              coding: ["正在编写代码", "Coding Agent 正在修改应用文件。"],
              installing: ["正在安装依赖", "正在安装并核对项目依赖。"],
              building: ["正在构建", "正在编译应用并收集构建错误。"],
              evaluating: ["正在评测", "正在执行静态检查和真实浏览器验证。"],
              reviewing: ["正在审核", "Reviewer 正在核对需求和质量门禁。"],
              repairing: ["正在自动修复", "Agent 正在根据失败证据修复当前草稿。"],
          }
        : {
              preparing: ["Preparing", "Preparing or restoring the isolated workspace."],
              planning: ["Planning", "The planner is defining steps and acceptance criteria."],
              coding: ["Writing code", "The coding agent is updating application files."],
              installing: ["Installing dependencies", "Installing and verifying project dependencies."],
              building: ["Building", "Compiling the app and collecting build errors."],
              evaluating: ["Evaluating", "Running static checks and real-browser validation."],
              reviewing: ["Reviewing", "The reviewer is checking requirements and quality gates."],
              repairing: ["Repairing", "The agent is repairing the draft from failure evidence."],
          };
    const [label, detail] = stageCopy[run.operationStage];

    return {
        value: 0,
        label,
        detail: run.operationUpdatedAt
            ? `${detail} ${formatLastActivity(run.operationUpdatedAt, language)}`
            : detail,
        live: true,
        elapsed: formatElapsedTime(run.operationStartedAt, language),
    };
}

function getRunProgress(input: {
    run: Run;
    result: ReactAppAgentResult | null;
    versions: RunVersion[];
    language: Language;
}): RunProgress {
    const { run, result, versions, language } = input;
    const hasVersion = versions.length > 0;
    const liveProgress = getLiveOperationProgress(run, language);

    if (liveProgress) {
        return liveProgress;
    }

    if (
        isTerminalRunWithoutGeneratedOutput({
            run,
            result,
            versions,
        })
    ) {
        const detail =
            run.errorMessage ??
            result?.agent.errorMessage ??
            (language === "zh"
                ? "Agent 没有成功写入任何应用文件，因此没有生成可审核的页面。"
                : "The agent did not successfully write any application files, so no reviewable page was generated.");

        return {
            value: 30,
            label: language === "zh" ? "未生成页面" : "No page generated",
            detail,
        };
    }

    if (language === "zh") {
        if (run.status === "queued") {
            return {
                value: 8,
                label: "等待执行",
                detail: "任务已创建，等待你点击执行或进入后台队列。",
            };
        }

        if (run.status === "running") {
            if (run.operation === "iteration") {
                return {
                    value: 58,
                    label: "正在迭代",
                    detail: "Agent 正在基于你的新需求修改现有 workspace。",
                };
            }

            if (run.operation === "retry") {
                return {
                    value: 52,
                    label: "正在重试",
                    detail: "Agent 正在保留现有代码并重新执行构建闭环。",
                };
            }

            return {
                value: 42,
                label: "正在生成",
                detail: "Agent 正在规划、写代码、安装依赖并构建应用。",
            };
        }

        if (run.status === "repairing") {
            return {
                value: 72,
                label: "正在修复",
                detail: "质量门禁发现问题，Agent 正在根据错误和反馈修复。",
            };
        }

        if (run.status === "waiting_for_human") {
            return {
                value: result ? 88 : 76,
                label: "等待人工审核",
                detail: "本次改动未通过质量门禁，页面已回滚到运行前版本；请查看原因后提交修复反馈。",
            };
        }

        if (run.status === "succeeded") {
            return {
                value: 100,
                label: hasVersion ? "已保存版本" : "已完成",
                detail: hasVersion
                    ? "结果已通过质量门禁并保存为版本。"
                    : "结果已通过质量门禁。",
            };
        }

        if (run.status === "cancelled") {
            return {
                value: 64,
                label: "已停止",
                detail: "后台任务已停止，本次未验收改动已回滚，已保存版本保持不变。",
            };
        }

        if (run.status === "failed") {
            if (
                isUnchangedIterationMessage(run.errorMessage) ||
                isUnchangedIterationMessage(result?.review?.reason)
            ) {
                return {
                    value: 64,
                    label: "没有产生新草稿",
                    detail: "Agent 这次执行后，workspace 和最新保存版本完全一样；系统没有把它当成可审核草稿。",
                };
            }

            return {
                value: result ? 70 : 30,
                label: result ? "改动未应用" : "执行失败",
                detail: result
                    ? "本次改动未通过质量门禁，workspace 已恢复；请查看原因后重试或继续修复。"
                    : "执行没有保存有效结果，请查看失败原因后重试。",
            };
        }

        return {
            value: 15,
            label: "准备中",
            detail: "任务状态正在同步。",
        };
    }

    if (run.status === "queued") {
        return {
            value: 8,
            label: "Waiting",
            detail: "The run is created and ready to execute.",
        };
    }

    if (run.status === "running") {
        return {
            value: run.operation === "iteration" ? 58 : 42,
            label: run.operation === "iteration" ? "Iterating" : "Generating",
            detail:
                run.operation === "iteration"
                    ? "The agent is applying your new request to the current workspace."
                    : "The agent is planning, writing code, installing dependencies, and building.",
        };
    }

    if (run.status === "repairing") {
        return {
            value: 72,
            label: "Repairing",
            detail: "Quality gates found an issue and the agent is repairing it.",
        };
    }

    if (run.status === "waiting_for_human") {
        return {
            value: result ? 88 : 76,
            label: "Needs Review",
            detail: "The change failed its quality gate and the page was rolled back. Inspect the result, then request a repair.",
        };
    }

    if (run.status === "succeeded") {
        return {
            value: 100,
            label: hasVersion ? "Version Saved" : "Completed",
            detail: hasVersion
                ? "The result passed quality gates and was saved as a version."
                : "The result passed quality gates.",
        };
    }

    if (run.status === "cancelled") {
        return {
            value: 64,
            label: "Stopped",
            detail: "The background task stopped, unaccepted changes were rolled back, and saved versions remain intact.",
        };
    }

    if (run.status === "failed") {
        if (
            isUnchangedIterationMessage(run.errorMessage) ||
            isUnchangedIterationMessage(result?.review?.reason)
        ) {
            return {
                value: 64,
                label: "No New Draft",
                detail: "The workspace is identical to the latest saved version, so this run was not treated as a reviewable draft.",
            };
        }

        return {
            value: result ? 70 : 30,
            label: result ? "Change Not Applied" : "Failed",
            detail: result
                ? "The change failed its quality gate and the workspace was restored. Inspect the result, then retry or repair it."
                : "No valid result was saved. Inspect the failure and retry.",
        };
    }

    return {
        value: 15,
        label: "Preparing",
        detail: "The run status is syncing.",
    };
}

function getReviewDispositionView(input: {
    run: Run;
    review?: AgentReview;
    result: ReactAppAgentResult | null;
    versions: RunVersion[];
    selectedVersionNumber: number | null;
    language: Language;
}): ReviewDispositionView {
    const { run, review, result, versions, selectedVersionNumber, language } =
        input;
    const activeMessage = formatRunOperation(run, language);
    const hasVersion = versions.length > 0;
    const isViewingSavedVersion = selectedVersionNumber !== null;
    const terminalRunHasNoGeneratedOutput =
        !activeMessage &&
        isTerminalRunWithoutGeneratedOutput({
            run,
            result,
            versions,
        });

    if (terminalRunHasNoGeneratedOutput) {
        return {
            tone: "danger",
            title:
                language === "zh" ? "没有生成页面" : "No page was generated",
            detail:
                run.errorMessage ??
                result?.agent.errorMessage ??
                (language === "zh"
                    ? "Agent 没有成功写入任何应用文件，当前 workspace 仍是初始模板。"
                    : "The agent did not successfully write any application files; the workspace is still the starter template."),
        };
    }

    if (language === "zh") {
        if (activeMessage) {
            if (run.status === "repairing") {
                return {
                    tone: "info",
                    title: "质量门禁触发自动修复",
                    detail: "构建、评测或 Reviewer 发现问题，系统正在保留现有代码并尝试修复。",
                };
            }

            return {
                tone: "info",
                title: "Agent 正在执行",
                detail: activeMessage,
            };
        }

        if (run.status === "cancelled") {
            return {
                tone: "warning",
                title: "任务已停止，稳定版本已恢复",
                detail: "本次未验收改动已回滚；你可以预览稳定版本，修改需求后再次执行。",
            };
        }

        if (
            run.status === "failed" &&
            isUnchangedIterationMessage(run.errorMessage)
        ) {
            return {
                tone: "danger",
                title: "没有产生新草稿",
                detail: run.errorMessage?.includes("timed out")
                    ? "模型请求超时，而且 workspace 仍然和最新保存版本完全一样，所以系统没有生成可审核的新草稿。"
                    : "这次迭代后的文件和最新保存版本完全一样，所以系统没有进入人工审核。",
            };
        }

        if (!review) {
            if (isViewingSavedVersion) {
                return {
                    tone: "success",
                    title: "正在查看已保存版本",
                    detail: "这个旧版本没有单独保存 Reviewer 详情，但它已经作为版本快照保存，可以预览或从这里继续修改。",
                };
            }

            if (run.status === "queued") {
                return {
                    tone: "info",
                    title: "等待执行",
                    detail: "点击执行任务后，Agent 会进入生成、构建、评测和审核流程。",
                };
            }

            if (run.status === "failed") {
                return {
                    tone: "danger",
                    title: result ? "改动未应用" : "执行失败",
                    detail: result
                        ? "本次改动没有通过完整质量门禁，workspace 已恢复到运行前状态。"
                        : "这次执行没有得到可保存的结果，需要重新执行或调整需求。",
                };
            }

            if (run.status === "succeeded" && hasVersion) {
                return {
                    tone: "success",
                    title: "版本已保存",
                    detail: "结果已经保存为版本。这个版本没有单独的 Reviewer 详情，但可以继续预览或迭代。",
                };
            }

            return {
                tone: "warning",
                title: "等待审核",
                detail: "当前没有可展示的 Reviewer 结论，请先查看预览或重新执行。",
            };
        }

        if (review.accepted) {
            return {
                tone: "success",
                title: hasVersion ? "质量门禁通过，版本已保存" : "质量门禁通过",
                detail: "构建、静态评测、浏览器评测和 Review 已通过，可以继续预览或迭代。",
            };
        }

        if (isUnchangedIterationMessage(review.reason)) {
            return {
                tone: "danger",
                title: "没有产生新草稿",
                detail: "这次迭代后的文件和最新保存版本完全一样，所以系统没有进入人工审核。请换一种更明确的修改需求，或从某个版本重新继续。",
            };
        }

        if (hasQualityGateFailure(review)) {
            return {
                tone: run.status === "failed" ? "danger" : "warning",
                title: "基础质量门禁未通过",
                detail: "Agent 输出还存在构建、静态评测或浏览器评测问题，需要修复后再保存为版本。",
            };
        }

        return {
            tone: "warning",
            title: "Reviewer 不满意，等待人工判断",
            detail: "基础质量门禁已经通过，但 Reviewer 认为需求匹配还不够好，请预览后批准或提交反馈。",
        };
    }

    if (activeMessage) {
        return {
            tone: run.status === "repairing" ? "info" : "info",
            title:
                run.status === "repairing"
                    ? "Quality gate triggered repair"
                    : "Agent is running",
            detail:
                run.status === "repairing"
                    ? "Build, eval, or review found an issue. The system is repairing the current workspace."
                    : activeMessage,
        };
    }

    if (run.status === "cancelled") {
        return {
            tone: "warning",
            title: "Run stopped, stable version restored",
            detail: "Unaccepted changes were rolled back. Preview the stable version or retry with an updated request.",
        };
    }

    if (
        run.status === "failed" &&
        isUnchangedIterationMessage(run.errorMessage)
    ) {
        return {
            tone: "danger",
            title: "No new draft was produced",
            detail: run.errorMessage?.includes("timed out")
                ? "The model request timed out and the workspace still matches the latest saved version."
                : "The workspace is identical to the latest saved version, so this run was not moved into human review.",
        };
    }

    if (!review) {
        if (isViewingSavedVersion) {
            return {
                tone: "success",
                title: "Viewing saved version",
                detail: "This older snapshot does not include separate reviewer details, but it is already saved and can be previewed or continued.",
            };
        }

        if (run.status === "queued") {
            return {
                tone: "info",
                title: "Ready to execute",
                detail: "Run the agent to generate, build, evaluate, and review the app.",
            };
        }

        if (run.status === "failed") {
            return {
                tone: "danger",
                title: result ? "Change not applied" : "Run failed",
                detail: result
                    ? "The change did not pass the full quality gate, so the workspace was restored to its pre-run state."
                    : "No saveable result was produced. Retry or adjust the request.",
            };
        }

        if (run.status === "succeeded" && hasVersion) {
            return {
                tone: "success",
                title: "Version saved",
                detail: "The result is saved as a version. This version has no separate reviewer details, but it can be previewed or iterated.",
            };
        }

        return {
            tone: "warning",
            title: "Needs review",
            detail: "No reviewer conclusion is available yet. Inspect the preview or retry.",
        };
    }

    if (review.accepted) {
        return {
            tone: "success",
            title: hasVersion
                ? "Quality gate passed, version saved"
                : "Quality gate passed",
            detail: "Build, static eval, browser eval, and review passed.",
        };
    }

    if (isUnchangedIterationMessage(review.reason)) {
        return {
            tone: "danger",
            title: "No new draft was produced",
            detail: "The workspace is identical to the latest saved version, so this run was not moved into human review.",
        };
    }

    if (hasQualityGateFailure(review)) {
        return {
            tone: run.status === "failed" ? "danger" : "warning",
            title: "Quality gate failed",
            detail: "The app still has build, static eval, or browser eval issues before it can be saved.",
        };
    }

    return {
        tone: "warning",
        title: "Reviewer requested human judgment",
        detail: "The basic quality gates passed, but the reviewer is not satisfied with requirement fit.",
    };
}

export function App() {
    const createInFlightRef = useRef(false);
    const currentRunIdRef = useRef<string | null>(null);
    const previewStartInFlightRef = useRef(false);
    const previewStartTargetRef = useRef<PreviewStartTarget | null>(null);
    const queuedPreviewStartRef = useRef<PreviewStartTarget | null>(null);
    const previewRequestSequenceRef = useRef(0);
    const [language, setLanguage] = useState<Language>(() => {
        const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

        return savedLanguage === "en" ? "en" : "zh";
    });
    const copy = UI_COPY[language];
    const [goal, setGoal] = useState(
        "Create a simple React task app with an input and task list",
    );
    const [run, setRun] = useState<Run | null>(null);
    const [runs,setRuns] = useState<Run[]>([]);
    const [agentResult, setAgentResult] = useState<ReactAppAgentResult | null>(
        null,
    );
    const [generatedFiles, setGeneratedFiles] = useState<FileListResponse[]>([]);
    const [generatedFile, setGeneratedFile] = useState<FileResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [executingRunId, setExecutingRunId] = useState<string | null>(null);
    const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
    const [openRunMenuId, setOpenRunMenuId] = useState<string | null>(null);
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [preview, setPreview] = useState<PreviewSession | null>(null);
    const [browserEval, setBrowserEval] = useState<BrowserEvalResult | null>(
        null,
    );
    const [runReport, setRunReport] = useState<RunReport | null>(null);
    const [isLoadingReport, setIsLoadingReport] = useState(false);
    const [isStartingPreview, setIsStartingPreview] = useState(false);
    const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
    const [coordination, setCoordination] =
        useState<CoordinationResponse | null>(null);
    const [repairFeedback,setRepairFeedback] =  useState("");
    const [isRequestingRepair,setIsRequestingRepair] = useState(false);
    const [activePanel, setActivePanel] =
        useState<ActivePanel>("overview");
    const [maxRepairAttempts,setMaxRepairAttempts] = useState(1);
    const [versions,setVersions] = useState<RunVersion[]>([]);
    const [deletingVersionNumber, setDeletingVersionNumber] = useState<number | null>(null);
    const [continuingVersionNumber, setContinuingVersionNumber] = useState<number | null>(null);
    const [selectedVersionNumber, setSelectedVersionNumber] =
        useState<number | null>(null);
    const [previewVersionNumber, setPreviewVersionNumber] =
        useState<number | null>(null);
    const [iterationPrompt, setIterationPrompt] = useState("");
    const [iterationNotice, setIterationNotice] = useState<string | null>(null);
    const [isIterating, setIsIterating] = useState(false);
    const [isCancellingRun, setIsCancellingRun] = useState(false);

    function toggleLanguage() {
        setLanguage((currentLanguage) => {
            const nextLanguage = currentLanguage === "zh" ? "en" : "zh";
            localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);

            return nextLanguage;
        });
    }

    function syncRunState(nextRun: Run) {
        setRun((currentRun) =>
            currentRun?.id === nextRun.id ? nextRun : currentRun,
        );
        setRuns((currentRuns) =>
            currentRuns.map((existingRun) =>
                existingRun.id === nextRun.id ? nextRun : existingRun,
            ),
        );
    }

    async function createRun() {
        if (createInFlightRef.current) {
            return;
        }

        createInFlightRef.current = true;
        setIsCreating(true);
        setError(null);

        try {
            const response = await fetchWithTimeout(apiUrl("/runs"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    goal,
                }),
            });

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Create run failed with ${response.status}`,
                    ),
                );
            }

            const createdRun = (await response.json()) as Run;
            setAgentResult(null);
            setGeneratedFiles([]);
            setGeneratedFile(null);
            setPreview(null);
            setBrowserEval(null);
            setRunReport(null);
            setCoordination(null);
            setActivePanel("overview");
            setVersions([]);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            setIterationPrompt("");
            localStorage.removeItem(PREVIEW_STORAGE_KEY);
            setRun(createdRun);
            setRuns((currentRuns) => [createdRun, ...currentRuns]);
            currentRunIdRef.current = createdRun.id;
            localStorage.setItem(CURRENT_RUN_ID_STORAGE_KEY, createdRun.id);
            await loadCoordination(createdRun.id);
            await loadRuns();
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Create run failed",
            );
        } finally {
            createInFlightRef.current = false;
            setIsCreating(false);
        }
    }

    async function executeRun() {
        if (!run) {
            return;
        }

        const runId = run.id;

        setExecutingRunId(runId);
        setError(null);
        setAgentResult(null);
        setBrowserEval(null);
        setRunReport(null);
        setActivePanel("preview");

        try {
            const response = await fetchWithTimeout(
                apiUrl(`/runs/${runId}/execute`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        maxRepairAttempts,
                        background: true,
                        // Failed/cancelled runs with no saved version do not
                        // have a stable continuation baseline. Start fresh so
                        // they use the normal generation pipeline instead of
                        // looping on a broken draft.
                        resetWorkspace:
                            run.status === "queued" ||
                            ((run.status === "failed" ||
                                run.status === "cancelled") &&
                                versions.length === 0),
                    }),
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Execute run failed with ${response.status}`,
                    ),
                );
            }

            const startResponse = (await response.json()) as StartExecuteResponse;
            syncRunState(startResponse.run);
            await loadRuns();

            const executeResponse = await waitForRunCompletion(runId);
            syncRunState(executeResponse.run);
            setAgentResult(executeResponse.result ?? null);
            setBrowserEval(executeResponse.result?.browserEval ?? null);
            setVersions(executeResponse.versions);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            await loadGeneratedFileDirectories(runId);
            await loadGeneratedFile(runId, "src/App.tsx");
            await loadRunReport(runId);
            await loadRuns();

            if (
                executeResponse.run.status === "waiting_for_human" &&
                !isTerminalRunWithoutGeneratedOutput({
                    run: executeResponse.run,
                    result: executeResponse.result,
                    versions: executeResponse.versions,
                })
            ) {
                await startPreviewForRun(runId);
            }
        } catch (caughtError) {
            try {
                await refreshRun(runId);
                await loadRuns();
            } catch {
                // The API itself may be unavailable. Keep the existing UI and
                // show the original execution error below.
            }
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Execute run failed",
            );
        } finally {
            setExecutingRunId(null);
        }
    }

    async function loadRuns(){
        const response = await fetch(apiUrl("/runs"));

        if(!response.ok){
            throw new Error(
                await  getErrorMessage(
                    response,
                    `Load runs failed with ${response.status}`,
                ),
            );
        }
        const runsResponse = (await response.json()) as RunsResponse;
        setRuns(runsResponse.runs);
    }
    async function selectRun(runId:string){
        setError(null);
        setPreview(null);
        setBrowserEval(null);
        setRunReport(null);
        setAgentResult(null);

        try {
            currentRunIdRef.current = runId;
            localStorage.setItem(CURRENT_RUN_ID_STORAGE_KEY, runId);
            localStorage.removeItem(PREVIEW_STORAGE_KEY);

            const response = await fetch(apiUrl(`/runs/${runId}`));
            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Load run failed with ${response.status}`,
                    ),
                );
            }
            const runDetail = (await response.json()) as RunDetailResponse;
            const runIsActive = isRunActive(runDetail.run.status);

            setRun(runDetail.run);
            setAgentResult(runIsActive ? null : (runDetail.result ?? null));
            setBrowserEval(
                runIsActive ? null : (runDetail.result?.browserEval ?? null),
            );
            setVersions(runDetail.versions);
            setGeneratedFiles([]);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            setIterationPrompt(
                runDetail.run.status === "waiting_for_human"
                    ? ""
                    : (runDetail.run.operationPrompt ?? ""),
            );
            setRepairFeedback("");
            setIterationNotice(null);
            setGeneratedFile(null);
            await loadCoordination(runDetail.run.id);
            if (!runIsActive) {
                await loadRunReport(runDetail.run.id);
            }

            if (runDetail.result) {
                await loadGeneratedFileDirectories(runDetail.run.id);
                await loadGeneratedFile(runDetail.run.id, "src/App.tsx");

                if (
                    runDetail.run.status === "waiting_for_human" &&
                    !isTerminalRunWithoutGeneratedOutput({
                        run: runDetail.run,
                        result: runDetail.result,
                        versions: runDetail.versions,
                    })
                ) {
                    await startPreviewForRun(runDetail.run.id);
                }
            }

            if (runIsActive) {
                void monitorActiveRun(runDetail.run.id);
            }
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load run failed",
            );
        }
    }
    async function deleteRun(runToDelete: Run) {
        const shouldDelete = window.confirm(
            `Delete this run?\n\n${runToDelete.goal}`,
        );

        if (!shouldDelete) {
            return;
        }

        setDeletingRunId(runToDelete.id);
        setError(null);

        try {
            const response = await fetch(
                apiUrl(`/runs/${runToDelete.id}`),
                {
                    method: "DELETE",
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Delete run failed with ${response.status}`,
                    ),
                );
            }

            if (run?.id === runToDelete.id) {
                currentRunIdRef.current = null;
                setRun(null);
                setAgentResult(null);
                setGeneratedFiles([]);
                setGeneratedFile(null);
                setPreview(null);
                setBrowserEval(null);
                setRunReport(null);
                setCoordination(null);
                setActivePanel("overview");
                setVersions([]);
                setSelectedVersionNumber(null);
                setPreviewVersionNumber(null);
                setIterationPrompt("");
                localStorage.removeItem(CURRENT_RUN_ID_STORAGE_KEY);
                localStorage.removeItem(PREVIEW_STORAGE_KEY);
            }

            setOpenRunMenuId(null);
            await loadRuns();
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Delete run failed",
            );
        } finally {
            setDeletingRunId(null);
        }
    }
    async function refreshRun(runId: string) {
        const response = await fetch(apiUrl(`/runs/${runId}`));

            if (!response.ok) {
                return;
            }

        const runDetail = (await response.json()) as RunDetailResponse;
        const runIsActive = isRunActive(runDetail.run.status);
        syncRunState(runDetail.run);
        setAgentResult(runIsActive ? null : (runDetail.result ?? null));
        setBrowserEval(
            runIsActive ? null : (runDetail.result?.browserEval ?? null),
        );
        setVersions(runDetail.versions);
        if (runIsActive) {
            setRunReport(null);
        } else {
            await loadRunReport(runId);
        }
    }

    async function cancelRun() {
        if (!run || !isRunActive(run.status) || isCancellingRun) {
            return;
        }

        if (!window.confirm(copy.cancelRunConfirm)) {
            return;
        }

        setIsCancellingRun(true);
        setError(null);

        try {
            const response = await fetchWithTimeout(
                apiUrl(`/runs/${run.id}/cancel`),
                { method: "POST" },
                30_000,
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Cancel run failed with ${response.status}`,
                    ),
                );
            }

            const cancelResponse = (await response.json()) as StartExecuteResponse;
            syncRunState(cancelResponse.run);
            setExecutingRunId(null);
            setIsIterating(false);
            setIsRequestingRepair(false);
            setIterationPrompt(cancelResponse.run.operationPrompt ?? "");
            setIterationNotice(copy.cancelledHelp);
            await loadGeneratedFileDirectories(cancelResponse.run.id);
            await loadGeneratedFile(cancelResponse.run.id, "src/App.tsx");
            await loadRuns();
            if (
                !isTerminalRunWithoutGeneratedOutput({
                    run: cancelResponse.run,
                    result: agentResult,
                    versions,
                })
            ) {
                await startPreviewForRun(cancelResponse.run.id, null);
            } else {
                setPreview(null);
                localStorage.removeItem(PREVIEW_STORAGE_KEY);
            }
        } catch (caughtError) {
            try {
                await refreshRun(run.id);
                await loadRuns();
            } catch {
                // Keep the cancellation error when the API is unavailable.
            }
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Cancel run failed",
            );
        } finally {
            setIsCancellingRun(false);
        }
    }

    async function startPreviewForRun(
        runId: string,
        versionNumber: number | null = null,
    ) {
        const requestedTarget = { runId, versionNumber };

        if (previewStartInFlightRef.current) {
            const activeTarget = previewStartTargetRef.current;
            const queuedTarget = queuedPreviewStartRef.current;
            const matchesTarget = (target: PreviewStartTarget | null) =>
                target?.runId === runId &&
                target.versionNumber === versionNumber;

            if (
                matchesTarget(queuedTarget) ||
                (!queuedTarget && matchesTarget(activeTarget))
            ) {
                return;
            }

            // Keep only the latest distinct request. Advancing the sequence
            // prevents the active request from publishing a stale success.
            queuedPreviewStartRef.current = requestedTarget;
            previewRequestSequenceRef.current += 1;
            setIsStartingPreview(true);
            setError(null);
            return;
        }

        previewStartInFlightRef.current = true;
        previewStartTargetRef.current = requestedTarget;
        const requestSequence = previewRequestSequenceRef.current + 1;
        previewRequestSequenceRef.current = requestSequence;
        setIsStartingPreview(true);
        setError(null);

        try {
            const isCurrentRequest = () =>
                previewRequestSequenceRef.current === requestSequence &&
                currentRunIdRef.current === runId;
            let resolvedVersionNumber = versionNumber;
            let response = await fetchWithTimeout(
                apiUrl(`/runs/${runId}/preview`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(
                        versionNumber === null
                            ? {}
                            : { versionNumber },
                    ),
                },
                PREVIEW_START_REQUEST_TIMEOUT_MS,
            );

            if (response.status === 404 && versionNumber !== null) {
                if (!isCurrentRequest()) {
                    return;
                }

                setSelectedVersionNumber(null);
                setPreviewVersionNumber(null);
                await refreshRun(runId);

                if (!isCurrentRequest()) {
                    return;
                }

                resolvedVersionNumber = null;
                response = await fetchWithTimeout(
                    apiUrl(`/runs/${runId}/preview`),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({}),
                    },
                    PREVIEW_START_REQUEST_TIMEOUT_MS,
                );
            }

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Start preview failed with ${response.status}`,
                    ),
                );
            }

            const previewResponse = (await response.json()) as PreviewResponse;

            if (!isCurrentRequest()) {
                return;
            }

            setPreview(previewResponse.preview);
            setPreviewVersionNumber(resolvedVersionNumber);
            setBrowserEval(previewResponse.browserEval ?? null);
            setPreviewRefreshKey((currentKey) => currentKey + 1);
            localStorage.setItem(
                PREVIEW_STORAGE_KEY,
                JSON.stringify(previewResponse.preview),
            );
        } catch (caughtError) {
            if (
                previewRequestSequenceRef.current === requestSequence &&
                currentRunIdRef.current === runId
            ) {
                setError(
                    caughtError instanceof Error
                        ? caughtError.message
                        : "Start preview failed",
                );
            }
        } finally {
            previewStartInFlightRef.current = false;
            previewStartTargetRef.current = null;
            const queuedTarget = queuedPreviewStartRef.current;
            queuedPreviewStartRef.current = null;

            if (
                queuedTarget &&
                currentRunIdRef.current === queuedTarget.runId
            ) {
                void startPreviewForRun(
                    queuedTarget.runId,
                    queuedTarget.versionNumber,
                );
            } else {
                setIsStartingPreview(false);
            }
        }
    }

    async function startPreview(
        versionNumber: number | null = previewVersionNumber,
    ) {
        if (!run) {
            return;
        }

        if (
            versionNumber === null &&
            isTerminalRunWithoutGeneratedOutput({
                run,
                result: agentResult,
                versions,
            })
        ) {
            return;
        }

        await startPreviewForRun(run.id, versionNumber);
    }
    async function approveRun(){
        if(!run){
            return;
        }

        setError(null);

        try{
            const response = await fetchWithTimeout(
                apiUrl(`/runs/${run.id}/approve`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                },
            );
            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Approve run failed with ${response.status}`,
                    ),
                );
            }
            const approveResponse = (await response.json()) as {
                run: Run;
                versions: RunVersion[];
            };
            syncRunState(approveResponse.run);
            setVersions(approveResponse.versions);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            await loadRuns();
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Approve run failed",
            );
        }
    }
    async function requestRepair() {
        if (!run) {
            return;
        }

        const submittedFeedback = repairFeedback.trim();

        if (submittedFeedback.length === 0) {
            setError(
                language === "zh"
                    ? "请先填写修复反馈。"
                    : "Please enter repair feedback first.",
            );
            return;
        }

        setIsRequestingRepair(true);
        setError(null);

        try {
            const response = await fetchWithTimeout(
                apiUrl(`/runs/${run.id}/request-repair`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        feedback: submittedFeedback,
                        background: true,
                    }),
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Request repair failed with ${response.status}`,
                    ),
                );
            }

            const repairResponse = (await response.json()) as StartExecuteResponse;
            syncRunState(repairResponse.run);
            setRepairFeedback("");
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            setAgentResult(null);
            setBrowserEval(null);
            setRunReport(null);
            await loadRuns();
            setActivePanel("preview");
            void monitorActiveRun(repairResponse.run.id);
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Request repair failed",
            );
        } finally {
            setIsRequestingRepair(false);
        }
    }
    async function iterateRun(){
        if(!run||iterationPrompt.trim().length === 0){
            return;
        }
        if (run.status === "waiting_for_human") {
            setError(copy.iterationBlockedForHumanReview);
            return;
        }
        const submittedPrompt = iterationPrompt.trim();
        setIsIterating(true);
        setIterationNotice(null);
        setError(null);
        try {
            const response = await fetchWithTimeout(
                apiUrl(`/runs/${run.id}/iterate`),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt: submittedPrompt,
                        background: true,
                    }),
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Iterate run failed with ${response.status}`,
                    ),
                );
            }

            const iterateResponse = (await response.json()) as StartExecuteResponse;
            syncRunState(iterateResponse.run);
            setIterationNotice(copy.iterationSubmitted);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            setAgentResult(null);
            setBrowserEval(null);
            setRunReport(null);
            await loadRuns();
            setActivePanel("preview");
            void monitorActiveRun(iterateResponse.run.id);
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Iterate run failed",
            );
        } finally {
            setIsIterating(false);
        }
    }
    async function selectVersion(version:RunVersion){
        if(!run){
            return;
        }
        setSelectedVersionNumber(version.versionNumber);
        setPreviewVersionNumber(version.versionNumber);
        setError(null);
        try{
            const response = await fetch(
                apiUrl(
                    `/runs/${run.id}/versions/${version.versionNumber}/files?path=src/App.tsx`,
                ),
            );
            if (!response.ok) {
                throw new Error(`Load version failed with ${response.status}`);
            }
            const fileResponse = (await response.json()) as FileResponse;
            setGeneratedFile(fileResponse);
            await startPreviewForRun(run.id, version.versionNumber);
            setActivePanel("preview");
        } catch(caughtError){
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load version failed",
            );
        }
    }

    async function selectCurrentDraftPreview() {
        if (!run) {
            return;
        }

        setSelectedVersionNumber(null);
        setPreviewVersionNumber(null);
        setError(null);

        try {
            await loadGeneratedFile(run.id, "src/App.tsx");
            await startPreviewForRun(run.id, null);
            setActivePanel("preview");
        } catch (caughtError) {
            setIterationNotice(null);
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load current draft failed",
            );
        }
    }

    async function deleteVersion(version: RunVersion) {
        if (!run || deletingVersionNumber !== null) {
            return;
        }

        if (!window.confirm(copy.deleteVersionConfirm)) {
            return;
        }

        const previousSelectedVersionNumber = selectedVersionNumber;
        const nextSelectedVersionNumber =
            previousSelectedVersionNumber === null ||
            previousSelectedVersionNumber === version.versionNumber
                ? null
                : previousSelectedVersionNumber > version.versionNumber
                  ? previousSelectedVersionNumber - 1
                  : previousSelectedVersionNumber;

        setDeletingVersionNumber(version.versionNumber);
        setError(null);

        try {
            const response = await fetch(
                apiUrl(`/runs/${run.id}/versions/${version.versionNumber}`),
                {
                    method: "DELETE",
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Delete version failed with ${response.status}`,
                    ),
                );
            }

            const deleteResponse = (await response.json()) as {
                versions: RunVersion[];
            };
            setVersions(deleteResponse.versions);
            await loadRunReport(run.id);

            if (nextSelectedVersionNumber === null) {
                setSelectedVersionNumber(null);
                setPreviewVersionNumber(null);
                setPreview(null);
                localStorage.removeItem(PREVIEW_STORAGE_KEY);
                await loadGeneratedFile(run.id, "src/App.tsx");
                return;
            }

            const nextSelectedVersion = deleteResponse.versions.find(
                (candidate) =>
                    candidate.versionNumber === nextSelectedVersionNumber,
            );

            if (nextSelectedVersion) {
                await selectVersion(nextSelectedVersion);
            }
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Delete version failed",
            );
        } finally {
            setDeletingVersionNumber(null);
        }
    }
    async function continueFromVersion(version: RunVersion) {
        if (!run || continuingVersionNumber !== null) {
            return;
        }

        if (!window.confirm(copy.continueFromVersionConfirm)) {
            return;
        }

        setContinuingVersionNumber(version.versionNumber);
        setError(null);

        try {
            const response = await fetch(
                apiUrl(
                    `/runs/${run.id}/versions/${version.versionNumber}/continue`,
                ),
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                },
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Restore version failed with ${response.status}`,
                    ),
                );
            }

            const continueResponse =
                (await response.json()) as ContinueVersionResponse;
            setRun(continueResponse.run);
            setVersions(continueResponse.versions);
            setSelectedVersionNumber(null);
            setPreviewVersionNumber(null);
            setAgentResult(null);
            setBrowserEval(null);
            setGeneratedFile(null);
            setPreview(null);
            localStorage.removeItem(PREVIEW_STORAGE_KEY);
            await loadGeneratedFileDirectories(continueResponse.run.id);
            await loadGeneratedFile(continueResponse.run.id, "src/App.tsx");
            await loadRunReport(continueResponse.run.id);
            await loadRuns();
            await startPreviewForRun(continueResponse.run.id, null);
            setActivePanel("preview");
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Restore version failed",
            );
        } finally {
            setContinuingVersionNumber(null);
        }
    }
    async function fetchGeneratedFiles(runId: string, directory: string) {
        const response = await fetch(
            apiUrl(
                `/runs/${runId}/files?directory=${encodeURIComponent(
                    directory,
                )}`,
            ),
        );

        if (!response.ok) {
            throw new Error(
                await getErrorMessage(
                    response,
                    `Load files failed with ${response.status}`,
                ),
            );
        }

        const fileListResponse = (await response.json()) as FileListResponse;

        return fileListResponse;
    }

    async function loadGeneratedFileDirectories(runId: string) {
        const fileLists = await Promise.all(
            GENERATED_FILE_DIRECTORIES.map(async (directory) => {
                try {
                    return await fetchGeneratedFiles(runId, directory);
                } catch (caughtError) {
                    if (directory === "public/assets") {
                        return {
                            directory,
                            files: [],
                        };
                    }

                    throw caughtError;
                }
            }),
        );

        setGeneratedFiles(
            fileLists.filter((fileList) => fileList.files.length > 0),
        );
    }

    async function loadGeneratedFile(runId: string, filePath: string) {
        if (isImageFilePath(filePath)) {
            setGeneratedFile({
                path: filePath,
                content: "",
            });
            return;
        }

        setIsLoadingFile(true);

        try {
            const response = await fetch(
                apiUrl(
                    `/runs/${runId}/files?path=${encodeURIComponent(filePath)}`,
                ),
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Load file failed with ${response.status}`,
                    ),
                );
            }

            const fileResponse = (await response.json()) as FileResponse;
            setGeneratedFile(fileResponse);
        } finally {
            setIsLoadingFile(false);
        }
    }
    async function loadCoordination(runId:string){
        const response = await fetch(
            apiUrl(`/runs/${runId}/coordination`),
        );
        if (!response.ok) {
            throw new Error(
                await getErrorMessage(
                    response,
                    `Load coordination failed with ${response.status}`,
                ),
            );
        }
        const coordinationResponse =
            (await response.json()) as CoordinationResponse;

        setCoordination(coordinationResponse);
    }

    async function loadRunReport(runId: string) {
        setIsLoadingReport(true);

        try {
            const response = await fetch(
                apiUrl(`/runs/${runId}/report`),
            );

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Load report failed with ${response.status}`,
                    ),
                );
            }

            const reportResponse = (await response.json()) as RunReport;
            setRunReport(reportResponse);
        } finally {
            setIsLoadingReport(false);
        }
    }

    async function waitForRunCompletion(
        runId: string,
    ): Promise<RunDetailResponse> {
        const deadline = Date.now() + RUN_WAIT_TIMEOUT_MS;
        let consecutivePollFailures = 0;

        while (Date.now() < deadline) {
            let response: Response;

            try {
                response = await fetchWithTimeout(
                    apiUrl(`/runs/${runId}`),
                    undefined,
                    RUN_POLL_REQUEST_TIMEOUT_MS,
                );
                consecutivePollFailures = 0;
            } catch (error) {
                consecutivePollFailures += 1;

                if (
                    consecutivePollFailures >=
                    MAX_CONSECUTIVE_RUN_POLL_FAILURES
                ) {
                    throw error;
                }

                await new Promise((resolve) =>
                    setTimeout(resolve, RUN_POLL_INTERVAL_MS),
                );
                continue;
            }

            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Load run failed with ${response.status}`,
                    ),
                );
            }

            const runDetail = (await response.json()) as RunDetailResponse;
            if (currentRunIdRef.current === runId) {
                syncRunState(runDetail.run);
            }

            if (!isRunActive(runDetail.run.status) && runDetail.run.status !== "queued") {
                return runDetail;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, RUN_POLL_INTERVAL_MS),
            );
        }

        throw new Error("Run execution timed out while waiting for completion");
    }

    async function monitorActiveRun(runId: string) {
        try {
            const completedRun = await waitForRunCompletion(runId);

            if (currentRunIdRef.current !== runId) {
                return;
            }

            syncRunState(completedRun.run);
            setAgentResult(completedRun.result ?? null);
            setBrowserEval(completedRun.result?.browserEval ?? null);
            setVersions(completedRun.versions);
            await loadGeneratedFileDirectories(runId);
            await loadGeneratedFile(runId, "src/App.tsx");
            await loadRunReport(runId);
            await loadRuns();

            if (completedRun.run.status === "succeeded") {
                setIterationPrompt("");
            }
            setIterationNotice(null);

            if (
                (completedRun.run.status === "failed" ||
                    completedRun.run.status === "cancelled") &&
                completedRun.run.operationPrompt
            ) {
                setIterationPrompt(completedRun.run.operationPrompt);
            }

            if (completedRun.run.status === "waiting_for_human") {
                setRepairFeedback("");
            }

            if (
                (completedRun.run.status === "waiting_for_human" ||
                    completedRun.run.status === "failed") &&
                !isTerminalRunWithoutGeneratedOutput({
                    run: completedRun.run,
                    result: completedRun.result,
                    versions: completedRun.versions,
                })
            ) {
                setSelectedVersionNumber(null);
                setPreviewVersionNumber(null);
                await startPreviewForRun(runId, null);
            } else if (
                isTerminalRunWithoutGeneratedOutput({
                    run: completedRun.run,
                    result: completedRun.result,
                    versions: completedRun.versions,
                })
            ) {
                setSelectedVersionNumber(null);
                setPreviewVersionNumber(null);
                setPreview(null);
                localStorage.removeItem(PREVIEW_STORAGE_KEY);
            }
        } catch (caughtError) {
            if (currentRunIdRef.current === runId) {
                setError(
                    caughtError instanceof Error
                        ? caughtError.message
                        : "Run monitoring failed",
                );
            }
        }
    }

    function goHome() {
        currentRunIdRef.current = null;
        setRun(null);
        setAgentResult(null);
        setGeneratedFiles([]);
        setGeneratedFile(null);
        setPreview(null);
        setBrowserEval(null);
        setRunReport(null);
        setCoordination(null);
        setActivePanel("overview");
        setVersions([]);
        setSelectedVersionNumber(null);
        setPreviewVersionNumber(null);
        setIterationPrompt("");
        localStorage.removeItem(CURRENT_RUN_ID_STORAGE_KEY);
        localStorage.removeItem(PREVIEW_STORAGE_KEY);
        void loadRuns().catch((caughtError) => {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load runs failed",
            );
        });
    }

    useEffect(() => {
        // A new browser session starts from the home page. A selected run is
        // intentionally not restored after a refresh or a computer restart.
        localStorage.removeItem(CURRENT_RUN_ID_STORAGE_KEY);
        localStorage.removeItem(PREVIEW_STORAGE_KEY);

        void loadRuns().catch((caughtError) => {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                : "Load runs failed",
            );
        });
    }, []);

    useEffect(() => {
        const hasActiveRun = runs.some(
            (historyRun) =>
                isRunActive(historyRun.status) ||
                historyRun.status === "queued",
        );

        if (!hasActiveRun) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void loadRuns().catch((caughtError) => {
                setError(
                    caughtError instanceof Error
                        ? caughtError.message
                        : "Load runs failed",
                );
            });
        }, 2000);

        return () => window.clearInterval(intervalId);
    }, [runs]);
    const displayedCoordination = agentResult?.coordination ?? coordination;
    const displayedActivePanel = SHOW_DEV_PANELS ? activePanel : "overview";
    const recentRunsSection =
        runs.length > 0 ? (
            <section className="result-card">
                <h2>{copy.recentRuns}</h2>
                <div className="run-list">
                    {runs.map((historyRun) => {
                        const latestRequest = getLatestRequestText(historyRun);

                        return (
                            <article
                                className={
                                    historyRun.id === run?.id
                                        ? "run-list-item active"
                                        : "run-list-item"
                                }
                                key={historyRun.id}
                            >
                                <button
                                    type="button"
                                    className="run-select-button"
                                    onClick={() => void selectRun(historyRun.id)}
                                >
                                    <strong>{historyRun.status}</strong>
                                    <span>{historyRun.goal}</span>
                                    {formatRunOperation(historyRun, language) ? (
                                        <small className="run-progress-message">
                                            {formatRunOperation(
                                                historyRun,
                                                language,
                                            )}
                                        </small>
                                    ) : null}
                                    {latestRequest ? (
                                        <small className="run-pending-request">
                                            <b>
                                                {historyRun.operationPrompt
                                                    ? copy.currentRequest
                                                    : copy.latestSavedVersion}
                                                :
                                            </b>{" "}
                                            {latestRequest}
                                        </small>
                                    ) : null}
                                </button>
                                <div className="run-actions">
                                    <button
                                        type="button"
                                        className="menu-button"
                                        aria-label={copy.openRunActions}
                                        aria-expanded={
                                            openRunMenuId === historyRun.id
                                        }
                                        onClick={() =>
                                            setOpenRunMenuId((currentId) =>
                                                currentId === historyRun.id
                                                    ? null
                                                    : historyRun.id,
                                            )
                                        }
                                    >
                                        ...
                                    </button>
                                    {openRunMenuId === historyRun.id ? (
                                        <div className="run-menu">
                                            <button
                                                type="button"
                                                className="menu-danger-button"
                                                disabled={
                                                    deletingRunId === historyRun.id
                                                }
                                                onClick={() =>
                                                    void deleteRun(historyRun)
                                                }
                                            >
                                                {deletingRunId === historyRun.id
                                                    ? copy.deleting
                                                    : copy.delete}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
        ) : null;

    if (!run) {
        return (
            <main className="landing-shell">
                <header className="top-nav">
                    <div className="brand-mark">
                        <span className="brand-icon">AF</span>
                        <strong>AppForge</strong>
                    </div>
                    <nav className="top-nav-links" aria-label="Landing navigation">
                        <a href="#create">{copy.navHome}</a>
                        <a href="#runs">{copy.navRuns}</a>
                    </nav>
                    <button
                        type="button"
                        className="nav-login"
                        onClick={toggleLanguage}
                    >
                        {copy.languageToggle}
                    </button>
                </header>

                <section className="landing-hero" id="create">
                    <p className="hero-bubble">{copy.heroBadge}</p>
                    <h1>
                        {copy.heroTitleLine1}
                        <br />
                        {copy.heroTitleLine2}
                    </h1>
                    <p className="hero-subtitle">
                        {copy.heroSubtitle}
                    </p>

                    <div className="advantage-grid" aria-label="AppForge advantages">
                        <span>{copy.advantageTrace}</span>
                        <span>{copy.advantageEval}</span>
                        <span>{copy.advantageRepair}</span>
                    </div>

                    <section className="prompt-panel">
                        <label className="landing-prompt">
                            <span>{copy.promptLabel}</span>
                            <textarea
                                value={goal}
                                onChange={(event) => setGoal(event.target.value)}
                                rows={4}
                            />
                        </label>

                        <div className="prompt-footer">
                            <label className="repair-control">
                                <span>{copy.repairAttempts}</span>
                                <input
                                    type="number"
                                    min={0}
                                    max={3}
                                    value={maxRepairAttempts}
                                    onChange={(event) =>
                                        setMaxRepairAttempts(Number(event.target.value))
                                    }
                                />
                            </label>
                            <button
                                type="button"
                                className="start-button"
                                onClick={createRun}
                                disabled={isCreating}
                            >
                                {isCreating ? copy.creating : copy.forgeApp}
                            </button>
                        </div>
                    </section>

                    {error ? <p className="error">{error}</p> : null}
                </section>

                <section className="landing-runs" id="runs">
                    {recentRunsSection}
                </section>
            </main>
        );
    }

    const isCurrentRunExecuting = executingRunId === run.id;
    const currentRunVersions = versions;
    const selectedVersion = selectedVersionNumber
        ? currentRunVersions.find(
              (version) => version.versionNumber === selectedVersionNumber,
          )
        : undefined;
    const terminalRunHasNoGeneratedOutput =
        isTerminalRunWithoutGeneratedOutput({
            run,
            result: agentResult,
            versions: currentRunVersions,
        });
    const hasCurrentDraftPreview = [
        "running",
        "repairing",
        "waiting_for_human",
        "failed",
        "cancelled",
    ].includes(run.status) && !terminalRunHasNoGeneratedOutput;
    const currentPreviewIsDraft =
        selectedVersionNumber === null && hasCurrentDraftPreview;
    const latestRunVersion = currentRunVersions[currentRunVersions.length - 1];
    const displayedRunGoal =
        selectedVersion?.goal ??
        (currentPreviewIsDraft
            ? getLatestPromptBlock(run.operationPrompt)
            : undefined) ??
        latestRunVersion?.goal ??
        run.goal;
    const pendingRepairRequest =
        run.status === "waiting_for_human"
            ? (getLatestPromptBlock(run.operationPrompt) ?? displayedRunGoal)
            : undefined;
    const currentReview =
        selectedVersionNumber !== null
            ? selectedVersion?.review
            : run.status === "succeeded"
              ? (latestRunVersion?.review ??
                  (agentResult?.review?.accepted ? agentResult.review : undefined))
              : agentResult?.review;
    const displayedReview =
        currentReview?.accepted || SHOW_DEV_PANELS ? currentReview : undefined;
    const reviewForDisposition = currentReview;
    const runProgress = getRunProgress({
        run,
        result: agentResult,
        versions: currentRunVersions,
        language,
    });
    const reviewDisposition = getReviewDispositionView({
        run,
        review: reviewForDisposition,
        result: agentResult,
        versions: currentRunVersions,
        selectedVersionNumber,
        language,
    });
    const displayedRunFailureReason =
        run.errorMessage ??
        agentResult?.agent.errorMessage ??
        copy.noGeneratedOutput;
    const shouldShowRunFailureReason =
        terminalRunHasNoGeneratedOutput ||
        (run.status === "failed" &&
            !isReviewerOnlyFailureMessage(run.errorMessage));
    const previewStatusText = terminalRunHasNoGeneratedOutput
        ? copy.noGeneratedOutput
        : previewVersionNumber
          ? `${copy.previewingVersion} v${previewVersionNumber}`
          : currentPreviewIsDraft
            ? copy.previewingDraft
            : copy.previewingLatest;
    const hasInspectablePreviewOutput =
        !terminalRunHasNoGeneratedOutput &&
        (selectedVersionNumber !== null ||
            currentRunVersions.length > 0 ||
            hasSuccessfulWorkspaceChange(agentResult) ||
            run.status === "waiting_for_human" ||
            isRunActive(run.status));
    const canShowPreviewFrame = preview !== null && hasInspectablePreviewOutput;
    const previewButtonText = terminalRunHasNoGeneratedOutput
        ? copy.executionUnavailable
        : isStartingPreview
          ? copy.starting
          : preview
            ? previewVersionNumber
                ? `${copy.refreshPreview} v${previewVersionNumber}`
                : copy.refreshPreview
            : copy.startPreview;
    const canExecuteCurrentRun =
        run.status === "queued" ||
        run.status === "failed" ||
        run.status === "cancelled" ||
        (run.status === "waiting_for_human" &&
            terminalRunHasNoGeneratedOutput);
    const fallbackPages = getFallbackPages(agentResult);
    const runMetrics = agentResult?.metrics;
    const requirementResults = agentResult?.requirements ?? [];
    const workspaceDiff = agentResult?.workspaceDiff;
    const focusedEditScope = agentResult?.focusedEditScope;
    const scopeViolations = agentResult?.scopeViolations ?? [];
    const selectedDesignVersion = selectedVersionNumber === null
        ? null
        : currentRunVersions.find(
              (version) => version.versionNumber === selectedVersionNumber,
          ) ?? null;
    const displayedDesignPlan =
        selectedDesignVersion?.designPlan ?? agentResult?.designPlan;
    const displayedDesignPlanSource =
        selectedDesignVersion?.designPlanSource ?? agentResult?.designPlanSource;

    return (
        <main className="app-shell workspace-shell">
            <header className="workspace-topbar">
                <button
                    type="button"
                    className="secondary-button back-button"
                    onClick={goHome}
                >
                    {copy.back}
                </button>
                <div>
                    <p className="eyebrow">{copy.runWorkspace}</p>
                    <h1>{SHOW_DEV_PANELS ? copy.buildConsole : copy.appWorkspace}</h1>
                </div>
                <button
                    type="button"
                    className="nav-login language-switch"
                    onClick={toggleLanguage}
                >
                    {copy.languageToggle}
                </button>
                <span className={formatStatusClass(run.status)}>{run.status}</span>
            </header>

            <section className="workspace-grid">
                <aside className="workspace-sidebar history-sidebar">
                    <section className="workspace-card">
                        <h2>{copy.versionHistory}</h2>
                        <p className="muted-text">
                            {copy.versionHelp}
                        </p>
                        <div className="history-list">
                            {hasCurrentDraftPreview ? (
                                <article
                                    className={
                                        currentPreviewIsDraft
                                            ? "history-item draft-history-item active"
                                            : "history-item draft-history-item"
                                    }
                                >
                                    <button
                                        type="button"
                                        className="history-select-button"
                                        onClick={() =>
                                            void selectCurrentDraftPreview()
                                        }
                                    >
                                        <span>{copy.draftPreview}</span>
                                        <strong>{copy.draftPreviewStatus}</strong>
                                        <small>{copy.draftPreviewBody}</small>
                                    </button>
                                </article>
                            ) : null}
                            {currentRunVersions.length > 0 ? (
                                currentRunVersions.map((version) => (
                                    <article
                                        className={
                                            selectedVersionNumber === version.versionNumber
                                                ? "history-item active"
                                                : "history-item"
                                        }
                                        key={version.id}
                                    >
                                        <button
                                            type="button"
                                            className="history-select-button"
                                            onClick={() => void selectVersion(version)}
                                        >
                                            <span>v{version.versionNumber}</span>
                                            <small>{new Date(version.createdAt).toLocaleString()}</small>
                                        </button>
                                        <div className="version-actions">
                                            <button
                                                type="button"
                                                className="version-continue-button"
                                                onClick={() => void continueFromVersion(version)}
                                                disabled={
                                                    continuingVersionNumber !== null ||
                                                    deletingVersionNumber !== null
                                                }
                                            >
                                                {continuingVersionNumber === version.versionNumber
                                                    ? copy.restoringVersion
                                                    : copy.continueFromVersion}
                                            </button>
                                            <button
                                                type="button"
                                                className="version-delete-button"
                                                onClick={() => void deleteVersion(version)}
                                                disabled={
                                                    deletingVersionNumber !== null ||
                                                    continuingVersionNumber !== null
                                                }
                                            >
                                                {deletingVersionNumber === version.versionNumber
                                                    ? copy.deleting
                                                    : copy.delete}
                                            </button>
                                        </div>
                                    </article>
                                ))
                            ) : currentPreviewIsDraft ? null : (
                                <article className="history-item active">
                                    <span>v1</span>
                                    <strong>{copy.draftRunCreated}</strong>
                                    <small>{copy.waitingFirstExecution}</small>
                                </article>
                            )}
                        </div>
                    </section>

                    <section className="workspace-card current-run-card">
                        <div className="card-heading-row">
                            <h2>{copy.run}</h2>
                            <span className={formatStatusClass(run.status)}>
                                {run.status}
                            </span>
                        </div>
                        <p className="run-goal-preview" title={displayedRunGoal}>
                            {displayedRunGoal}
                        </p>
                        <div className="run-progress-card">
                            <div className="run-progress-header">
                                <strong>{runProgress.label}</strong>
                                <span>
                                    {runProgress.live
                                        ? runProgress.elapsed
                                        : `${runProgress.value}%`}
                                </span>
                            </div>
                            <div
                                className={
                                    runProgress.live
                                        ? "run-progress-track live"
                                        : "run-progress-track"
                                }
                                aria-label={runProgress.label}
                                aria-valuemax={100}
                                aria-valuemin={0}
                                aria-valuenow={
                                    runProgress.live
                                        ? undefined
                                        : runProgress.value
                                }
                                role="progressbar"
                            >
                                <span
                                    style={
                                        runProgress.live
                                            ? undefined
                                            : {
                                                  width: `${runProgress.value}%`,
                                              }
                                    }
                                />
                            </div>
                            <p>{runProgress.detail}</p>
                        </div>
                        <div
                            className={`review-disposition-card ${reviewDisposition.tone}`}
                        >
                            <strong>{reviewDisposition.title}</strong>
                            <p>{reviewDisposition.detail}</p>
                        </div>
                        {formatRunOperation(run, language) ? (
                            <p className="run-progress-message">
                                {formatRunOperation(run, language)}
                            </p>
                        ) : null}
                        {run.operationPrompt ? (
                            <p className="run-pending-request">
                                {language === "zh" ? "本次需求：" : "Current request: "}
                                {run.operationPrompt}
                            </p>
                        ) : null}
                        {currentRunVersions.length > 0 ? (
                            <p
                                className="run-latest-request"
                                title={
                                    currentRunVersions[currentRunVersions.length - 1].goal
                                }
                            >
                                {copy.latestSavedVersion}:{" "}
                                {currentRunVersions[currentRunVersions.length - 1].goal}
                            </p>
                        ) : null}
                        {SHOW_DEV_PANELS ? (
                            <p className="run-short-id">#{run.id.slice(0, 8)}</p>
                        ) : null}
                        {isRunActive(run.status) || isCurrentRunExecuting ? (
                            <div className="button-row">
                                <button type="button" disabled>
                                    {run.status === "repairing"
                                        ? copy.agentRepairing
                                        : copy.agentRunning}
                                </button>
                                <button
                                    type="button"
                                    className="cancel-run-button"
                                    onClick={() => void cancelRun()}
                                    disabled={isCancellingRun}
                                >
                                    {isCancellingRun
                                        ? copy.cancellingRun
                                        : copy.cancelRun}
                                </button>
                            </div>
                        ) : canExecuteCurrentRun ? (
                            <button
                                type="button"
                                onClick={executeRun}
                                disabled={!canExecuteCurrentRun}
                            >
                                {copy.executeRun}
                            </button>
                        ) : (
                            <p className="run-state-message">
                                {run.status === "succeeded"
                                    ? copy.completed
                                    : run.status === "waiting_for_human"
                                      ? copy.needsReview
                                      : copy.executionUnavailable}
                            </p>
                        )}
                    </section>

                    {run.status === "waiting_for_human" &&
                    !terminalRunHasNoGeneratedOutput ? (
                        <section className="workspace-card human-review-notice">
                            <h2>{copy.humanReview}</h2>
                            <p>
                                {copy.humanReviewHelp}
                            </p>
                            {pendingRepairRequest ? (
                                <div className="pending-repair-request">
                                    <strong>{copy.pendingRepairRequest}</strong>
                                    <p>{pendingRepairRequest}</p>
                                </div>
                            ) : null}
                            <label className="field">
                                <span>{copy.repairFeedback}</span>
                                <textarea
                                    value={repairFeedback}
                                    onChange={(event) =>
                                        setRepairFeedback(event.target.value)
                                    }
                                    rows={4}
                                />
                            </label>
                            <div className="button-row">
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={approveRun}
                                >
                                    {copy.approve}
                                </button>
                                <button
                                    type="button"
                                    onClick={requestRepair}
                                    disabled={isRequestingRepair}
                                >
                                    {isRequestingRepair
                                        ? copy.repairing
                                        : copy.requestRepair}
                                </button>
                            </div>
                        </section>
                    ) : null}

                    {error ? <p className="error">{error}</p> : null}
                </aside>

                <section className="workspace-preview">
                    <div className="preview-toolbar">
                        <div>
                            <h2>{copy.livePreview}</h2>
                            <p className="muted-text">
                                {previewStatusText}
                            </p>
                            {preview && !terminalRunHasNoGeneratedOutput ? (
                                <span className="muted-text">{copy.previewReady}</span>
                            ) : (
                                <span className="muted-text">
                                    {copy.noPreviewServer}
                                </span>
                            )}
                        </div>
                          <button
                              type="button"
                          onClick={() => void startPreview()}
                          disabled={
                              isStartingPreview || terminalRunHasNoGeneratedOutput
                          }
                      >
                              {previewButtonText}
                        </button>
                    </div>
                    {canShowPreviewFrame ? (
                        <iframe
                            key={previewRefreshKey}
                            title={copy.generatedPreviewTitle}
                            src={preview.url}
                            className="preview-frame workspace-preview-frame"
                        />
                    ) : (
                        <div className="preview-empty-state">
                            <h3>
                                {terminalRunHasNoGeneratedOutput
                                    ? copy.executionUnavailable
                                    : copy.previewEmptyTitle}
                            </h3>
                            <p>
                                {terminalRunHasNoGeneratedOutput
                                    ? displayedRunFailureReason
                                    : copy.previewEmptyBody}
                            </p>
                        </div>
                    )}
                    {SHOW_DEV_PANELS && browserEval ? (
                        <section className="browser-checks">
                            <div className="browser-checks-heading">
                                <div>
                                    <h3>{copy.browserChecks}</h3>
                                    <p>{copy.browserChecksHelp}</p>
                                </div>
                                <span
                                    className={
                                        browserEval.passed
                                            ? "browser-check-summary passed"
                                            : "browser-check-summary failed"
                                    }
                                >
                                    {
                                        browserEval.checks.filter(
                                            (check) => check.passed,
                                        ).length
                                    }
                                    /{browserEval.checks.length} {copy.passed}
                                </span>
                            </div>
                            <div className="browser-check-grid">
                                {browserEval.checks.map((check) => (
                                    <article
                                        className={
                                            check.passed
                                                ? "browser-check-card passed"
                                                : "browser-check-card failed"
                                        }
                                        key={check.name}
                                    >
                                        <span>
                                            {check.passed ? copy.pass : copy.fail}
                                        </span>
                                        <strong>{check.name}</strong>
                                        {check.message ? <p>{check.message}</p> : null}
                                    </article>
                                ))}
                            </div>
                            {browserEval.visualReport ? (
                                <div className="visual-viewport-report">
                                    <div className="visual-viewport-heading">
                                        <strong>Visual Evaluation / 多视口</strong>
                                        <span
                                            className={
                                                browserEval.visualReport.passed
                                                    ? "browser-check-summary passed"
                                                    : "browser-check-summary failed"
                                            }
                                        >
                                            {browserEval.visualReport.viewports.filter(
                                                (viewport) => viewport.passed,
                                            ).length}
                                            /{browserEval.visualReport.viewports.length}{" "}
                                            {copy.passed}
                                        </span>
                                    </div>
                                    <div className="visual-viewport-grid">
                                        {browserEval.visualReport.viewports.map(
                                            (viewport) => (
                                                <article
                                                    className={
                                                        viewport.passed
                                                            ? "visual-viewport-card passed"
                                                            : "visual-viewport-card failed"
                                                    }
                                                    key={viewport.viewport.id}
                                                >
                                                    <div>
                                                        <strong>
                                                            {viewport.viewport.width}×
                                                            {viewport.viewport.height}
                                                        </strong>
                                                        <span>
                                                            {viewport.passed
                                                                ? copy.pass
                                                                : copy.fail}
                                                        </span>
                                                    </div>
                                                    <dl>
                                                        <div>
                                                            <dt>overflow</dt>
                                                            <dd>
                                                                {
                                                                    viewport.metrics
                                                                        .pageOverflowPx
                                                                }
                                                                px
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt>overlap</dt>
                                                            <dd>
                                                                {
                                                                    viewport.metrics
                                                                        .criticalOverlapCount
                                                                }
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt>contrast</dt>
                                                            <dd>
                                                                {
                                                                    viewport.metrics
                                                                        .lowContrastCount
                                                                }
                                                                /
                                                                {
                                                                    viewport.metrics
                                                                        .contrastSampleCount
                                                                }
                                                            </dd>
                                                        </div>
                                                        <div>
                                                            <dt>targets</dt>
                                                            <dd>
                                                                {
                                                                    viewport.metrics
                                                                        .undersizedControlCount
                                                                }
                                                                /
                                                                {
                                                                    viewport.metrics
                                                                        .controlCount
                                                                }
                                                            </dd>
                                                        </div>
                                                    </dl>
                                                </article>
                                            ),
                                        )}
                                    </div>
                                </div>
                            ) : null}
                        </section>
                    ) : null}
                    {run.status === "waiting_for_human" &&
                    !terminalRunHasNoGeneratedOutput ? (
                        <div className="iteration-box muted-iteration-box">
                            <p className="muted-text">
                                {copy.iterationBlockedForHumanReview}
                            </p>
                        </div>
                    ) : (
                        <div className="iteration-box">
                            <textarea
                                value={iterationPrompt}
                                onChange={(event) =>
                                    setIterationPrompt(event.target.value)
                                }
                                placeholder={copy.iterationPlaceholder}
                                rows={3}
                            />
                            <div className="iteration-actions">
                                <span className="muted-text">
                                    {iterationNotice ?? copy.iterationHelp}
                                </span>
                                <button
                                    type="button"
                                    onClick={iterateRun}
                                    disabled={
                                        !run ||
                                        isIterating ||
                                        iterationPrompt.trim().length === 0 ||
                                        isRunActive(run.status)
                                    }
                                >
                                    {isIterating ? copy.iterating : copy.sendIteration}
                                </button>
                            </div>
                        </div>
                    )}
                </section>

                <aside className="workspace-inspector">
                    <nav className="panel-tabs inspector-tabs" aria-label={copy.runSections}>
                        <button
                            type="button"
                            className={displayedActivePanel === "overview" ? "active" : ""}
                            onClick={() => setActivePanel("overview")}
                        >
                            {copy.overview}
                        </button>
                        {SHOW_DEV_PANELS ? (
                            <>
                                <button
                                    type="button"
                                    className={displayedActivePanel === "plan" ? "active" : ""}
                                    onClick={() => setActivePanel("plan")}
                                >
                                    {copy.plan}
                                </button>
                                <button
                                    type="button"
                                    className={displayedActivePanel === "trace" ? "active" : ""}
                                    onClick={() => setActivePanel("trace")}
                                >
                                    {copy.trace}
                                </button>
                                <button
                                    type="button"
                                    className={displayedActivePanel === "report" ? "active" : ""}
                                    onClick={() => setActivePanel("report")}
                                >
                                    {copy.report}
                                </button>
                                <button
                                    type="button"
                                    className={displayedActivePanel === "files" ? "active" : ""}
                                    onClick={() => setActivePanel("files")}
                                >
                                    {copy.files}
                                </button>
                            </>
                        ) : null}
                    </nav>

                    {displayedActivePanel === "overview" ? (
                        <section className="workspace-card">
                            <h2>{copy.overview}</h2>
                            <p>
                                <strong>{copy.status}:</strong> {run.status}
                            </p>
                            {fallbackPages.length > 0 ? (
                                <div className="fallback-warning">
                                    <strong>本地兜底草稿</strong>
                                    <p>
                                        该页面的模型输出无效，目前展示的是本地兜底草稿。
                                    </p>
                                    <ul>
                                        {fallbackPages.map((page) => (
                                            <li key={page}>{page}</li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                            {shouldShowRunFailureReason ? (
                                <div className="error">
                                    <strong>{copy.failureReason}:</strong>{" "}
                                    {displayedRunFailureReason}
                                </div>
                            ) : null}
                            {agentResult || selectedVersionNumber !== null ? (
                                <>
                                    {!terminalRunHasNoGeneratedOutput ? (
                                        <p className="muted-text">
                                            {copy.resultReady}
                                        </p>
                                    ) : null}
                                    <div
                                        className={`review-disposition-card ${reviewDisposition.tone}`}
                                    >
                                        <strong>{reviewDisposition.title}</strong>
                                        <p>{reviewDisposition.detail}</p>
                                    </div>
                                    {displayedReview ? (
                                        <div
                                            className={
                                                displayedReview.accepted
                                                    ? "review-summary accepted"
                                                    : "review-summary rejected"
                                            }
                                        >
                                            <strong>{copy.review}:</strong>{" "}
                                            {displayedReview.accepted
                                                ? copy.pass
                                                : copy.fail}
                                            <p>
                                                {formatReviewReason(
                                                    displayedReview.reason,
                                                    language,
                                                )}
                                            </p>
                                            <ul className="review-check-list">
                                                {getReviewChecks(
                                                    displayedReview,
                                                    language,
                                                ).map((check) => (
                                                    <li
                                                        className={
                                                            check.passed
                                                                ? "passed"
                                                                : "failed"
                                                        }
                                                        key={check.label}
                                                    >
                                                        <span>{check.label}</span>
                                                        <strong>
                                                            {check.passed
                                                                ? copy.pass
                                                                : copy.fail}
                                                        </strong>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : selectedVersionNumber !== null ? (
                                        <p className="muted-text">
                                            {copy.versionReviewUnavailable}
                                        </p>
                                    ) : null}
                                    <DesignPlanPanel
                                        designPlan={displayedDesignPlan}
                                        source={displayedDesignPlanSource}
                                        compliance={
                                            agentResult?.designPlanCompliance
                                        }
                                        language={language}
                                    />
                                    {requirementResults.length > 0 ? (
                                        <div className="requirement-ledger">
                                            <h3>Requirement Ledger</h3>
                                            <div className="requirement-list">
                                                {requirementResults.map(
                                                    (requirement) => (
                                                        <article
                                                            className={
                                                                requirement.status ===
                                                                "PASS"
                                                                    ? "requirement-row passed"
                                                                    : requirement.status ===
                                                                        "FAIL"
                                                                      ? "requirement-row failed"
                                                                      : "requirement-row unverified"
                                                            }
                                                            key={requirement.id}
                                                        >
                                                            <div>
                                                                <strong>
                                                                    {requirement.id} ·{" "}
                                                                    {
                                                                        requirement.priority
                                                                    }
                                                                </strong>
                                                                <p>
                                                                    {
                                                                        requirement.instruction
                                                                    }
                                                                </p>
                                                                <small>
                                                                    {
                                                                        requirement.evidence
                                                                    }
                                                                </small>
                                                                {requirement
                                                                    .affectedSelectorsOrComponents
                                                                    .length >
                                                                0 ? (
                                                                    <small>
                                                                        Selectors/components:{" "}
                                                                        {requirement.affectedSelectorsOrComponents.join(
                                                                            ", ",
                                                                        )}
                                                                    </small>
                                                                ) : null}
                                                                {requirement.evidences.length >
                                                                0 ? (
                                                                    <ul className="requirement-evidence-list">
                                                                        {requirement.evidences.map(
                                                                            (
                                                                                evidence,
                                                                                index,
                                                                            ) => (
                                                                                <li
                                                                                    key={`${requirement.id}-evidence-${index}`}
                                                                                >
                                                                                    <code>
                                                                                        {
                                                                                            evidence.source
                                                                                        }
                                                                                    </code>
                                                                                    {evidence.file
                                                                                        ? ` ${evidence.file}`
                                                                                        : ""}
                                                                                    {evidence.selector
                                                                                        ? ` ${evidence.selector}`
                                                                                        : ""}
                                                                                    {evidence.property
                                                                                        ? ` ${evidence.property}`
                                                                                        : ""}
                                                                                    {evidence.expected
                                                                                        ? ` expected=${evidence.expected}`
                                                                                        : ""}
                                                                                    {evidence.actual
                                                                                        ? ` actual=${evidence.actual}`
                                                                                        : ""}
                                                                                    {evidence.unexpectedFiles
                                                                                        ?.length
                                                                                        ? ` unexpected=${evidence.unexpectedFiles.join(", ")}`
                                                                                        : ""}
                                                                                    {evidence.unexpectedRanges
                                                                                        ?.length
                                                                                        ? ` ranges=${evidence.unexpectedRanges
                                                                                              .map(
                                                                                                  (
                                                                                                      range,
                                                                                                  ) =>
                                                                                                      `${range.file}:${range.startLine}-${range.endLine}`,
                                                                                              )
                                                                                              .join(", ")}`
                                                                                        : ""}
                                                                                    {evidence.afterElement
                                                                                        ? ` snapshot=${evidence.afterElement.selector} ${evidence.afterElement.viewport.width}x${evidence.afterElement.viewport.height} visible=${String(evidence.afterElement.visible)}${evidence.afterElement.boundingBox ? ` bbox=${Math.round(evidence.afterElement.boundingBox.x)},${Math.round(evidence.afterElement.boundingBox.y)},${Math.round(evidence.afterElement.boundingBox.width)}x${Math.round(evidence.afterElement.boundingBox.height)}` : ""}`
                                                                                        : ""}
                                                                                </li>
                                                                            ),
                                                                        )}
                                                                    </ul>
                                                                ) : null}
                                                            </div>
                                                            <span>
                                                                {
                                                                    requirement.status
                                                                }
                                                            </span>
                                                        </article>
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                    {runMetrics ? (
                                        <div className="run-metrics">
                                            <h3>Run Metrics</h3>
                                            <dl>
                                                <div>
                                                    <dt>Planner calls</dt>
                                                    <dd>
                                                        {
                                                            runMetrics.plannerCalls
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>
                                                        Design Planner calls
                                                    </dt>
                                                    <dd>
                                                        {
                                                            runMetrics.designPlannerCalls ??
                                                            0
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Coding calls</dt>
                                                    <dd>
                                                        {
                                                            runMetrics.codingCalls
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Reviewer calls</dt>
                                                    <dd>
                                                        {
                                                            runMetrics.reviewerCalls
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Retry calls</dt>
                                                    <dd>
                                                        {
                                                            runMetrics.retryCalls
                                                        }
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Total</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.totalDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Planner</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.plannerDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Design Planner</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.designPlannerDurationMs ??
                                                                0,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Coding</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.codingDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Install</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.installDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Build</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.buildDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Evaluation</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.evaluationDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Reviewer</dt>
                                                    <dd>
                                                        {formatDurationMs(
                                                            runMetrics.reviewerDurationMs,
                                                        )}
                                                    </dd>
                                                </div>
                                            </dl>
                                            <p className="muted-text">
                                                Dependency manifest changed:{" "}
                                                {runMetrics.dependencyManifestChanged
                                                    ? copy.yes
                                                    : copy.no}
                                            </p>
                                            {runMetrics.modifiedFiles.length >
                                            0 ? (
                                                <p className="muted-text">
                                                    Modified files:{" "}
                                                    {runMetrics.modifiedFiles.join(
                                                        ", ",
                                                    )}
                                                </p>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {focusedEditScope ? (
                                        <div className="run-metrics">
                                            <h3>Focused Edit Scope</h3>
                                            <p className="muted-text">
                                                Mode:{" "}
                                                {agentResult?.executionMode ??
                                                    "unknown"}{" "}
                                                · Intent:{" "}
                                                {focusedEditScope.intent} ·
                                                Confidence:{" "}
                                                {focusedEditScope.confidence.toFixed(
                                                    2,
                                                )}
                                            </p>
                                            <p className="muted-text">
                                                Allowed files:{" "}
                                                {focusedEditScope.allowedFiles.join(
                                                    ", ",
                                                ) || "none"}
                                            </p>
                                            <p className="muted-text">
                                                Allowed selectors/components:{" "}
                                                {focusedEditScope.allowedSelectorsOrComponents.join(
                                                    ", ",
                                                ) || "none"}
                                            </p>
                                            {focusedEditScope.allowedRanges
                                                .length > 0 ? (
                                                <ul className="diagnostic-list">
                                                    {focusedEditScope.allowedRanges.map(
                                                        (range, index) => (
                                                            <li
                                                                key={`${range.file}-${range.startOffset}-${index}`}
                                                            >
                                                                <code>
                                                                    {range.file}
                                                                </code>{" "}
                                                                lines{" "}
                                                                {
                                                                    range.startLine
                                                                }
                                                                –
                                                                {range.endLine} ·{" "}
                                                                {range.kind}
                                                                {range.selector
                                                                    ? ` · ${range.selector}`
                                                                    : ""}
                                                                {range.symbol
                                                                    ? ` · ${range.symbol}`
                                                                    : ""}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            ) : (
                                                <p className="muted-text">
                                                    Allowed ranges: none
                                                    resolved
                                                </p>
                                            )}
                                            {scopeViolations.length > 0 ? (
                                                <div className="requirement-evidence-list">
                                                    <p>
                                                        Scope violations:
                                                    </p>
                                                    <ul>
                                                        {scopeViolations.map(
                                                            (
                                                                violation,
                                                                index,
                                                            ) => (
                                                                <li
                                                                    key={`${violation.file}-${violation.action}-${index}`}
                                                                >
                                                                    <code>
                                                                        {
                                                                            violation.file
                                                                        }
                                                                    </code>{" "}
                                                                    {
                                                                        violation.action
                                                                    }
                                                                    :{" "}
                                                                    {
                                                                        violation.reason
                                                                    }
                                                                </li>
                                                            ),
                                                        )}
                                                    </ul>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : agentResult?.executionMode ? (
                                        <div className="run-metrics">
                                            <h3>Execution Mode</h3>
                                            <p className="muted-text">
                                                {agentResult.executionMode}
                                            </p>
                                        </div>
                                    ) : null}
                                    {workspaceDiff ? (
                                        <div className="run-metrics">
                                            <h3>Workspace Diff</h3>
                                            <p className="muted-text">
                                                Added:{" "}
                                                {workspaceDiff.addedFiles.join(
                                                    ", ",
                                                ) || "none"}
                                            </p>
                                            <p className="muted-text">
                                                Modified:{" "}
                                                {workspaceDiff.modifiedFiles.join(
                                                    ", ",
                                                ) || "none"}
                                            </p>
                                            <p className="muted-text">
                                                Deleted:{" "}
                                                {workspaceDiff.deletedFiles.join(
                                                    ", ",
                                                ) || "none"}
                                            </p>
                                            {workspaceDiff.changedRanges.length >
                                            0 ? (
                                                <ul className="requirement-evidence-list">
                                                    {workspaceDiff.changedRanges.map(
                                                        (range) => (
                                                            <li
                                                                key={`${range.file}-${range.beforeStartLine}-${range.afterStartLine}`}
                                                            >
                                                                {range.file}: before{" "}
                                                                {
                                                                    range.beforeStartLine
                                                                }
                                                                -
                                                                {
                                                                    range.beforeEndLine
                                                                }
                                                                , after{" "}
                                                                {
                                                                    range.afterStartLine
                                                                }
                                                                -
                                                                {
                                                                    range.afterEndLine
                                                                }
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {SHOW_DEV_PANELS && displayedCoordination ? (
                                        <div className="multi-agent-summary">
                                            <h3>{copy.multiAgentFlow}</h3>
                                            <p>{copy.multiAgentHelp}</p>
                                            <div className="agent-assignment-list">
                                                {displayedCoordination.assignments.map(
                                                    (assignment) => (
                                                        <article key={assignment.role}>
                                                            <strong>{assignment.role}</strong>
                                                            <span>{assignment.task}</span>
                                                        </article>
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                    {SHOW_DEV_PANELS && agentResult ? (
                                        <>
                                            <p>
                                                <strong>{copy.finished}:</strong>{" "}
                                                {agentResult.agent.finished
                                                    ? copy.yes
                                                    : copy.no}
                                            </p>
                                            <p>
                                                <strong>{copy.build}:</strong> exit code{" "}
                                                {agentResult.build.exitCode}
                                            </p>
                                            {agentResult.eval ? (
                                                <p>
                                                    <strong>{copy.eval}:</strong>{" "}
                                                    {
                                                        agentResult.eval.checks.filter(
                                                            (check) => check.passed,
                                                        ).length
                                                    }
                                                    /{agentResult.eval.checks.length}{" "}
                                                    {copy.checksPassed}
                                                </p>
                                            ) : null}
                                            {browserEval ? (
                                                <p>
                                                    <strong>{copy.browser}:</strong>{" "}
                                                    {
                                                        browserEval.checks.filter(
                                                            (check) => check.passed,
                                                        ).length
                                                    }
                                                    /{browserEval.checks.length}{" "}
                                                    {copy.checksPassed}
                                                </p>
                                            ) : null}
                                        </>
                                    ) : null}
                                </>
                            ) : (
                                <p className="muted-text">
                                    {copy.runDetailsPending}
                                </p>
                            )}
                        </section>
                    ) : null}

                    {SHOW_DEV_PANELS && displayedCoordination && displayedActivePanel === "plan" ? (
                        <section className="workspace-card">
                            <h2>{copy.agentPlan}</h2>
                            <ol className="plan-list">
                                {displayedCoordination.plan.map((step) => (
                                    <li key={step}>{step}</li>
                                ))}
                            </ol>
                            {displayedCoordination.assignments.map((assignment) => (
                                <article className="step-card" key={assignment.role}>
                                    <h3>{assignment.role}</h3>
                                    <p>{assignment.task}</p>
                                </article>
                            ))}
                        </section>
                    ) : null}

                    {SHOW_DEV_PANELS && displayedActivePanel === "trace" ? (
                        <section className="workspace-card">
                            <h2>{copy.trace}</h2>
                            {agentResult ? (
                                <div className="trace-list">
                                    {getTraceEvents(agentResult).map((event) => {
                                        const attempt = findAttemptForTraceEvent(
                                            agentResult,
                                            event.id,
                                        );

                                        return (
                                            <article className="step-card" key={event.id}>
                                                <h3>{event.label}</h3>
                                                <p>
                                                    <strong>{copy.status}:</strong>{" "}
                                                    {event.status}
                                                </p>
                                                {event.message ? (
                                                    <pre>{event.message}</pre>
                                                ) : null}
                                                {attempt ? (
                                                    <div className="nested-step-list">
                                                        {attempt.agent.steps.map(
                                                            (step, index) => (
                                                                <div
                                                                    className={
                                                                        step.action.type === "get_image"
                                                                            ? "nested-step image-step"
                                                                            : "nested-step"
                                                                    }
                                                                    key={index}
                                                                >
                                                                    <strong>
                                                                        Step {index + 1}:{" "}
                                                                        {step.action.type}
                                                                    </strong>
                                                                    {step.action.type === "get_image" ? (
                                                                        <div className="image-step-card">
                                                                            {(() => {
                                                                                const imageInfo =
                                                                                    parseImageExecutionMessage(
                                                                                        step.execution
                                                                                            .message,
                                                                                    );
                                                                                const imagePath =
                                                                                    imageInfo.savedPath ??
                                                                                    step.action
                                                                                        .outputPath;
                                                                                const imageUrl =
                                                                                    imagePath
                                                                                        ? getPreviewAssetUrl(
                                                                                              preview,
                                                                                              imagePath,
                                                                                          )
                                                                                        : undefined;

                                                                                return (
                                                                                    <>
                                                                                        <p>
                                                                                            <strong>
                                                                                                {copy.path}:
                                                                                            </strong>{" "}
                                                                                            {imagePath ??
                                                                                                "unknown"}
                                                                                        </p>
                                                                                        {step.action.mode ? (
                                                                                            <p>
                                                                                                <strong>
                                                                                                    Mode:
                                                                                                </strong>{" "}
                                                                                                {
                                                                                                    step.action
                                                                                                        .mode
                                                                                                }
                                                                                            </p>
                                                                                        ) : null}
                                                                                        {imageInfo.source ? (
                                                                                            <p>
                                                                                                <strong>
                                                                                                    Source:
                                                                                                </strong>{" "}
                                                                                                {
                                                                                                    imageInfo.source
                                                                                                }
                                                                                            </p>
                                                                                        ) : null}
                                                                                        {imageInfo.attribution ? (
                                                                                            <p>
                                                                                                <strong>
                                                                                                    Attribution:
                                                                                                </strong>{" "}
                                                                                                {
                                                                                                    imageInfo.attribution
                                                                                                }
                                                                                            </p>
                                                                                        ) : null}
                                                                                        {imageInfo.bytes ? (
                                                                                            <p>
                                                                                                <strong>
                                                                                                    Bytes:
                                                                                                </strong>{" "}
                                                                                                {
                                                                                                    imageInfo.bytes
                                                                                                }
                                                                                            </p>
                                                                                        ) : null}
                                                                                        {imageUrl ? (
                                                                                            <img
                                                                                                src={
                                                                                                    imageUrl
                                                                                                }
                                                                                                alt={
                                                                                                    step.action
                                                                                                        .altText ??
                                                                                                    imagePath ??
                                                                                                    copy.imageAsset
                                                                                                }
                                                                                            />
                                                                                        ) : null}
                                                                                    </>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    ) : null}
                                                                    <pre>
                                                                        {
                                                                            step.execution
                                                                                .message
                                                                        }
                                                                    </pre>
                                                                </div>
                                                            ),
                                                        )}
                                                    </div>
                                                ) : null}
                                            </article>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="muted-text">
                                    {copy.agentTracePending}
                                </p>
                            )}
                        </section>
                    ) : null}

                    {SHOW_DEV_PANELS && displayedActivePanel === "report" ? (
                        <section className="workspace-card report-card">
                            <h2>{copy.runReport}</h2>
                            {isLoadingReport ? (
                                <p className="muted-text">{copy.loadingReport}</p>
                            ) : null}
                            {runReport ? (
                                <>
                                    <p className="report-status">
                                        {runReport.statusLine}
                                    </p>
                                    <div className="report-metrics">
                                        <article>
                                            <span>{copy.attempts}</span>
                                            <strong>{runReport.summary.attempts}</strong>
                                        </article>
                                        <article>
                                            <span>{copy.eval}</span>
                                            <strong>
                                                {runReport.summary.evalPassedChecks}/
                                                {runReport.summary.evalTotalChecks}
                                            </strong>
                                        </article>
                                        <article>
                                            <span>{copy.browser}</span>
                                            <strong>
                                                {runReport.summary.browserPassedChecks}/
                                                {runReport.summary.browserTotalChecks}
                                            </strong>
                                        </article>
                                        <article>
                                            <span>{copy.versions}</span>
                                            <strong>{runReport.versions.length}</strong>
                                        </article>
                                    </div>
                                    <h3>{copy.interviewSummary}</h3>
                                    <pre>{runReport.narrative}</pre>
                                    {runReport.summary.reviewReason ? (
                                        <>
                                            <h3>{copy.review}</h3>
                                            <p>{runReport.summary.reviewReason}</p>
                                        </>
                                    ) : null}
                                    {runReport.memory.length > 0 ? (
                                        <>
                                            <h3>{copy.memoryEvidence}</h3>
                                            <div className="report-list">
                                                {runReport.memory.map((memory) => (
                                                    <article key={memory.createdAt}>
                                                        <strong>{memory.outcome}</strong>
                                                        <p>{memory.summary}</p>
                                                    </article>
                                                ))}
                                            </div>
                                        </>
                                    ) : null}
                                </>
                            ) : (
                                <p className="muted-text">
                                    {copy.reportPending}
                                </p>
                            )}
                        </section>
                    ) : null}

                    {SHOW_DEV_PANELS && displayedActivePanel === "files" ? (
                        <section className="workspace-card">
                            <h2>{copy.files}</h2>
                            {generatedFiles.length > 0 ? (
                                <>
                                    {generatedFiles.map((fileList) => (
                                        <div
                                            className="file-group"
                                            key={fileList.directory}
                                        >
                                            <p>
                                                <strong>{copy.directory}:</strong>{" "}
                                                {fileList.directory}
                                            </p>
                                            <div className="file-list">
                                                {fileList.files.map((filePath) => (
                                                    <button
                                                        type="button"
                                                        className={
                                                            isImageFilePath(filePath)
                                                                ? "file-button image-file"
                                                                : "file-button"
                                                        }
                                                        key={filePath}
                                                        onClick={() =>
                                                            void loadGeneratedFile(
                                                                run.id,
                                                                filePath,
                                                            )
                                                        }
                                                    >
                                                        {isImageFilePath(filePath)
                                                            ? "Image "
                                                            : "Code "}
                                                        {filePath}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </>
                            ) : (
                                <p className="muted-text">
                                    {copy.generatedFilesPending}
                                </p>
                            )}
                            {isLoadingFile ? <p>{copy.loadingFile}</p> : null}
                            {generatedFile ? (
                                <>
                                    <p>
                                        <strong>{copy.path}:</strong>{" "}
                                        {generatedFile.path}
                                    </p>
                                    {isImageFilePath(generatedFile.path) ? (
                                        <div className="image-file-preview">
                                            {getPreviewAssetUrl(
                                                preview,
                                                generatedFile.path,
                                            ) ? (
                                                <img
                                                    src={getPreviewAssetUrl(
                                                        preview,
                                                        generatedFile.path,
                                                    )}
                                                    alt={generatedFile.path}
                                                />
                                            ) : (
                                                <p className="muted-text">
                                                    {copy.imagePreviewNeedsServer}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <pre>{generatedFile.content}</pre>
                                    )}
                                </>
                            ) : null}
                        </section>
                    ) : null}
                </aside>
            </section>
        </main>
    );
}
