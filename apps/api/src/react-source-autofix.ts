import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SOURCE_FILES = 200;
const MAX_SOURCE_DIRECTORIES = 400;

export type ReactSourceAutofixResult = {
    changed: boolean;
    messages: string[];
};

export function escapeInvalidJsxTextGreaterThan(source: string): string {
    return source.replace(
        /(<\/?[A-Za-z][^<>]*>)([^<{}]*>[^<{}]*)(?=<)/gu,
        (_match, tag: string, text: string) =>
            `${tag}${text.replace(/>/gu, "&gt;")}`,
    );
}

export function restoreMissingClosingTagOpeningAngle(
    source: string,
): string {
    return source.replace(
        /(?<!<)\/(h[1-6]|a|span|p|button|li|ul|ol|div|section|footer|header|main|nav|article|aside)>/gu,
        "</$1>",
    );
}

export function insertMissingCommasBetweenStringArrayItems(
    source: string,
): string {
    return source.replace(
        /(["'`])(\s*\r?\n\s*)(["'`][^"'`]*["'`]\s*(?:,|\]))/gu,
        "$1,$2$3",
    );
}

export function restoreHtmlEscapedArrowOperators(source: string): string {
    return source.replace(/=&gt;/gu, "=>");
}

export function ensureReactRuntimeImport(source: string): string {
    if (!/<[A-Za-z][\w.-]*(?:\s|\/?>)/u.test(source)) {
        return source;
    }

    if (
        /import\s+(?:React(?:\s*,|\s+from)|\*\s+as\s+React\s+from)/u.test(
            source,
        ) ||
        /\b(?:const|let|var)\s+React\b/u.test(source)
    ) {
        return source;
    }

    const namedReactImport =
        /import\s*\{([\s\S]*?)\}\s*from\s*(["'])react\2\s*;?/u;

    if (namedReactImport.test(source)) {
        return source.replace(
            namedReactImport,
            (_match, bindings: string, quote: string) =>
                `import React, {${bindings}} from ${quote}react${quote};`,
        );
    }

    return `import React from "react";\n${source}`;
}

function isMissingPathError(error: unknown): boolean {
    return (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
    );
}

async function listSourceFiles(
    workspaceRoot: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const srcRoot = path.join(workspaceRoot, "src");
    const sourceFiles: string[] = [];
    const directories = [srcRoot];
    let discoveredDirectoryCount = 1;

    try {
        const sourceRootStats = await lstat(srcRoot);

        if (
            sourceRootStats.isSymbolicLink() ||
            !sourceRootStats.isDirectory()
        ) {
            return [];
        }
    } catch (error) {
        if (isMissingPathError(error)) {
            return [];
        }

        throw error;
    }

    while (
        directories.length > 0 &&
        sourceFiles.length < MAX_SOURCE_FILES
    ) {
        signal?.throwIfAborted();
        const directory = directories.shift();

        if (directory === undefined) {
            break;
        }

        let entries;

        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (isMissingPathError(error)) {
                continue;
            }

            throw error;
        }

        for (const entry of entries.sort((left, right) =>
            left.name.localeCompare(right.name),
        )) {
            signal?.throwIfAborted();

            if (entry.isSymbolicLink()) {
                continue;
            }

            const entryPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                if (discoveredDirectoryCount < MAX_SOURCE_DIRECTORIES) {
                    directories.push(entryPath);
                    discoveredDirectoryCount += 1;
                }
                continue;
            }

            if (
                entry.isFile() &&
                /\.(?:ts|tsx)$/u.test(entry.name) &&
                sourceFiles.length < MAX_SOURCE_FILES
            ) {
                sourceFiles.push(entryPath);
            }
        }
    }

    return sourceFiles;
}

export async function autofixReactSource(
    workspaceRoot: string,
    signal?: AbortSignal,
): Promise<ReactSourceAutofixResult> {
    signal?.throwIfAborted();
    const sourceFiles = await listSourceFiles(workspaceRoot, signal);
    const messages = new Set<string>();
    let changed = false;

    for (const filePath of sourceFiles) {
        signal?.throwIfAborted();
        const source = await readFile(filePath, "utf8");
        const repairedSource = insertMissingCommasBetweenStringArrayItems(
            escapeInvalidJsxTextGreaterThan(
                restoreMissingClosingTagOpeningAngle(
                    restoreHtmlEscapedArrowOperators(source),
                ),
            ),
        );
        const fixedSource = filePath.endsWith(".tsx")
            ? ensureReactRuntimeImport(repairedSource)
            : repairedSource;

        if (fixedSource === source) {
            continue;
        }

        signal?.throwIfAborted();
        await writeFile(filePath, fixedSource, "utf8");
        changed = true;
        messages.add(
            "Auto-fixed generated React/TypeScript source before build.",
        );
    }

    if (!changed) {
        return {
            changed: false,
            messages: [],
        };
    }

    return {
        changed: true,
        messages: [...messages],
    };
}
