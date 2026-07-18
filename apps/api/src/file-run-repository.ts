import {
    mkdir,
    open,
    readFile,
    rename as nodeRename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
    RunSchema,
    RunVersionSchema,
    type Run,
    type RunVersion,
} from "@appforge/protocol";
import { z } from "zod";

import type { RunReactAppAgentResult } from "./run-react-app-agent.js";
import type { RunRepositoryLike } from "./run-repository.js";

const StoreSchema = z.object({
    runs: z.array(RunSchema),
    results: z.record(z.string(), z.unknown()),
    versions: z.record(z.string(), z.array(RunVersionSchema)).default({}),
});

type StoreData = {
    runs: Run[];
    results: Record<string, RunReactAppAgentResult>;
    versions: Record<string, RunVersion[]>;
};

function emptyStore(): StoreData {
    return {
        runs: [],
        results: {},
        versions: {},
    };
}

type StoreLockMetadata = {
    version: 1;
    ownerToken: string;
    pid: number;
    createdAt: number;
};

export type FileRunRepositoryOptions = {
    renameFile?: typeof nodeRename;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    isProcessAlive?: (pid: number) => boolean;
    renameMaxAttempts?: number;
    renameBaseDelayMs?: number;
    renameMaxDelayMs?: number;
    lockAcquireTimeoutMs?: number;
    lockStaleAfterMs?: number;
    lockBaseDelayMs?: number;
    lockMaxDelayMs?: number;
};

const DEFAULT_RENAME_MAX_ATTEMPTS = 8;
const DEFAULT_RENAME_BASE_DELAY_MS = 20;
const DEFAULT_RENAME_MAX_DELAY_MS = 500;
const DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_LOCK_BASE_DELAY_MS = 10;
const DEFAULT_LOCK_MAX_DELAY_MS = 250;

const sharedWriteQueues = new Map<string, Promise<void>>();

function normalizePathKey(storePath: string): string {
    const resolvedPath = path.resolve(storePath);

    return process.platform === "win32"
        ? resolvedPath.toLowerCase()
        : resolvedPath;
}

function normalizeIntegerOption(
    value: number | undefined,
    fallback: number,
    minimum: number,
): number {
    return value === undefined || !Number.isFinite(value)
        ? fallback
        : Math.max(minimum, Math.floor(value));
}

function isFileSystemErrorWithCode(
    error: unknown,
    codes: readonly string[],
): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        codes.includes(error.code)
    );
}

function isRetryableWindowsFileError(error: unknown): boolean {
    return isFileSystemErrorWithCode(error, ["EPERM", "EACCES", "EBUSY"]);
}

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function defaultIsProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    if (pid === process.pid) {
        return true;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but this process cannot signal it.
        return !isFileSystemErrorWithCode(error, ["ESRCH"]);
    }
}

function parseStoreLockMetadata(rawMetadata: string): StoreLockMetadata | undefined {
    try {
        const metadata = JSON.parse(rawMetadata) as Partial<StoreLockMetadata>;

        if (
            metadata.version !== 1 ||
            typeof metadata.ownerToken !== "string" ||
            metadata.ownerToken.length === 0 ||
            typeof metadata.pid !== "number" ||
            !Number.isInteger(metadata.pid) ||
            metadata.pid <= 0 ||
            typeof metadata.createdAt !== "number" ||
            !Number.isFinite(metadata.createdAt)
        ) {
            return undefined;
        }

        return metadata as StoreLockMetadata;
    } catch {
        return undefined;
    }
}

function lockFileIdentityMatches(
    first: Stats,
    second: Stats,
): boolean {
    return (
        first.dev === second.dev &&
        first.ino === second.ino &&
        first.size === second.size &&
        first.mtimeMs === second.mtimeMs &&
        first.birthtimeMs === second.birthtimeMs
    );
}

async function withSharedWriteQueue<T>(
    storePath: string,
    operation: () => Promise<T>,
): Promise<T> {
    const queueKey = normalizePathKey(storePath);
    const previousWrite = sharedWriteQueues.get(queueKey) ?? Promise.resolve();
    let releaseWrite: () => void = () => undefined;
    const currentWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
    });

    sharedWriteQueues.set(queueKey, currentWrite);
    await previousWrite;

    try {
        return await operation();
    } finally {
        releaseWrite();

        if (sharedWriteQueues.get(queueKey) === currentWrite) {
            sharedWriteQueues.delete(queueKey);
        }
    }
}

