import { describe, expect, it, vi } from "vitest";

import {
    RunExecutionCancelledError,
    RunExecutionManager,
    RunExecutionTimeoutError,
} from "./run-execution-manager.js";

describe("RunExecutionManager", () => {
    it("prevents the same run from starting twice", async () => {
        const manager = new RunExecutionManager();
        let finishTask: (() => void) | undefined;
        const task = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    finishTask = resolve;
                }),
        );

        expect(manager.start("run-1", task)).toBe(true);
        expect(manager.start("run-1", task)).toBe(false);
        expect(manager.isRunning("run-1")).toBe(true);

        await vi.waitFor(() => {
            expect(task).toHaveBeenCalledTimes(1);
        });
        finishTask?.();
        await vi.waitFor(() => {
            expect(manager.isRunning("run-1")).toBe(false);
        });
    });

    it("removes a failed task from the active run map", async () => {
        const manager = new RunExecutionManager();

        expect(
            manager.start("run-1", async () => {
                throw new Error("execution failed");
            }),
        ).toBe(true);

        await vi.waitFor(() => {
            expect(manager.isRunning("run-1")).toBe(false);
        });
    });

    it("propagates cancellation and keeps the slot until the task settles", async () => {
        const manager = new RunExecutionManager();
        let observedSignal: AbortSignal | undefined;
        let finishTask: (() => void) | undefined;

        expect(
            manager.start("run-1", async (signal) => {
                observedSignal = signal;
                await new Promise<void>((resolve) => {
                    finishTask = resolve;
                });
            }),
        ).toBe(true);

        await vi.waitFor(() => {
            expect(observedSignal).toBeDefined();
        });

        const reason = new RunExecutionCancelledError("cancelled by test");
        expect(manager.cancel("run-1", reason)).toBe(true);
        expect(observedSignal?.aborted).toBe(true);
        expect(observedSignal?.reason).toBe(reason);
        expect(manager.isRunning("run-1")).toBe(true);
        expect(manager.start("run-1", async () => undefined)).toBe(false);

        finishTask?.();
        await vi.waitFor(() => {
            expect(manager.isRunning("run-1")).toBe(false);
        });
    });

    it("aborts an execution after the configured deadline", async () => {
        vi.useFakeTimers();
        const manager = new RunExecutionManager({ timeoutMs: 100 });
        let observedReason: unknown;

        expect(
            manager.start("run-1", async (signal) => {
                await new Promise<void>((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => {
                            observedReason = signal.reason;
                            reject(signal.reason);
                        },
                        { once: true },
                    );
                });
            }),
        ).toBe(true);

        await vi.advanceTimersByTimeAsync(100);

        expect(observedReason).toBeInstanceOf(RunExecutionTimeoutError);
        await vi.waitFor(() => {
            expect(manager.isRunning("run-1")).toBe(false);
        });
        vi.useRealTimers();
    });

    it("releases a timed out execution but quarantines its detached task", async () => {
        vi.useFakeTimers();
        const manager = new RunExecutionManager({
            timeoutMs: 100,
            abortGraceMs: 25,
        });
        const lease = manager.tryAcquire("run-1");
        let rejectDetachedTask: ((reason?: unknown) => void) | undefined;

        const completion = lease?.run(
            async () =>
                await new Promise<void>((_resolve, reject) => {
                    rejectDetachedTask = reject;
                }),
        );

        await vi.advanceTimersByTimeAsync(100);
        expect(lease?.signal.reason).toBeInstanceOf(
            RunExecutionTimeoutError,
        );
        expect(manager.isRunning("run-1")).toBe(true);

        await vi.advanceTimersByTimeAsync(24);
        expect(manager.isRunning("run-1")).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        await expect(completion).rejects.toBeInstanceOf(
            RunExecutionTimeoutError,
        );
        expect(manager.isRunning("run-1")).toBe(false);
        expect(manager.tryAcquire("run-1")).toBeUndefined();

        // A detached task can still fail later without producing an unhandled
        // rejection. Its quarantine is removed only after that real task
        // settles, at which point a retry becomes safe.
        rejectDetachedTask?.(new Error("late task failure"));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(manager.isRunning("run-1")).toBe(false);
        const retryLease = manager.tryAcquire("run-1");
        expect(retryLease).toBeDefined();
        retryLease?.release();
        vi.useRealTimers();
    });

    it("bounds cancellation waits and quarantines the task until it settles", async () => {
        vi.useFakeTimers();
        const manager = new RunExecutionManager({ abortGraceMs: 50 });
        const lease = manager.tryAcquire("run-1");
        const reason = new RunExecutionCancelledError("cancelled by test");
        let finishDetachedTask: (() => void) | undefined;
        const completion = lease?.run(
            async () =>
                await new Promise<void>((resolve) => {
                    finishDetachedTask = resolve;
                }),
        );

        expect(manager.cancel("run-1", reason)).toBe(true);
        const waitForRun = manager.waitForRun("run-1");
        const waitForIdle = manager.waitForIdle();

        await vi.advanceTimersByTimeAsync(49);
        expect(manager.isRunning("run-1")).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        await expect(completion).rejects.toBe(reason);
        await expect(waitForRun).resolves.toBeUndefined();
        await expect(waitForIdle).resolves.toBeUndefined();
        expect(manager.isRunning("run-1")).toBe(false);
        expect(manager.tryAcquire("run-1")).toBeUndefined();

        finishDetachedTask?.();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        const retryLease = manager.tryAcquire("run-1");
        expect(retryLease).toBeDefined();
        retryLease?.release();
        vi.useRealTimers();
    });

    it("can release an acquired lease that never started", () => {
        const manager = new RunExecutionManager();
        const lease = manager.tryAcquire("run-1");

        expect(lease).toBeDefined();
        expect(manager.isRunning("run-1")).toBe(true);
        lease?.release();
        expect(manager.isRunning("run-1")).toBe(false);
    });
});
