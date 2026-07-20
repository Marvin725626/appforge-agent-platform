import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { ReactAppEvalResult } from "@appforge/harness";

const STARTER_MARKERS = [
    "AppForge Starter",
    "React task app workspace",
    "This starter is ready for an agent to customize, build, and repair.",
    "Describe the change you want",
] as const;

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

async function readOptionalText(filePath: string): Promise<string | undefined> {
    try {
        return await readFile(filePath, "utf8");
    } catch {
        return undefined;
    }
}

function normalizeSource(source: string | undefined): string {
    return (source ?? "")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^\s*\/\/.*$/gmu, "")
        .replace(/\s+/gu, "")
        .replace(/;+$/gu, "");
}

function sourceImportSpecifiers(source: string): string[] {
    return [
        ...source.matchAll(
            /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu,
        ),
    ]
        .map((match) => match[1] ?? "")
        .filter((specifier) => specifier.startsWith("."));
}

async function firstExistingPath(candidates: string[]): Promise<string | undefined> {
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            // Try the next TypeScript/JavaScript source candidate.
        }
    }

    return undefined;
}

async function resolveLocalSourceImport(input: {
    workspaceRoot: string;
    importerPath: string;
    specifier: string;
}): Promise<string | undefined> {
    const cleanSpecifier = input.specifier.split(/[?#]/u)[0] ?? "";
    const absoluteBase = path.resolve(path.dirname(input.importerPath), cleanSpecifier);
    const relativeToWorkspace = path.relative(input.workspaceRoot, absoluteBase);

    if (
        relativeToWorkspace.startsWith("..") ||
        path.isAbsolute(relativeToWorkspace)
    ) {
        return undefined;
    }

    const parsed = path.parse(absoluteBase);
    const extensionlessBase = SOURCE_EXTENSIONS.includes(
        parsed.ext as (typeof SOURCE_EXTENSIONS)[number],
    )
        ? path.join(parsed.dir, parsed.name)
        : absoluteBase;
    const candidates = [
        absoluteBase,
        ...SOURCE_EXTENSIONS.map((extension) => `${extensionlessBase}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) =>
            path.join(extensionlessBase, `index${extension}`),
        ),
    ];

    return firstExistingPath([...new Set(candidates)]);
}

async function collectRenderedSourceGraph(workspaceRoot: string): Promise<Map<string, string>> {
    const appPath = path.join(workspaceRoot, "src", "App.tsx");
    const pending = [appPath];
    const visited = new Set<string>();
    const sources = new Map<string, string>();

    while (pending.length > 0) {
        const currentPath = pending.shift()!;
        const normalizedPath = path.normalize(currentPath);
        if (visited.has(normalizedPath)) {
            continue;
        }
        visited.add(normalizedPath);

        const source = await readOptionalText(normalizedPath);
        if (source === undefined) {
            continue;
        }
        sources.set(normalizedPath, source);

        for (const specifier of sourceImportSpecifiers(source)) {
            const resolved = await resolveLocalSourceImport({
                workspaceRoot,
                importerPath: normalizedPath,
                specifier,
            });
            if (resolved && !visited.has(path.normalize(resolved))) {
                pending.push(resolved);
            }
        }
    }

    return sources;
}

function contentImportBindings(source: string): string[] {
    const bindings: string[] = [];
    const importPattern = /\bimport\s+([\s\S]*?)\s+from\s+["'][^"']*\/?content(?:\.[cm]?[jt]sx?)?["']\s*;?/gu;

    for (const match of source.matchAll(importPattern)) {
        const clause = (match[1] ?? "").trim();
        const namedMatch = /\{([^}]*)\}/u.exec(clause);
        if (namedMatch) {
            for (const part of (namedMatch[1] ?? "").split(",")) {
                const alias = part.trim().split(/\s+as\s+/u).at(-1)?.trim();
                if (alias) {
                    bindings.push(alias);
                }
            }
        }

        const namespaceMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/u.exec(clause);
        if (namespaceMatch?.[1]) {
            bindings.push(namespaceMatch[1]);
        }

        const defaultBinding = clause
            .replace(/\{[\s\S]*?\}/gu, "")
            .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/gu, "")
            .split(",")[0]
            ?.trim();
        if (/^[A-Za-z_$][\w$]*$/u.test(defaultBinding ?? "")) {
            bindings.push(defaultBinding!);
        }
    }

    return [...new Set(bindings)];
}

function sourceUsesContentImport(source: string): boolean {
    const bindings = contentImportBindings(source);
    if (bindings.length === 0) {
        return false;
    }

    const sourceWithoutImports = source.replace(/^\s*import[\s\S]*?;\s*$/gmu, "");
    return bindings.some((binding) =>
        new RegExp(`\\b${binding.replace(/[$]/gu, "\\$")}\\b`, "u").test(
            sourceWithoutImports,
        ),
    );
}

export type InitialGenerationCompletenessInput = {
    workspaceRoot: string;
    baselineAppSource?: string;
    baselineContentSource?: string;
    requireVisiblePageStructure?: boolean;
};

export async function evaluateInitialGenerationCompleteness(
    input: InitialGenerationCompletenessInput,
): Promise<ReactAppEvalResult> {
    const appPath = path.join(input.workspaceRoot, "src", "App.tsx");
    const contentPath = path.join(input.workspaceRoot, "src", "content.ts");
    const appSource = await readOptionalText(appPath);
    const contentSource = await readOptionalText(contentPath);
    const renderedSources = await collectRenderedSourceGraph(input.workspaceRoot);
    const combinedRenderedSource = [...renderedSources.values()].join("\n");
    const changedContent =
        normalizeSource(contentSource) !== normalizeSource(input.baselineContentSource);
    const contentIsReachable = [...renderedSources.keys()].some((filePath) =>
        /[\\/]src[\\/]content\.(?:ts|tsx|js|jsx)$/u.test(filePath),
    );
    const contentIsUsed = [...renderedSources.values()].some(sourceUsesContentImport);

    const makeCheck = (
        name: string,
        passed: boolean,
        failureDetail: string,
    ): ReactAppEvalResult["checks"][number] => ({
        name: passed ? name : `${name}: ${failureDetail}`,
        passed,
    });
    const appExists = appSource !== undefined && appSource.trim().length > 0;
    const starterReplaced =
        appSource !== undefined &&
        !STARTER_MARKERS.some((marker) => appSource.includes(marker));
    const appChanged =
        appSource !== undefined &&
        normalizeSource(appSource) !== normalizeSource(input.baselineAppSource);
    const hasHeading =
        /<h1\b/iu.test(combinedRenderedSource) &&
        !STARTER_MARKERS.some((marker) =>
            combinedRenderedSource.includes(marker),
        );
    const hasPrimaryStructure = /<(?:main|section|article)\b/iu.test(
        combinedRenderedSource,
    );

    const checks: ReactAppEvalResult["checks"] = [
        makeCheck(
            "src/App.tsx exists",
            appExists,
            "src/App.tsx is missing or empty.",
        ),
        makeCheck(
            "starter template is replaced",
            starterReplaced,
            "src/App.tsx still contains the AppForge starter template.",
        ),
        makeCheck(
            "src/App.tsx changed substantively",
            appChanged,
            "src/App.tsx is substantively unchanged from the initial baseline.",
        ),
    ];

    if (input.requireVisiblePageStructure) {
        checks.push(
            makeCheck(
                "rendered app has a non-starter heading",
                hasHeading,
                "No non-starter h1 is reachable from src/App.tsx.",
            ),
            makeCheck(
                "rendered app has primary page structure",
                hasPrimaryStructure,
                "No main, section, or article is reachable from src/App.tsx.",
            ),
        );
    }

    if (changedContent && contentSource !== undefined) {
        checks.push(
            makeCheck(
                "generated content module is connected to the rendered app",
                contentIsReachable,
                "src/content.ts changed but is not imported by src/App.tsx or a rendered local component.",
            ),
            makeCheck(
                "generated content module is actually referenced",
                contentIsReachable && contentIsUsed,
                "src/content.ts is imported, but none of its imported bindings are used by rendered source.",
            ),
        );
    }

    return {
        passed: checks.every((check) => check.passed),
        checks,
    };
}
