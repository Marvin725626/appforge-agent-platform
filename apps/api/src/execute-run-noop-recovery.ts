import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type NoopRecoveryInput = {
    goal: string;
    currentRequest?: string | undefined;
    workspaceRoot: string;
    maxRepairAttempts?: number | undefined;
    resetWorkspace?: boolean | undefined;
    memoryContext?: string | undefined;
};

const ROOT_FILES = new Set([
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
]);

const TRACKED_DIRECTORIES = [
    path.join("src"),
    path.join("public", "assets"),
];

const MAX_TRACKED_FILE_BYTES = 12 * 1024 * 1024;

async function collectFiles(
    absoluteDirectory: string,
    relativeDirectory: string,
): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        if (
            entry.name === "node_modules" ||
            entry.name === "dist" ||
            entry.name === "versions" ||
            entry.name.startsWith(".")
        ) {
            continue;
        }

        const absolutePath = path.join(absoluteDirectory, entry.name);
        const relativePath = path.join(relativeDirectory, entry.name);

        if (entry.isDirectory()) {
            files.push(...(await collectFiles(absolutePath, relativePath)));
            continue;
        }

        if (entry.isFile()) {
            files.push(relativePath);
        }
    }

    return files;
}

export async function fingerprintUserVisibleWorkspace(
    workspaceRoot: string,
): Promise<string> {
    const files = new Set<string>();

    for (const relativeDirectory of TRACKED_DIRECTORIES) {
        const absoluteDirectory = path.join(workspaceRoot, relativeDirectory);
        for (const relativePath of await collectFiles(
            absoluteDirectory,
            relativeDirectory,
        )) {
            files.add(relativePath);
        }
    }

    for (const rootFile of ROOT_FILES) {
        try {
            if ((await stat(path.join(workspaceRoot, rootFile))).isFile()) {
                files.add(rootFile);
            }
        } catch {
            // Missing optional root files are fine.
        }
    }

    const hash = createHash("sha256");

    for (const relativePath of [...files].sort()) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        hash.update(relativePath.replaceAll(path.sep, "/"));
        hash.update("\0");

        try {
            const fileStat = await stat(absolutePath);
            hash.update(String(fileStat.size));
            hash.update("\0");

            if (fileStat.size <= MAX_TRACKED_FILE_BYTES) {
                hash.update(await readFile(absolutePath));
            } else {
                hash.update(String(fileStat.mtimeMs));
            }
        } catch {
            hash.update("<missing>");
        }

        hash.update("\0");
    }

    return hash.digest("hex");
}

export function createNoopRecoveryRequest(currentRequest: string): string {
    const explicitSourceFiles = [
        ...currentRequest.matchAll(
            /(?:^|[\s"'`])((?:src|public)\/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|css|scss|json|html|svg|png|jpe?g|webp))/giu,
        ),
    ].map((match) => match[1]);

    const namedFileGuidance =
        explicitSourceFiles.length > 0
            ? [
                  "",
                  "The user explicitly named these files. Treat them as the allowed file-level scope for this recovery attempt:",
                  ...[...new Set(explicitSourceFiles)].map(
                      (file) => `- ${file}`,
                  ),
                  "Preserve every other source file unless the request makes a directly necessary companion edit.",
              ].join("\n")
            : "";

    return [
        "[NO-OP RECOVERY: SECOND AND FINAL ATTEMPT]",
        "",
        "The previous focused iteration produced no user-visible workspace difference.",
        "Do not return finish until the newest request has produced a real source-file change.",
        "Re-read the exact current file contents before using edit_file; do not reuse stale oldText.",
        "Apply only the newest request and preserve unrelated design, content, dependencies, and assets.",
        "Prefer precise edit_file operations. Use write_file only when a narrowly scoped edit cannot be expressed safely.",
        "This is the final automatic recovery attempt; do not repeat the previous no-op plan.",
        namedFileGuidance,
        "",
        "Original newest request:",
        currentRequest.trim(),
    ]
        .filter((line) => line !== "")
        .join("\n");
}

function appendNoopRecoveryContext(
    existingMemoryContext: string | undefined,
    currentRequest: string,
): string {
    return [existingMemoryContext, createNoopRecoveryRequest(currentRequest)]
        .filter((part): part is string => Boolean(part?.trim()))
        .join("\n\n");
}

export async function executeRunWithNoopRecovery<
    TInput extends NoopRecoveryInput,
    TResult,
>(
    executeRun: (input: TInput) => Promise<TResult>,
    input: TInput,
): Promise<TResult> {
    const currentRequest = input.currentRequest?.trim();

    if (!currentRequest) {
        return await executeRun(input);
    }

    const beforeFingerprint = await fingerprintUserVisibleWorkspace(
        input.workspaceRoot,
    );

    let firstResult: TResult;

    try {
        firstResult = await executeRun(input);
    } catch (firstError) {
        const fingerprintAfterError =
            await fingerprintUserVisibleWorkspace(input.workspaceRoot);

        if (beforeFingerprint !== fingerprintAfterError) {
            throw firstError;
        }

        const recoveryInput = {
            ...input,
            currentRequest,
            memoryContext: appendNoopRecoveryContext(
                input.memoryContext,
                currentRequest,
            ),
            maxRepairAttempts: Math.max(input.maxRepairAttempts ?? 0, 1),
            resetWorkspace: false,
        } as TInput;

        return await executeRun(recoveryInput);
    }

    const afterFingerprint = await fingerprintUserVisibleWorkspace(
        input.workspaceRoot,
    );

    if (beforeFingerprint !== afterFingerprint) {
        return firstResult;
    }

    const recoveryInput = {
        ...input,
        currentRequest,
        memoryContext: appendNoopRecoveryContext(
            input.memoryContext,
            currentRequest,
        ),
        maxRepairAttempts: Math.max(input.maxRepairAttempts ?? 0, 1),
        resetWorkspace: false,
    } as TInput;

    return await executeRun(recoveryInput);
}