export class FileRunRepository implements RunRepositoryLike {
    private readonly storePath: string;
    private readonly lockPath: string;
    private readonly renameFile: typeof nodeRename;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly now: () => number;
    private readonly isProcessAlive: (pid: number) => boolean;
    private readonly renameMaxAttempts: number;
    private readonly renameBaseDelayMs: number;
    private readonly renameMaxDelayMs: number;
    private readonly lockAcquireTimeoutMs: number;
    private readonly lockStaleAfterMs: number;
    private readonly lockBaseDelayMs: number;
    private readonly lockMaxDelayMs: number;

    constructor(
        storePath: string,
        options: FileRunRepositoryOptions = {},
    ) {
        this.storePath = path.resolve(storePath);
        this.lockPath = `${this.storePath}.lock`;
        this.renameFile = options.renameFile ?? nodeRename;
        this.sleep = options.sleep ?? defaultSleep;
        this.now = options.now ?? Date.now;
        this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
        this.renameMaxAttempts = normalizeIntegerOption(
            options.renameMaxAttempts,
            DEFAULT_RENAME_MAX_ATTEMPTS,
            1,
        );
        this.renameBaseDelayMs = normalizeIntegerOption(
            options.renameBaseDelayMs,
            DEFAULT_RENAME_BASE_DELAY_MS,
            0,
        );
        this.renameMaxDelayMs = normalizeIntegerOption(
            options.renameMaxDelayMs,
            DEFAULT_RENAME_MAX_DELAY_MS,
            0,
        );
        this.lockAcquireTimeoutMs = normalizeIntegerOption(
            options.lockAcquireTimeoutMs,
            DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS,
            1,
        );
        this.lockStaleAfterMs = normalizeIntegerOption(
            options.lockStaleAfterMs,
            DEFAULT_LOCK_STALE_AFTER_MS,
            1,
        );
        this.lockBaseDelayMs = normalizeIntegerOption(
            options.lockBaseDelayMs,
            DEFAULT_LOCK_BASE_DELAY_MS,
            1,
        );
        this.lockMaxDelayMs = normalizeIntegerOption(
            options.lockMaxDelayMs,
            DEFAULT_LOCK_MAX_DELAY_MS,
            1,
        );
    }

    async list(): Promise<Run[]> {
        const store = await this.readStore();

        return store.runs;
    }

    async save(run: Run): Promise<Run> {
        return await this.withWriteLock(async () => {
            const store = await this.readStore();
            const existingIndex = store.runs.findIndex(
                (existingRun) => existingRun.id === run.id,
            );

            if (existingIndex >= 0) {
                store.runs[existingIndex] = run;
            } else {
                store.runs.push(run);
            }

            await this.writeStore(store);
            return run;
        });
    }

    async findById(id: string): Promise<Run | undefined> {
        const store = await this.readStore();

        return store.runs.find((run) => run.id === id);
    }

    async deleteById(id: string): Promise<boolean> {
        return await this.withWriteLock(async () => {
            const store = await this.readStore();
            const initialRunCount = store.runs.length;

            store.runs = store.runs.filter((run) => run.id !== id);
            delete store.results[id];
            delete store.versions[id];

            const deletedRun = store.runs.length !== initialRunCount;

            if (deletedRun) {
                await this.writeStore(store);
            }

            return deletedRun;
        });
    }

    async saveResult(
        runId: string,
        result: RunReactAppAgentResult,
    ): Promise<void> {
        await this.withWriteLock(async () => {
            const store = await this.readStore();
            store.results[runId] = result;
            await this.writeStore(store);
        });
    }

    async findResultByRunId(
        runId: string,
    ): Promise<RunReactAppAgentResult | undefined> {
        const store = await this.readStore();

        return store.results[runId];
    }

    async listVersions(runId: string): Promise<RunVersion[]> {
        const store = await this.readStore();

        return store.versions[runId] ?? [];
    }

