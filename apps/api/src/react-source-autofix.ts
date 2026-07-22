import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SOURCE_FILES = 200;
const MAX_SOURCE_DIRECTORIES = 400;


const RESPONSIVE_SAFETY_NET_START =
    "/* appforge platform-responsive-safety-net start */";
const RESPONSIVE_SAFETY_NET_END =
    "/* appforge platform-responsive-safety-net end */";

const RESPONSIVE_SAFETY_NET_CSS = `${RESPONSIVE_SAFETY_NET_START}
*,
*::before,
*::after {
    box-sizing: border-box;
}

html,
body,
#root {
    width: 100%;
    max-width: 100%;
    min-width: 0;
}

body,
#root {
    overflow-x: hidden;
}

img,
picture,
video,
canvas,
svg {
    max-width: 100%;
    height: auto;
}

main,
aside,
nav,
header,
footer,
section,
article,
form,
[class*="shell" i],
[class*="layout" i],
[class*="workspace" i],
[class*="workbench" i],
[class*="dashboard" i],
[class*="console" i],
[class*="main" i],
[class*="sidebar" i],
[class*="nav" i],
[class*="content" i],
[class*="panel" i],
[class*="grid" i],
[class*="table" i] {
    min-width: 0;
    max-width: 100%;
}

@media (max-width: 900px) {
    html,
    body,
    #root,
    [class*="shell" i],
    [class*="layout" i],
    [class*="workspace" i],
    [class*="workbench" i] {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
    }

    [class*="shell" i],
    [class*="layout" i],
    [class*="workspace" i],
    [class*="workbench" i] {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-auto-columns: minmax(0, 1fr) !important;
        flex-direction: column !important;
    }

    [class*="shell" i] > *,
    [class*="layout" i] > *,
    [class*="workspace" i] > *,
    [class*="workbench" i] > * {
        min-width: 0 !important;
        max-width: 100% !important;
    }

    main,
    aside,
    [class*="main" i],
    [class*="sidebar" i],
    [class*="content" i] {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        grid-column: 1 / -1 !important;
        flex: 0 1 auto !important;
    }

    aside,
    [class*="sidebar" i] {
        position: static !important;
        inset: auto !important;
        transform: none !important;
    }

    nav,
    [class*="nav" i],
    nav ul,
    [class*="nav" i] ul {
        max-width: 100% !important;
        min-width: 0 !important;
        flex-wrap: wrap !important;
    }

    h1,
    h2,
    h3,
    h4,
    p,
    a,
    button,
    label {
        overflow-wrap: anywhere;
    }

    table {
        display: table;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        table-layout: fixed;
    }

    th,
    td {
        min-width: 0 !important;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    input,
    select,
    textarea,
    button {
        max-width: 100%;
    }
}
${RESPONSIVE_SAFETY_NET_END}`;

export function ensureResponsiveCssSafetyNet(source: string): string {
    const withoutPrevious = source.replace(
        /\n?\/\* appforge platform-responsive-safety-net start \*\/[\s\S]*?\/\* appforge platform-responsive-safety-net end \*\/\n?/u,
        "\n",
    );

    return `${withoutPrevious.trimEnd()}\n\n${RESPONSIVE_SAFETY_NET_CSS}\n`;
}

export type ReactSourceAutofixResult = {
    changed: boolean;
    messages: string[];
};

export type ReactSourceAutofixOptions = {
    responsiveCssSafetyNet?: boolean;
};

const JSX_TEXT_CONTAINER_TAGS =
    "a|p|span|div|li|button|h[1-6]|small|strong|em|label|td|th|caption|section|article|header|footer|main|nav|aside";

export function escapeInvalidJsxTextGreaterThan(source: string): string {
    const jsxTextPattern = new RegExp(
        `(<(?:${JSX_TEXT_CONTAINER_TAGS})\\b[^<>]*>)([^<{}]*>[^<{}]*)(?=<)`,
        "giu",
    );

    return source.replace(
        jsxTextPattern,
        (_match, openingTag: string, text: string) =>
            `${openingTag}${text.replace(/>/gu, "&gt;")}`,
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
                (/\.(?:ts|tsx)$/u.test(entry.name) ||
                    entry.name === "App.css") &&
                sourceFiles.length < MAX_SOURCE_FILES
            ) {
                sourceFiles.push(entryPath);
            }
        }
    }

    return sourceFiles;
}

export async function autofixReactStyles(
    workspaceRoot: string,
    signal?: AbortSignal,
): Promise<ReactSourceAutofixResult> {
    signal?.throwIfAborted();
    const sourceFiles = await listSourceFiles(workspaceRoot, signal);
    const appCssFiles = sourceFiles.filter((filePath) =>
        filePath.endsWith("App.css"),
    );
    let changed = false;

    for (const filePath of appCssFiles) {
        signal?.throwIfAborted();
        const source = await readFile(filePath, "utf8");
        const fixedSource = ensureResponsiveCssSafetyNet(source);

        if (fixedSource === source) {
            continue;
        }

        await writeFile(filePath, fixedSource, "utf8");
        changed = true;
    }

    return changed
        ? {
              changed: true,
              messages: [
                  "Applied the platform responsive CSS safety net before build.",
              ],
          }
        : { changed: false, messages: [] };
}

export async function autofixReactSource(
    workspaceRoot: string,
    signal?: AbortSignal,
    options: ReactSourceAutofixOptions = {},
): Promise<ReactSourceAutofixResult> {
    signal?.throwIfAborted();
    const sourceFiles = await listSourceFiles(workspaceRoot, signal);
    const messages = new Set<string>();
    let changed = false;
    const responsiveCssSafetyNet = options.responsiveCssSafetyNet ?? true;

    for (const filePath of sourceFiles) {
        signal?.throwIfAborted();
        const source = await readFile(filePath, "utf8");
        const fixedSource = filePath.endsWith("App.css")
            ? ensureResponsiveCssSafetyNet(source)
            : (() => {
                  const repairedSource = restoreHtmlEscapedArrowOperators(
                      insertMissingCommasBetweenStringArrayItems(
                          escapeInvalidJsxTextGreaterThan(
                              restoreMissingClosingTagOpeningAngle(source),
                          ),
                      ),
                  );

                  return filePath.endsWith(".tsx")
                      ? ensureReactRuntimeImport(repairedSource)
                      : repairedSource;
              })();
        const finalSource =
            filePath.endsWith("App.css") && !responsiveCssSafetyNet
                ? source
                : fixedSource;

        if (finalSource === source) {
            continue;
        }

        signal?.throwIfAborted();
        await writeFile(filePath, finalSource, "utf8");
        changed = true;
        messages.add(
            filePath.endsWith("App.css")
                ? "Applied the platform responsive CSS safety net before build."
                : "Auto-fixed generated React/TypeScript source before build.",
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
