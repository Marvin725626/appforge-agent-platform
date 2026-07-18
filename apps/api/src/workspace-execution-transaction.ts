import { access, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BACKUP_DIRECTORY_NAME = "workspace";
const PRESERVED_RUNTIME_ENTRIES = new Set([
    "node_modules",
    "versions",
]);

function isMutableWorkspaceEntry(entry: string): boolean {
    return !PRESERVED_RUNTIME_ENTRIES.has(entry);
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function replaceDirectoryContents(
    sourceRoot: string,
    targetRoot: string,
): Promise<void> {
    await mkdir(targetRoot, { recursive: true });

    const targetEntries = (await readdir(targetRoot)).filter(
        isMutableWorkspaceEntry,
    );
    await Promise.all(
        targetEntries.map((entry) =>
            rm(path.join(targetRoot, entry), {
                recursive: true,
                force: true,
            }),
        ),
    );

    if (!(await pathExists(sourceRoot))) {
        return;
    }

    const sourceEntries = (await readdir(sourceRoot)).filter(
        isMutableWorkspaceEntry,
    );
    await Promise.all(
        sourceEntries.map((entry) =>
            cp(
                path.join(sourceRoot, entry),
                path.join(targetRoot, entry),
                { recursive: true },
            ),
        ),
    );
}

export async function executeWithWorkspaceRollback<T>(input: {
    workspaceRoot: string;
    execute: () => Promise<T>;
    preserveWorkspaceOnError?:
        | boolean
        | ((error: unknown) => boolean | Promise<boolean>);
    rollbackWhen?: (result: T) => boolean | Promise<boolean>;
}): Promise<T> {
    const transactionRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-workspace-transaction-"),
    );
    const backupRoot = path.join(transactionRoot, BACKUP_DIRECTORY_NAME);

    try {
        await replaceDirectoryContents(input.workspaceRoot, backupRoot);

        try {
            const result = await input.execute();

            if (await input.rollbackWhen?.(result)) {
                await replaceDirectoryContents(backupRoot, input.workspaceRoot);
            }

            return result;
        } catch (error) {
            const preserveWorkspace =
                typeof input.preserveWorkspaceOnError === "function"
                    ? await input.preserveWorkspaceOnError(error)
                    : input.preserveWorkspaceOnError === true;

            if (!preserveWorkspace) {
                await replaceDirectoryContents(backupRoot, input.workspaceRoot);
            }
            throw error;
        }
    } finally {
        await rm(transactionRoot, {
            recursive: true,
            force: true,
        });
    }
}