    async saveVersion(version: RunVersion): Promise<RunVersion> {
        return await this.withWriteLock(async () => {
            const store = await this.readStore();
            const existingVersions = store.versions[version.runId] ?? [];
            const conflictingVersion = existingVersions.find(
                (candidate) =>
                    candidate.versionNumber === version.versionNumber &&
                    candidate.id !== version.id,
            );

            if (conflictingVersion) {
                throw new Error(
                    `Run ${version.runId} already has version ${version.versionNumber}`,
                );
            }

            const existingIndex = existingVersions.findIndex(
                (candidate) => candidate.id === version.id,
            );

            if (existingIndex >= 0) {
                existingVersions[existingIndex] = version;
                store.versions[version.runId] = existingVersions;
            } else {
                store.versions[version.runId] = [...existingVersions, version];
            }

            await this.writeStore(store);
            return version;
        });
    }

    async replaceVersions(
        runId: string,
        versions: RunVersion[],
    ): Promise<void> {
        await this.withWriteLock(async () => {
            const store = await this.readStore();
            store.versions[runId] = versions;
            await this.writeStore(store);
        });
    }

    async deleteVersions(runId: string): Promise<void> {
        await this.withWriteLock(async () => {
            const store = await this.readStore();
            delete store.versions[runId];
            await this.writeStore(store);
        });
    }

