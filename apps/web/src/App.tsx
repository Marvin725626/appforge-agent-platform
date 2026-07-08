import { useEffect, useRef, useState } from "react";

type Run = {
    id: string;
    goal: string;
    status: string;
    createdAt: string;
};

type AgentStep = {
    action: {
        type: string;
    };
    execution: {
        ok: boolean;
        message: string;
    };
};

type AgentResult = {
    steps: AgentStep[];
    finished: boolean;
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

type BrowserEvalResult = {
    passed: boolean;
    checks: BrowserCheck[];
};

type AgentAttempt = {
    kind: "initial" | "repair";
    agent: AgentResult;
    install: CommandResult;
    build: CommandResult;
    eval: ReactAppEvalResult;
    review: AgentReview;
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
};

type ExecuteResponse = {
    run: Run;
    result: ReactAppAgentResult;
    versions:RunVersion[];
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

type RunDetailResponse = {
    run: Run;
    result?: ReactAppAgentResult;
    versions: RunVersion[];
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
type ActivePanel = "overview" | "plan" | "trace" | "preview" | "files";

type RunVersion = {
    id: string;
    runId: string;
    versionNumber: number;
    goal: string;
    summary: string;
    createdAt: string;
};


const CURRENT_RUN_ID_STORAGE_KEY = "appforge.currentRunId";
const PREVIEW_STORAGE_KEY = "appforge.preview";

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

function formatStatusClass(status: string): string {
    return `status-pill status-${status.replaceAll("_", "-")}`;
}

export function App() {
    const createInFlightRef = useRef(false);
    const [goal, setGoal] = useState(
        "Create a simple React task app with an input and task list",
    );
    const [run, setRun] = useState<Run | null>(null);
    const [runs,setRuns] = useState<Run[]>([]);
    const [agentResult, setAgentResult] = useState<ReactAppAgentResult | null>(
        null,
    );
    const [generatedFiles, setGeneratedFiles] = useState<FileListResponse | null>(
        null,
    );
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
    const [isStartingPreview, setIsStartingPreview] = useState(false);
    const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
    const [coordination, setCoordination] =
        useState<CoordinationResponse | null>(null);
    const [repairFeedback,setRepairFeedback] =  useState(
        "请根据人工反馈继续修复这个应用。",
    );
    const [isRequestingRepair,setIsRequestingRepair] = useState(false);
    const [activePanel, setActivePanel] =
        useState<ActivePanel>("overview");
    const [maxRepairAttempts,setMaxRepairAttempts] = useState(1);
    const [versions,setVersions] = useState<RunVersion[]>([]);
    const [selectedVersionNumber, setSelectedVersionNumber] =
        useState<number | null>(null);
    const [iterationPrompt, setIterationPrompt] = useState("");
    const [isIterating, setIsIterating] = useState(false);
    async function createRun() {
        if (createInFlightRef.current) {
            return;
        }

        createInFlightRef.current = true;
        setIsCreating(true);
        setError(null);
        setRun(null);
        setAgentResult(null);
        setGeneratedFiles(null);
        setGeneratedFile(null);
        setPreview(null);
        setBrowserEval(null);
        setCoordination(null);
        setActivePanel("overview");
        setVersions([]);
        setSelectedVersionNumber(null);
        setIterationPrompt("");
        localStorage.removeItem(PREVIEW_STORAGE_KEY);

        try {
            const response = await fetch("http://127.0.0.1:3000/runs", {
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
            setRun(createdRun);
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

        try {
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${runId}/execute`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        maxRepairAttempts,
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

            const executeResponse = (await response.json()) as ExecuteResponse;
            setRun(executeResponse.run);
            setAgentResult(executeResponse.result);
            setBrowserEval(executeResponse.result.browserEval ?? null);
            setVersions(executeResponse.versions);
            setSelectedVersionNumber(null);
            await loadGeneratedFiles(executeResponse.run.id, "src");
            await loadGeneratedFile(executeResponse.run.id, "src/App.tsx");
            await refreshRun(executeResponse.run.id);
            await loadRuns();
        } catch (caughtError) {
            await refreshRun(runId);
            await loadRuns();
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
        const response = await fetch("http://127.0.0.1:3000/runs");

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

        try {
            localStorage.setItem(CURRENT_RUN_ID_STORAGE_KEY, runId);
            localStorage.removeItem(PREVIEW_STORAGE_KEY);

            const response = await fetch(`http://127.0.0.1:3000/runs/${runId}`);
            if (!response.ok) {
                throw new Error(
                    await getErrorMessage(
                        response,
                        `Load run failed with ${response.status}`,
                    ),
                );
            }
            const runDetail = (await response.json()) as RunDetailResponse;

            setRun(runDetail.run);
            setAgentResult(runDetail.result ?? null);
            setBrowserEval(runDetail.result?.browserEval ?? null);
            setVersions(runDetail.versions);
            setGeneratedFiles(null);
            setSelectedVersionNumber(null);
            setIterationPrompt("");
            setGeneratedFile(null);
            await loadCoordination(runDetail.run.id);

            if (runDetail.result) {
                await loadGeneratedFiles(runDetail.run.id, "src");
                await loadGeneratedFile(runDetail.run.id, "src/App.tsx");
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
                `http://127.0.0.1:3000/runs/${runToDelete.id}`,
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
                setRun(null);
                setAgentResult(null);
                setGeneratedFiles(null);
                setGeneratedFile(null);
                setPreview(null);
                setBrowserEval(null);
                setCoordination(null);
                setActivePanel("overview");
                setVersions([]);
                setSelectedVersionNumber(null);
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
        const response = await fetch(`http://127.0.0.1:3000/runs/${runId}`);

        if (!response.ok) {
            return;
        }

        const runDetail = (await response.json()) as RunDetailResponse;
        setRun(runDetail.run);
        setAgentResult(runDetail.result ?? null);
        setBrowserEval(runDetail.result?.browserEval ?? null);
        setVersions(runDetail.versions);
    }

    async function startPreview() {
        if (!run) {
            return;
        }

        setIsStartingPreview(true);
        setError(null);

        try {
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/preview`,
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
                        `Start preview failed with ${response.status}`,
                    ),
                );
            }

            const previewResponse = (await response.json()) as PreviewResponse;
            setPreview(previewResponse.preview);
            setBrowserEval(previewResponse.browserEval ?? null);
            localStorage.setItem(
                PREVIEW_STORAGE_KEY,
                JSON.stringify(previewResponse.preview),
            );
        } catch (caughtError) {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Start preview failed",
            );
        } finally {
            setIsStartingPreview(false);
        }
    }
    async function approveRun(){
        if(!run){
            return;
        }

        setError(null);

        try{
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/approve`,
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
            const approveResponse = (await response.json()) as { run: Run };
            setRun(approveResponse.run);
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

        setIsRequestingRepair(true);
        setError(null);

        try {
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/request-repair`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        feedback: repairFeedback,
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

            const repairResponse = (await response.json()) as ExecuteResponse;
            setRun(repairResponse.run);
            setAgentResult(repairResponse.result);
            setBrowserEval(repairResponse.result.browserEval ?? null);
            setVersions(repairResponse.versions);
            setSelectedVersionNumber(null);
            await loadGeneratedFiles(repairResponse.run.id, "src");
            await loadGeneratedFile(repairResponse.run.id, "src/App.tsx");
            await loadRuns();
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
        setIsIterating(true);
        setError(null);
        try {
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/iterate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        prompt: iterationPrompt,
                    }),
                },
            );

            if (!response.ok) {
                throw new Error(`Iterate run failed with ${response.status}`);
            }

            const iterateResponse = (await response.json()) as ExecuteResponse;
            setRun(iterateResponse.run);
            setAgentResult(iterateResponse.result);
            setBrowserEval(iterateResponse.result.browserEval ?? null);
            setVersions(iterateResponse.versions);
            setSelectedVersionNumber(null);
            setIterationPrompt("");
            await loadGeneratedFiles(iterateResponse.run.id, "src");
            await loadGeneratedFile(iterateResponse.run.id, "src/App.tsx");
            await refreshRun(iterateResponse.run.id);
            await loadRuns();
            setActivePanel("preview");
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
        setError(null);
        try{
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/versions/${version.versionNumber}/files?path=src/App.tsx`,
            );
            if (!response.ok) {
                throw new Error(`Load version failed with ${response.status}`);
            }
            const fileResponse = (await response.json()) as FileResponse;
            setGeneratedFile(fileResponse);
            const previewResponse = await fetch(
                `http://127.0.0.1:3000/runs/${run.id}/preview`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        versionNumber: version.versionNumber,
                    }),
                },
            );
            if(!previewResponse.ok){
                throw new Error(`Start version preview failed with ${previewResponse.status}`);
            }
            const previewBody = (await previewResponse.json()) as PreviewResponse;
            setPreview(previewBody.preview);
            setBrowserEval(previewBody.browserEval ?? null);
            setActivePanel("preview");
        } catch(caughtError){
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load version failed",
            );
        }
    }
    async function loadGeneratedFiles(runId: string, directory: string) {
        const response = await fetch(
            `http://127.0.0.1:3000/runs/${runId}/files?directory=${encodeURIComponent(
                directory,
            )}`,
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
        setGeneratedFiles(fileListResponse);
    }

    async function loadGeneratedFile(runId: string, filePath: string) {
        setIsLoadingFile(true);

        try {
            const response = await fetch(
                `http://127.0.0.1:3000/runs/${runId}/files?path=${encodeURIComponent(
                    filePath,
                )}`,
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
            `http://127.0.0.1:3000/runs/${runId}/coordination`,
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

    function goHome() {
        setRun(null);
        setAgentResult(null);
        setGeneratedFiles(null);
        setGeneratedFile(null);
        setPreview(null);
        setBrowserEval(null);
        setCoordination(null);
        setActivePanel("overview");
        setVersions([]);
        setSelectedVersionNumber(null);
        setIterationPrompt("");
        localStorage.removeItem(CURRENT_RUN_ID_STORAGE_KEY);
        localStorage.removeItem(PREVIEW_STORAGE_KEY);
    }

    useEffect(() => {
        void loadRuns().catch((caughtError) => {
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Load runs failed",
            );
        });
        const savedRunId = localStorage.getItem(CURRENT_RUN_ID_STORAGE_KEY);

        if (!savedRunId) {
            return;
        }

        let cancelled = false;

        async function restoreRun() {
            try {
                const response = await fetch(
                    `http://127.0.0.1:3000/runs/${savedRunId}`,
                );

                if (!response.ok) {
                    localStorage.removeItem(CURRENT_RUN_ID_STORAGE_KEY);
                    localStorage.removeItem(PREVIEW_STORAGE_KEY);
                    return;
                }

                const runDetail = (await response.json()) as RunDetailResponse;

                if (cancelled) {
                    return;
                }

                setRun(runDetail.run);
                await loadCoordination(runDetail.run.id);

                if (runDetail.result) {
                    setAgentResult(runDetail.result);
                    setBrowserEval(runDetail.result.browserEval ?? null);
                    await loadGeneratedFiles(runDetail.run.id, "src");
                    await loadGeneratedFile(runDetail.run.id, "src/App.tsx");
                }

                const savedPreview = localStorage.getItem(PREVIEW_STORAGE_KEY);

                if (savedPreview) {
                    const parsedPreview = JSON.parse(savedPreview) as PreviewSession;

                    if (parsedPreview.runId === runDetail.run.id) {
                        setPreview(parsedPreview);
                    }
                }
            } catch (caughtError) {
                if (!cancelled) {
                    setError(
                        caughtError instanceof Error
                            ? caughtError.message
                            : "Restore run failed",
                    );
                }
            }
        }

        void restoreRun();

        return () => {
            cancelled = true;
        };
    }, []);
    const displayedCoordination = agentResult?.coordination ?? coordination;
    const recentRunsSection =
        runs.length > 0 ? (
            <section className="result-card">
                <h2>Recent Runs</h2>
                <div className="run-list">
                    {runs.map((historyRun) => (
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
                            </button>
                            <div className="run-actions">
                                        <button
                                    type="button"
                                    className="menu-button"
                                    aria-label="Open run actions"
                                    aria-expanded={openRunMenuId === historyRun.id}
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
                                            disabled={deletingRunId === historyRun.id}
                                            onClick={() => void deleteRun(historyRun)}
                                        >
                                            {deletingRunId === historyRun.id
                                                ? "Deleting..."
                                                : "Delete"}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </article>
                    ))}
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
                        <a href="#create">Home</a>
                        <a href="#runs">Runs</a>
                        <a href="#how-it-works">Workflow</a>
                    </nav>
                    <button type="button" className="nav-login">
                        Local Demo
                    </button>
                </header>

                <section className="landing-hero" id="create">
                    <p className="hero-bubble">Real LLM + traceable workflow + repair loop</p>
                    <h1>
                        Build with Agents.
                        <br />
                        Watch every step.
                    </h1>
                    <p className="hero-subtitle">
                        AppForge creates an isolated workspace, calls a real Coding Agent,
                        runs build and evaluation, repairs failures, and shows every trace,
                        file, and preview along the way.
                    </p>

                    <div className="advantage-grid" aria-label="AppForge advantages">
                        <span>Traceable Agent Steps</span>
                        <span>Build + Eval Harness</span>
                        <span>Repair Loop</span>
                    </div>

                    <section className="prompt-panel">
                        <label className="landing-prompt">
                            <span>Describe the app you want to forge</span>
                            <textarea
                                value={goal}
                                onChange={(event) => setGoal(event.target.value)}
                                rows={4}
                            />
                        </label>

                        <div className="prompt-footer">
                            <label className="repair-control">
                                <span>Repair attempts</span>
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
                                {isCreating ? "Creating..." : "Forge App ->"}
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
    const canExecuteCurrentRun =
        run.status === "queued" || run.status === "failed";

    return (
        <main className="app-shell workspace-shell">
            <header className="workspace-topbar">
                <button
                    type="button"
                    className="secondary-button back-button"
                    onClick={goHome}
                >
                    Back
                </button>
                <div>
                    <p className="eyebrow">Run Workspace</p>
                    <h1>Agent build console</h1>
                </div>
                <span className={formatStatusClass(run.status)}>{run.status}</span>
            </header>

            <section className="workspace-grid">
                <aside className="workspace-sidebar history-sidebar">
                    <section className="workspace-card">
                        <h2>Version History</h2>
                        <p className="muted-text">
                            Versions are created as the agent builds and repairs this app.
                        </p>
                        <div className="history-list">
                            {currentRunVersions.length > 0 ? (
                                currentRunVersions.map((version) => (
                                    <button
                                        type="button"
                                        className={
                                            selectedVersionNumber === version.versionNumber
                                                ? "history-item active"
                                                : "history-item"
                                        }
                                        key={version.id}
                                        onClick={() => selectVersion(version)}
                                    >
                                        <span>v{version.versionNumber}</span>
                                        <small>{new Date(version.createdAt).toLocaleString()}</small>
                                    </button>
                                ))
                            ) : (
                                <article className="history-item active">
                                    <span>v1</span>
                                    <strong>Draft run created</strong>
                                    <small>Waiting for first agent execution</small>
                                </article>
                            )}
                        </div>
                    </section>

                    <section className="workspace-card current-run-card">
                        <div className="card-heading-row">
                            <h2>Run</h2>
                            <span className={formatStatusClass(run.status)}>
                                {run.status}
                            </span>
                        </div>
                        <p className="run-goal-preview" title={run.goal}>
                            {run.goal}
                        </p>
                        {currentRunVersions.length > 0 ? (
                            <p
                                className="run-latest-request"
                                title={
                                    currentRunVersions[currentRunVersions.length - 1].goal
                                }
                            >
                                Latest:{" "}
                                {currentRunVersions[currentRunVersions.length - 1].goal}
                            </p>
                        ) : null}
                        <p className="run-short-id">#{run.id.slice(0, 8)}</p>
                        {canExecuteCurrentRun ||
                        isCurrentRunExecuting ||
                        run.status === "running" ||
                        run.status === "repairing" ? (
                            <button
                                type="button"
                                onClick={executeRun}
                                disabled={
                                    !canExecuteCurrentRun ||
                                    isCurrentRunExecuting ||
                                    run.status === "running" ||
                                    run.status === "repairing"
                                }
                            >
                                {isCurrentRunExecuting || run.status === "running"
                                    ? "Agent is running..."
                                    : run.status === "repairing"
                                      ? "Agent is repairing..."
                                      : "Execute Run"}
                            </button>
                        ) : (
                            <p className="run-state-message">
                                {run.status === "succeeded"
                                    ? "Completed"
                                    : run.status === "waiting_for_human"
                                      ? "Needs review"
                                      : "Execution unavailable"}
                            </p>
                        )}
                    </section>

                    {run.status === "waiting_for_human" ? (
                        <section className="workspace-card human-review-notice">
                            <h2>Human Review</h2>
                            <p>
                                The agent needs feedback before this run can be approved.
                            </p>
                            <label className="field">
                                <span>Repair feedback</span>
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
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    onClick={requestRepair}
                                    disabled={isRequestingRepair}
                                >
                                    {isRequestingRepair ? "Repairing..." : "Request Repair"}
                                </button>
                            </div>
                        </section>
                    ) : null}

                    {error ? <p className="error">{error}</p> : null}
                </aside>

                <section className="workspace-preview">
                    <div className="preview-toolbar">
                        <div>
                            <h2>Live Preview</h2>
                            <p className="muted-text">
                                {selectedVersionNumber
                                    ? `Previewing version v${selectedVersionNumber}`
                                    : "Previewing latest run output"}
                            </p>
                            {preview ? (
                                <a href={preview.url} target="_blank" rel="noreferrer">
                                    {preview.url}
                                </a>
                            ) : (
                                <span className="muted-text">No preview server yet</span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={
                                preview
                                    ? () =>
                                          setPreviewRefreshKey(
                                              (currentKey) => currentKey + 1,
                                          )
                                    : startPreview
                            }
                            disabled={!preview && isStartingPreview}
                        >
                            {!preview && isStartingPreview
                                ? "Starting..."
                                : preview
                                  ? "Refresh Preview"
                                  : "Start Preview"}
                        </button>
                    </div>
                    {preview ? (
                        <iframe
                            key={previewRefreshKey}
                            title="Generated app preview"
                            src={preview.url}
                            className="preview-frame workspace-preview-frame"
                        />
                    ) : (
                        <div className="preview-empty-state">
                            <h3>Preview will appear here</h3>
                            <p>
                                Execute the run, then start the preview server to inspect
                                the generated app.
                            </p>
                        </div>
                    )}
                    {browserEval ? (
                        <section className="browser-checks">
                            <div className="browser-checks-heading">
                                <div>
                                    <h3>Browser Checks</h3>
                                    <p>
                                        Real browser validation after starting the
                                        preview.
                                    </p>
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
                                    /{browserEval.checks.length} passed
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
                                        <span>{check.passed ? "PASS" : "FAIL"}</span>
                                        <strong>{check.name}</strong>
                                        {check.message ? <p>{check.message}</p> : null}
                                    </article>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <div className="iteration-box">
                        <textarea
                            value={iterationPrompt}
                            onChange={(event) =>
                                setIterationPrompt(event.target.value)
                            }
                            placeholder="Describe the next change, for example: add dark mode or improve the layout..."
                            rows={3}
                        />
                        <div className="iteration-actions">
                            <span className="muted-text">
                                Continue from the latest generated version.
                            </span>
                            <button
                                type="button"
                                onClick={iterateRun}
                                disabled={
                                    !run ||
                                    isIterating ||
                                    iterationPrompt.trim().length === 0 ||
                                    run.status === "running"
                                }
                            >
                                {isIterating ? "Iterating..." : "Send Iteration"}
                            </button>
                        </div>
                    </div>
                </section>

                <aside className="workspace-inspector">
                    <nav className="panel-tabs inspector-tabs" aria-label="Run sections">
                        <button
                            type="button"
                            className={activePanel === "overview" ? "active" : ""}
                            onClick={() => setActivePanel("overview")}
                        >
                            Overview
                        </button>
                        <button
                            type="button"
                            className={activePanel === "plan" ? "active" : ""}
                            onClick={() => setActivePanel("plan")}
                        >
                            Plan
                        </button>
                        <button
                            type="button"
                            className={activePanel === "trace" ? "active" : ""}
                            onClick={() => setActivePanel("trace")}
                        >
                            Trace
                        </button>
                        <button
                            type="button"
                            className={activePanel === "files" ? "active" : ""}
                            onClick={() => setActivePanel("files")}
                        >
                            Files
                        </button>
                    </nav>

                    {activePanel === "overview" ? (
                        <section className="workspace-card">
                            <h2>Overview</h2>
                            <p>
                                <strong>Status:</strong> {run.status}
                            </p>
                            {agentResult ? (
                                <>
                                    <p>
                                        <strong>Finished:</strong>{" "}
                                        {agentResult.agent.finished ? "yes" : "no"}
                                    </p>
                                    <p>
                                        <strong>Build:</strong> exit code{" "}
                                        {agentResult.build.exitCode}
                                    </p>
                                    {agentResult.eval ? (
                                        <p>
                                            <strong>Eval:</strong>{" "}
                                            {
                                                agentResult.eval.checks.filter(
                                                    (check) => check.passed,
                                                ).length
                                            }
                                            /{agentResult.eval.checks.length} checks passed
                                        </p>
                                    ) : null}
                                    {browserEval ? (
                                        <p>
                                            <strong>Browser:</strong>{" "}
                                            {
                                                browserEval.checks.filter(
                                                    (check) => check.passed,
                                                ).length
                                            }
                                            /{browserEval.checks.length} checks passed
                                        </p>
                                    ) : null}
                                </>
                            ) : (
                                <p className="muted-text">
                                    Run execution details will appear after the agent runs.
                                </p>
                            )}
                        </section>
                    ) : null}

                    {displayedCoordination && activePanel === "plan" ? (
                        <section className="workspace-card">
                            <h2>Agent Plan</h2>
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

                    {activePanel === "trace" ? (
                        <section className="workspace-card">
                            <h2>Trace</h2>
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
                                                    <strong>Status:</strong> {event.status}
                                                </p>
                                                {event.message ? (
                                                    <pre>{event.message}</pre>
                                                ) : null}
                                                {attempt ? (
                                                    <div className="nested-step-list">
                                                        {attempt.agent.steps.map(
                                                            (step, index) => (
                                                                <div
                                                                    className="nested-step"
                                                                    key={index}
                                                                >
                                                                    <strong>
                                                                        Step {index + 1}:{" "}
                                                                        {step.action.type}
                                                                    </strong>
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
                                    Agent trace will appear after execution.
                                </p>
                            )}
                        </section>
                    ) : null}

                    {activePanel === "files" ? (
                        <section className="workspace-card">
                            <h2>Files</h2>
                            {generatedFiles ? (
                                <>
                                    <p>
                                        <strong>Directory:</strong>{" "}
                                        {generatedFiles.directory}
                                    </p>
                                    <div className="file-list">
                                        {generatedFiles.files.map((filePath) => (
                                            <button
                                                type="button"
                                                key={filePath}
                                                onClick={() =>
                                                    void loadGeneratedFile(
                                                        run.id,
                                                        filePath,
                                                    )
                                                }
                                            >
                                                {filePath}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="muted-text">
                                    Generated files will appear after execution.
                                </p>
                            )}
                            {isLoadingFile ? <p>Loading generated file...</p> : null}
                            {generatedFile ? (
                                <>
                                    <p>
                                        <strong>Path:</strong> {generatedFile.path}
                                    </p>
                                    <pre>{generatedFile.content}</pre>
                                </>
                            ) : null}
                        </section>
                    ) : null}
                </aside>
            </section>
        </main>
    );
}
