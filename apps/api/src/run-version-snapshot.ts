import path from "node:path";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const SNAPSHOT_PUBLISH_ATTEMPTS = 8;
const SNAPSHOT_PUBLISH_INITIAL_RETRY_DELAY_MS = 25;
const SNAPSHOT_PUBLISH_MAX_RETRY_DELAY_MS = 250;
const SNAPSHOT_CLEANUP_RETRIES = 5;
const SNAPSHOT_CLEANUP_RETRY_DELAY_MS = 50;

const EXCLUDED_WORKSPACE_ENTRIES = new Set([
    ".appforge",
    ".cache",
    ".git",
    ".hg",
    ".npm-cache",
    ".pnpm-store",
    ".svn",
    ".turbo",
    ".vite",
    ".yarn",
    "coverage",
    "dist",
    "node_modules",
    "versions",
]);

function isTemporaryDirectoryName(entryName: string): boolean {
    const normalizedName = entryName.toLowerCase();

    return (
        normalizedName === "tmp" ||
        normalizedName === "temp" ||
        normalizedName === ".tmp" ||
        normalizedName === ".temp" ||
        /^(?:\.saving-|\.restoring-|\.preview-|tmp-|temp-)/u.test(
            normalizedName,
        )
    );
}

async function listSnapshotEntries(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });

    return entries
        .filter(
            (entry) =>
                !EXCLUDED_WORKSPACE_ENTRIES.has(entry.name.toLowerCase()) &&
                !(entry.isDirectory() &&
                    isTemporaryDirectoryName(entry.name)),
        )
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function isFileSystemErrorWithCode(
    error: unknown,
    codes: ReadonlySet<string>,
): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "string" &&
        codes.has(error.code)
    );
}

const RETRYABLE_SNAPSHOT_PUBLISH_ERROR_CODES = new Set([
    "EACCES",
    "EBUSY",
    "EEXIST",
    "ENOTEMPTY",
    "EPERM",
]);

async function publishRunVersionSnapshot(input: {
    temporarySnapshotRoot: string;
    snapshotRoot: string;
}): Promise<void> {
    for (let attempt = 0; attempt < SNAPSHOT_PUBLISH_ATTEMPTS; attempt += 1) {
        // Saving the same immutable snapshot is idempotent. In particular,
        // Windows reports EPERM rather than EEXIST for some directory rename
        // collisions, so checking before and after rename is intentional.
        if (await pathExists(input.snapshotRoot)) {
            return;
        }

        try {
            await rename(input.temporarySnapshotRoot, input.snapshotRoot);
            return;
        } catch (error) {
            // Another publisher may have won between the existence check and
            // rename. Never remove or replace that completed snapshot.
            if (await pathExists(input.snapshotRoot)) {
                return;
            }

            if (
                !isFileSystemErrorWithCode(
                    error,
                    RETRYABLE_SNAPSHOT_PUBLISH_ERROR_CODES,
                ) ||
                attempt === SNAPSHOT_PUBLISH_ATTEMPTS - 1
            ) {
                throw error;
            }

            const retryDelay = Math.min(
                SNAPSHOT_PUBLISH_INITIAL_RETRY_DELAY_MS * 2 ** attempt,
                SNAPSHOT_PUBLISH_MAX_RETRY_DELAY_MS,
            );

            await delay(retryDelay);
        }
    }
}

async function removeTemporarySnapshot(
    temporarySnapshotRoot: string,
): Promise<void> {
    await rm(temporarySnapshotRoot, {
        recursive: true,
        force: true,
        maxRetries: SNAPSHOT_CLEANUP_RETRIES,
        retryDelay: SNAPSHOT_CLEANUP_RETRY_DELAY_MS,
    });
}

export async function saveRunVersionSnapshot(input: {
    workspaceRoot: string;
    versionNumber: number;
    snapshotId?: string | undefined;
}): Promise<string> {
    const versionsRoot = path.join(input.workspaceRoot, "versions");
    const snapshotDirectoryName = getRunVersionSnapshotDirectoryName(input);
    const snapshotRoot = path.join(versionsRoot, snapshotDirectoryName);
    const temporarySnapshotRoot = path.join(
        versionsRoot,
        `.saving-${snapshotDirectoryName}-${randomUUID()}`,
    );

    await mkdir(temporarySnapshotRoot, { recursive: true });

    try {
        for (const entry of await listSnapshotEntries(input.workspaceRoot)) {
            const sourcePath = path.join(input.workspaceRoot, entry);
            const targetPath = path.join(temporarySnapshotRoot, entry);

            await cp(sourcePath, targetPath, {
                recursive: true,
            });
        }

        await publishRunVersionSnapshot({
            temporarySnapshotRoot,
            snapshotRoot,
        });
    } catch (error) {
        await removeTemporarySnapshot(temporarySnapshotRoot);
        throw error;
    }

    // The temporary directory no longer exists after a successful rename,
    // but it still does when another concurrent save published first.
    await removeTemporarySnapshot(temporarySnapshotRoot);

    return snapshotRoot;
}

export function getRunVersionSnapshotDirectoryName(input: {
    versionNumber: number;
    snapshotId?: string | undefined;
}): string {
    const directoryName = input.snapshotId ?? `v${input.versionNumber}`;

    if (
        directoryName === "." ||
        directoryName === ".." ||
        path.basename(directoryName) !== directoryName ||
        path.isAbsolute(directoryName)
    ) {
        throw new Error("Invalid version snapshot id");
    }

    return directoryName;
}

export async function restoreRunVersionSnapshot(input: {
    workspaceRoot: string;
    versionNumber: number;
    snapshotId?: string | undefined;
}): Promise<void> {
    const snapshotRoot = path.join(
        input.workspaceRoot,
        "versions",
        getRunVersionSnapshotDirectoryName(input),
    );

    if (!(await pathExists(snapshotRoot))) {
        throw new Error("Version snapshot not found");
    }

    for (const entry of await listSnapshotEntries(input.workspaceRoot)) {
        await rm(path.join(input.workspaceRoot, entry), {
            recursive: true,
            force: true,
        });
    }

    for (const entry of await listSnapshotEntries(snapshotRoot)) {
        const sourcePath = path.join(snapshotRoot, entry);
        const targetPath = path.join(input.workspaceRoot, entry);

        await cp(sourcePath, targetPath, {
            recursive: true,
        });
    }
}

export async function deleteRunVersionSnapshot(input: {
    workspaceRoot: string;
    versionNumber: number;
    snapshotId?: string | undefined;
}): Promise<boolean> {
    const versionsRoot = path.join(input.workspaceRoot, "versions");

    try {
        await rm(
            path.join(
                versionsRoot,
                getRunVersionSnapshotDirectoryName(input),
            ),
            {
                recursive: true,
                force: true,
            },
        );

        return true;
    } catch (error) {
        if (
            error instanceof Error &&
            "code" in error &&
            (error.code === "EBUSY" || error.code === "EPERM")
        ) {
            // A stale local preview can still hold a Windows directory lock.
            // The version metadata is removed anyway; the orphan can be
            // cleaned up later without blocking the user workflow.
            return false;
        }

        throw error;
    }
}