    private async readStore(): Promise<StoreData> {
        try {
            const rawStore = await readFile(this.storePath, "utf8");
            const parsedStore = StoreSchema.parse(JSON.parse(rawStore));

            return {
                runs: parsedStore.runs,
                results: parsedStore.results as Record<
                    string,
                    RunReactAppAgentResult
                >,
                versions: parsedStore.versions,
            };
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                return emptyStore();
            }

            throw error;
        }
    }

    private async writeStore(store: StoreData): Promise<void> {
        await mkdir(path.dirname(this.storePath), {
            recursive: true,
        });

        const temporaryStorePath = `${this.storePath}.${randomUUID()}.tmp`;

        try {
            await writeFile(
                temporaryStorePath,
                `${JSON.stringify(store, null, 2)}\n`,
                "utf8",
            );
            await this.renameStoreWithRetry(temporaryStorePath);
        } finally {
            await this.removeFileWithRetry(temporaryStorePath);
        }
    }

    private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
        return await withSharedWriteQueue(this.storePath, async () => {
            const lock = await this.acquireStoreLock();
            let outcome:
                | { ok: true; value: T }
                | { ok: false; error: unknown };

            try {
                outcome = {
                    ok: true,
                    value: await operation(),
                };
            } catch (error) {
                outcome = {
                    ok: false,
                    error,
                };
            }

            try {
                await this.releaseStoreLock(lock);
            } catch (releaseError) {
                if (outcome.ok) {
                    throw releaseError;
                }
            }

            if (!outcome.ok) {
                throw outcome.error;
            }

            return outcome.value;
        });
    }

    private retryDelay(
        attempt: number,
        baseDelayMs: number,
        maxDelayMs: number,
    ): number {
        return Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    }

    private async renameStoreWithRetry(
        temporaryStorePath: string,
    ): Promise<void> {
        for (let attempt = 0; attempt < this.renameMaxAttempts; attempt += 1) {
            try {
                await this.renameFile(temporaryStorePath, this.storePath);
                return;
            } catch (error) {
                const hasMoreAttempts = attempt + 1 < this.renameMaxAttempts;

                if (!hasMoreAttempts || !isRetryableWindowsFileError(error)) {
                    throw error;
                }

                await this.sleep(
                    this.retryDelay(
                        attempt,
                        this.renameBaseDelayMs,
                        this.renameMaxDelayMs,
                    ),
                );
            }
        }
    }

    private async removeFileWithRetry(filePath: string): Promise<void> {
        for (let attempt = 0; attempt < this.renameMaxAttempts; attempt += 1) {
            try {
                await rm(filePath, { force: true });
                return;
            } catch (error) {
                const hasMoreAttempts = attempt + 1 < this.renameMaxAttempts;

                if (!hasMoreAttempts || !isRetryableWindowsFileError(error)) {
                    throw error;
                }

                await this.sleep(
                    this.retryDelay(
                        attempt,
                        this.renameBaseDelayMs,
                        this.renameMaxDelayMs,
                    ),
                );
            }
        }
    }

    private async acquireStoreLock(): Promise<{
        ownerToken: string;
        handle: Awaited<ReturnType<typeof open>>;
    }> {
        await mkdir(path.dirname(this.storePath), { recursive: true });
        const startedAt = this.now();
        let waitAttempt = 0;

        while (true) {
            const ownerToken = randomUUID();

            try {
                const handle = await open(this.lockPath, "wx");
                const metadata: StoreLockMetadata = {
                    version: 1,
                    ownerToken,
                    pid: process.pid,
                    createdAt: this.now(),
                };

                try {
                    await handle.writeFile(
                        `${JSON.stringify(metadata)}\n`,
                        "utf8",
                    );
                    await handle.sync();
                } catch (error) {
                    await handle.close().catch(() => undefined);
                    await this.removeFileWithRetry(this.lockPath).catch(
                        () => undefined,
                    );
                    throw error;
                }

                return {
                    ownerToken,
                    handle,
                };
            } catch (error) {
                if (!isFileSystemErrorWithCode(error, ["EEXIST"])) {
                    throw error;
                }

                if (await this.recoverStaleStoreLock()) {
                    continue;
                }

                if (this.now() - startedAt >= this.lockAcquireTimeoutMs) {
                    throw new Error(
                        `Timed out waiting for run repository lock: ${this.lockPath}`,
                        { cause: error },
                    );
                }

                await this.sleep(
                    this.retryDelay(
                        waitAttempt,
                        this.lockBaseDelayMs,
                        this.lockMaxDelayMs,
                    ),
                );
                waitAttempt += 1;
            }
        }
    }

    private async recoverStaleStoreLock(): Promise<boolean> {
        let rawMetadata: string;
        let lockStat: Stats;

        try {
            [rawMetadata, lockStat] = await Promise.all([
                readFile(this.lockPath, "utf8"),
                stat(this.lockPath),
            ]);
        } catch (error) {
            return isFileSystemErrorWithCode(error, ["ENOENT"]);
        }

        const metadata = parseStoreLockMetadata(rawMetadata);
        const metadataCreatedAt = metadata?.createdAt ?? lockStat.mtimeMs;
        const lockAge = this.now() - Math.max(
            metadataCreatedAt,
            lockStat.mtimeMs,
        );

        if (metadata) {
            // A confirmed-live owner always keeps its lock, however old it
            // looks. A confirmed-dead owner can be recovered immediately, so
            // a process crash does not block all writes for the stale window.
            if (this.isProcessAlive(metadata.pid)) {
                return false;
            }
        } else if (lockAge < this.lockStaleAfterMs) {
            // Invalid metadata can briefly be observed between exclusive file
            // creation and the metadata write. Only recover it after a full
            // stale interval so that window cannot be mistaken for a crash.
            return false;
        }

        try {
            const [confirmedMetadata, confirmedStat] = await Promise.all([
                readFile(this.lockPath, "utf8"),
                stat(this.lockPath),
            ]);

            if (
                confirmedMetadata !== rawMetadata ||
                !lockFileIdentityMatches(lockStat, confirmedStat)
            ) {
                return false;
            }

            const confirmedOwner = parseStoreLockMetadata(confirmedMetadata);

            if (
                confirmedOwner &&
                (confirmedOwner.ownerToken !== metadata?.ownerToken ||
                    this.isProcessAlive(confirmedOwner.pid))
            ) {
                return false;
            }

            await this.removeFileWithRetry(this.lockPath);
            return true;
        } catch (error) {
            if (isFileSystemErrorWithCode(error, ["ENOENT"])) {
                return true;
            }

            throw error;
        }
    }

    private async releaseStoreLock(lock: {
        ownerToken: string;
        handle: Awaited<ReturnType<typeof open>>;
    }): Promise<void> {
        await lock.handle.close();

        try {
            const rawMetadata = await readFile(this.lockPath, "utf8");
            const metadata = parseStoreLockMetadata(rawMetadata);

            // Never remove a lock that was replaced after this owner released
            // its file handle.
            if (metadata?.ownerToken !== lock.ownerToken) {
                return;
            }

            await this.removeFileWithRetry(this.lockPath);
        } catch (error) {
            if (!isFileSystemErrorWithCode(error, ["ENOENT"])) {
                throw error;
            }
        }
    }
}
