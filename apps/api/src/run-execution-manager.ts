export type BackgroundRunTask = (signal: AbortSignal) => Promise<void>;

export class RunExecutionCancelledError extends Error {
    constructor(message = "Run execution was cancelled") {
        super(message);
        this.name = "RunExecutionCancelledError";
    }
}

export class RunExecutionTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Run execution timed out after ${timeoutMs}ms`);
        this.name = "RunExecutionTimeoutError";
    }
}

type ActiveRun = {
    controller: AbortController;
    token: symbol;
    started: boolean;
    completion?: Promise<unknown>;
};

export type RunExecutionLease = {
    readonly signal: AbortSignal;
    run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
    release(): void;
};

export type RunExecutionManagerOptions = {
    timeoutMs?: number;
    /**
     * Time allowed for a task to settle after its signal is aborted. Once the
     * grace period expires, the managed completion rejects with the abort
     * reason and releases the execution slot even if the task ignored the
     * signal.
     */
    abortGraceMs?: number;
};

const DEFAULT_ABORT_GRACE_MS = 5_000;

type AbortDeadline = {
    promise: Promise<never>;
    clear(): void;
};

function createAbortDeadline(
    signal: AbortSignal,
    abortGraceMs: number,
): AbortDeadline {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let cleared = false;

    const rejectAfterGrace = (
        reject: (reason?: unknown) => void,
    ): void => {
        if (cleared) {
            return;
        }

        const reason =
            signal.reason ?? new RunExecutionCancelledError();

        if (abortGraceMs <= 0) {
            reject(reason);
            return;
        }

        deadline = setTimeout(() => {
            deadline = undefined;
            reject(reason);
        }, abortGraceMs);
    };

    let handleAbort: (() => void) | undefined;
    const promise = new Promise<never>((_resolve, reject) => {
        handleAbort = () => rejectAfterGrace(reject);

        if (signal.aborted) {
            handleAbort();
            return;
        }

        signal.addEventListener("abort", handleAbort, { once: true });
    });

    return {
        promise,
        clear: () => {
            cleared = true;
            if (handleAbort !== undefined) {
                signal.removeEventListener("abort", handleAbort);
            }
            if (deadline !== undefined) {
                clearTimeout(deadline);
                deadline = undefined;
            }
        },
    };
}

/**
 * Owns the in-process execution slot and cancellation signal for each run.
 *
 * A slot is acquired synchronously, before callers perform any awaited state
 * updates. This makes duplicate rejection atomic within the API process. A
 * cancelled slot remains occupied while its task gets a bounded opportunity
 * to settle. A task that ignores cancellation is detached after that grace
 * period so cancellation and shutdown cannot wait forever.
 */
export class RunExecutionManager {
    private readonly activeRuns = new Map<string, ActiveRun>();
    /**
     * A hard deadline may detach a task from its managed completion, but that
     * task can still mutate its workspace. Keep its run id quarantined until
     * the underlying task really settles so a retry can never overlap it.
     */
    private readonly quarantinedRuns = new Map<string, symbol>();

    constructor(private readonly options: RunExecutionManagerOptions = {}) {}

    isRunning(runId: string): boolean {
        return this.activeRuns.has(runId);
    }

    tryAcquire(runId: string): RunExecutionLease | undefined {
        if (
            this.isRunning(runId) ||
            this.quarantinedRuns.has(runId)
        ) {
            return undefined;
        }

        const activeRun: ActiveRun = {
            controller: new AbortController(),
            token: Symbol(runId),
            started: false,
        };
        this.activeRuns.set(runId, activeRun);

        const releaseIfCurrent = () => {
            if (this.activeRuns.get(runId)?.token === activeRun.token) {
                this.activeRuns.delete(runId);
            }
        };
        const clearQuarantineIfCurrent = () => {
            if (this.quarantinedRuns.get(runId) === activeRun.token) {
                this.quarantinedRuns.delete(runId);
            }
        };

        return {
            signal: activeRun.controller.signal,
            run: <T>(
                task: (signal: AbortSignal) => Promise<T>,
            ): Promise<T> => {
                if (activeRun.started) {
                    throw new Error("Run execution lease was already started");
                }

                activeRun.started = true;
                const timeoutMs = this.options.timeoutMs;
                const timeout =
                    timeoutMs !== undefined && timeoutMs > 0
                        ? setTimeout(() => {
                              activeRun.controller.abort(
                                  new RunExecutionTimeoutError(timeoutMs),
                              );
                          }, timeoutMs)
                        : undefined;

                const configuredAbortGraceMs = this.options.abortGraceMs;
                const abortGraceMs =
                    configuredAbortGraceMs !== undefined &&
                    Number.isFinite(configuredAbortGraceMs) &&
                    configuredAbortGraceMs >= 0
                        ? configuredAbortGraceMs
                        : DEFAULT_ABORT_GRACE_MS;
                const abortDeadline = createAbortDeadline(
                    activeRun.controller.signal,
                    abortGraceMs,
                );

                let taskSettled = false;
                const rawTaskCompletion = (async () => {
                    activeRun.controller.signal.throwIfAborted();
                    return await task(activeRun.controller.signal);
                })();
                const taskCompletion = rawTaskCompletion.then(
                    (result) => {
                        taskSettled = true;
                        clearQuarantineIfCurrent();
                        return result;
                    },
                    (error: unknown) => {
                        taskSettled = true;
                        clearQuarantineIfCurrent();
                        throw error;
                    },
                );

                // Promise.race installs a rejection handler on taskCompletion,
                // but keep this explicit sink as well: after the hard deadline
                // the caller no longer owns a task that may reject much later.
                void taskCompletion.catch(() => undefined);

                const completion = (async () => {
                    try {
                        return await Promise.race([
                            taskCompletion,
                            abortDeadline.promise,
                        ]);
                    } finally {
                        if (timeout !== undefined) {
                            clearTimeout(timeout);
                        }
                        abortDeadline.clear();
                        if (!taskSettled) {
                            this.quarantinedRuns.set(
                                runId,
                                activeRun.token,
                            );
                        }
                        releaseIfCurrent();
                    }
                })();
                activeRun.completion = completion;

                // A lease can be launched in the background or observed only
                // after waitForRun(). Attach a handler immediately so the hard
                // deadline can never surface as an unhandled rejection.
                void completion.catch(() => undefined);

                return completion;
            },
            release: () => {
                if (!activeRun.started) {
                    releaseIfCurrent();
                }
            },
        };
    }

    cancel(
        runId: string,
        reason: Error = new RunExecutionCancelledError(),
    ): boolean {
        const activeRun = this.activeRuns.get(runId);

        if (!activeRun) {
            return false;
        }

        if (!activeRun.controller.signal.aborted) {
            activeRun.controller.abort(reason);
        }

        return true;
    }

    cancelAll(
        reason: Error = new RunExecutionCancelledError(
            "API server is shutting down",
        ),
    ): number {
        let cancelledCount = 0;

        for (const runId of this.activeRuns.keys()) {
            if (this.cancel(runId, reason)) {
                cancelledCount += 1;
            }
        }

        return cancelledCount;
    }

    async waitForRun(runId: string): Promise<void> {
        const completion = this.activeRuns.get(runId)?.completion;

        if (completion) {
            await completion.catch(() => undefined);
        }
    }

    async waitForIdle(): Promise<void> {
        while (this.activeRuns.size > 0) {
            const completions = [...this.activeRuns.values()]
                .map((activeRun) => activeRun.completion)
                .filter(
                    (completion): completion is Promise<unknown> =>
                        completion !== undefined,
                );

            if (completions.length === 0) {
                return;
            }

            await Promise.all(
                completions.map((completion) =>
                    completion.catch(() => undefined),
                ),
            );
        }
    }

    /**
     * Kept for API compatibility. Clearing a live task cancels it and retains
     * its slot until the task settles or the abort grace period expires.
     */
    clear(runId: string): void {
        this.cancel(
            runId,
            new RunExecutionCancelledError("Run execution lock was cleared"),
        );
    }

    start(runId: string, task: BackgroundRunTask): boolean {
        const lease = this.tryAcquire(runId);

        if (!lease) {
            return false;
        }

        void lease.run(task).catch(() => undefined);
        return true;
    }
}

export function isRunExecutionAbortError(error: unknown): boolean {
    return (
        error instanceof RunExecutionCancelledError ||
        error instanceof RunExecutionTimeoutError ||
        (error instanceof DOMException && error.name === "AbortError")
    );
}
