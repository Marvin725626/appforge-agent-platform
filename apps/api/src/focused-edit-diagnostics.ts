import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { ActionExecutionResult } from "@appforge/agent-core";
import type { AgentAction } from "@appforge/protocol";

export type FileSnapshot = {
    path: string;
    hash: string;
    content: string;
};

export type WorkspaceDiff = {
    addedFiles: string[];
    deletedFiles: string[];
    modifiedFiles: string[];
    unchangedFiles: string[];
    changedRanges: Array<{
        file: string;
        beforeStartLine: number;
        beforeEndLine: number;
        afterStartLine: number;
        afterEndLine: number;
    }>;
};

export type RequirementEvidence = {
    source: "file_diff" | "browser" | "computed_style" | "build" | "manual";
    file?: string;
    selector?: string;
    property?: string;
    before?: string;
    after?: string;
    expected?: string;
    actual?: string;
    unexpectedFiles?: string[];
    unexpectedSelectors?: string[];
};

export type FocusedEditScope = {
    intent:
        | "text"
        | "color"
        | "spacing"
        | "size"
        | "position"
        | "visibility"
        | "delete"
        | "responsive"
        | "asset"
        | "interaction";
    allowedFiles: string[];
    allowedSelectorsOrComponents: string[];
    protectedFiles: string[];
    protectedSelectorsOrComponents: string[];
    confidence: number;
};

export type FocusedEditExecutionMode = "fast_edit" | "structural_edit";

const SNAPSHOT_ROOT_FILES = [
    "package.json",
    "package-lock.json",
    "index.html",
];
const SNAPSHOT_SOURCE_EXTENSION = /\.(?:tsx?|jsx?|css|scss)$/iu;
const EXCLUDED_DIRECTORIES = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
]);

function normalizeWorkspacePath(filePath: string): string {
    return filePath.replace(/\\/gu, "/").replace(/^\/+/u, "");
}

function sha256(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function listSnapshotSourceFiles(
    workspaceRoot: string,
    relativeDirectory = "src",
): Promise<string[]> {
    const absoluteDirectory = path.join(workspaceRoot, relativeDirectory);

    if (!(await pathExists(absoluteDirectory))) {
        return [];
    }

    const entries = await readdir(absoluteDirectory, {
        withFileTypes: true,
    });
    const files: string[] = [];

    for (const entry of entries) {
        const relativePath = normalizeWorkspacePath(
            path.join(relativeDirectory, entry.name),
        );

        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
                files.push(
                    ...(await listSnapshotSourceFiles(
                        workspaceRoot,
                        relativePath,
                    )),
                );
            }
            continue;
        }

        if (entry.isFile() && SNAPSHOT_SOURCE_EXTENSION.test(entry.name)) {
            files.push(relativePath);
        }
    }

    return files.sort();
}

export async function createWorkspaceSnapshot(
    workspaceRoot: string,
): Promise<FileSnapshot[]> {
    const candidateFiles = [
        ...SNAPSHOT_ROOT_FILES,
        ...(await listSnapshotSourceFiles(workspaceRoot)),
    ];
    const snapshots: FileSnapshot[] = [];

    for (const relativePath of candidateFiles) {
        const absolutePath = path.join(workspaceRoot, relativePath);

        if (!(await pathExists(absolutePath))) {
            continue;
        }

        const content = await readFile(absolutePath, "utf8");
        snapshots.push({
            path: normalizeWorkspacePath(relativePath),
            hash: sha256(content),
            content,
        });
    }

    return snapshots.sort((left, right) => left.path.localeCompare(right.path));
}

function computeChangedRange(
    file: string,
    before: string,
    after: string,
): WorkspaceDiff["changedRanges"][number] {
    const beforeLines = before.split(/\r?\n/u);
    const afterLines = after.split(/\r?\n/u);
    let prefix = 0;

    while (
        prefix < beforeLines.length &&
        prefix < afterLines.length &&
        beforeLines[prefix] === afterLines[prefix]
    ) {
        prefix += 1;
    }

    let suffix = 0;

    while (
        suffix < beforeLines.length - prefix &&
        suffix < afterLines.length - prefix &&
        beforeLines[beforeLines.length - 1 - suffix] ===
            afterLines[afterLines.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    return {
        file,
        beforeStartLine: Math.min(prefix + 1, Math.max(1, beforeLines.length)),
        beforeEndLine: Math.max(prefix + 1, beforeLines.length - suffix),
        afterStartLine: Math.min(prefix + 1, Math.max(1, afterLines.length)),
        afterEndLine: Math.max(prefix + 1, afterLines.length - suffix),
    };
}

export function diffWorkspaceSnapshots(
    beforeSnapshots: FileSnapshot[],
    afterSnapshots: FileSnapshot[],
): WorkspaceDiff {
    const before = new Map(
        beforeSnapshots.map((snapshot) => [snapshot.path, snapshot]),
    );
    const after = new Map(
        afterSnapshots.map((snapshot) => [snapshot.path, snapshot]),
    );
    const allFiles = [...new Set([...before.keys(), ...after.keys()])].sort();
    const addedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const unchangedFiles: string[] = [];
    const changedRanges: WorkspaceDiff["changedRanges"] = [];

    for (const file of allFiles) {
        const beforeSnapshot = before.get(file);
        const afterSnapshot = after.get(file);

        if (!beforeSnapshot && afterSnapshot) {
            addedFiles.push(file);
            changedRanges.push({
                file,
                beforeStartLine: 1,
                beforeEndLine: 1,
                afterStartLine: 1,
                afterEndLine: Math.max(
                    1,
                    afterSnapshot.content.split(/\r?\n/u).length,
                ),
            });
            continue;
        }

        if (beforeSnapshot && !afterSnapshot) {
            deletedFiles.push(file);
            changedRanges.push({
                file,
                beforeStartLine: 1,
                beforeEndLine: Math.max(
                    1,
                    beforeSnapshot.content.split(/\r?\n/u).length,
                ),
                afterStartLine: 1,
                afterEndLine: 1,
            });
            continue;
        }

        if (!beforeSnapshot || !afterSnapshot) {
            continue;
        }

        if (beforeSnapshot.hash === afterSnapshot.hash) {
            unchangedFiles.push(file);
            continue;
        }

        modifiedFiles.push(file);
        changedRanges.push(
            computeChangedRange(
                file,
                beforeSnapshot.content,
                afterSnapshot.content,
            ),
        );
    }

    return {
        addedFiles,
        deletedFiles,
        modifiedFiles,
        unchangedFiles,
        changedRanges,
    };
}

function snapshotFileExists(
    snapshots: readonly FileSnapshot[],
    filePath: string,
): boolean {
    return snapshots.some((snapshot) => snapshot.path === filePath);
}

function listSourceFiles(snapshots: readonly FileSnapshot[]): string[] {
    return snapshots
        .map((snapshot) => snapshot.path)
        .filter((filePath) => /^src\//u.test(filePath))
        .sort();
}

function filesMatching(
    snapshots: readonly FileSnapshot[],
    pattern: RegExp,
): string[] {
    return snapshots
        .filter(
            (snapshot) =>
                pattern.test(snapshot.path) || pattern.test(snapshot.content),
        )
        .map((snapshot) => snapshot.path)
        .sort();
}

function extractExplicitSelectors(request: string): string[] {
    return [
        ...new Set(
            [...request.matchAll(/(?:^|\s)([.#][a-zA-Z][\w-]*)/gu)].map(
                (match) => match[1] ?? "",
            ),
        ),
    ].filter((selector) => selector.length > 0);
}

function inferIntent(request: string): FocusedEditScope["intent"] {
    if (/\b(?:image|photo|hero image|asset)\b|图片|照片|素材/iu.test(request)) {
        return "asset";
    }
    if (/\b(?:color|background|contrast|blue|gray|grey)\b|颜色|背景|对比|蓝色|灰色/iu.test(request)) {
        return "color";
    }
    if (/\b(?:width|height|size|font-size|larger|smaller)\b|宽度|高度|尺寸|字号|字体|缩小|放大/iu.test(request)) {
        return "size";
    }
    if (/\b(?:spacing|padding|margin|gap)\b|间距|留白/iu.test(request)) {
        return "spacing";
    }
    if (/\b(?:move|left|right|top|bottom|position)\b|移动|左|右|上|下|位置/iu.test(request)) {
        return "position";
    }
    if (/\b(?:hide|show|visible|visibility)\b|隐藏|显示|可见/iu.test(request)) {
        return "visibility";
    }
    if (/\b(?:delete|remove)\b|删除|移除/iu.test(request)) {
        return "delete";
    }
    if (/\b(?:mobile|desktop|responsive|viewport|single column)\b|手机|桌面|响应式|单列/iu.test(request)) {
        return "responsive";
    }
    if (/\b(?:click|route|link|interaction|navigation)\b|点击|跳转|导航|交互/iu.test(request)) {
        return "interaction";
    }

    return "text";
}

export async function locateFocusedEditScope(input: {
    request: string;
    workspaceRoot: string;
    beforeSnapshots: FileSnapshot[];
}): Promise<FocusedEditScope> {
    const request = input.request;
    const sourceFiles = listSourceFiles(input.beforeSnapshots);
    const allowedFiles = new Set<string>();
    const selectors = new Set<string>();
    let confidence = 0.78;
    const intent = inferIntent(request);
    const explicitSelectors = extractExplicitSelectors(request);

    if (/package\.json|lockfile|dependency|dependencies|npm install|script|脚本|依赖/iu.test(request)) {
        return {
            intent: "interaction",
            allowedFiles: ["package.json", "package-lock.json"],
            allowedSelectorsOrComponents: [],
            protectedFiles: sourceFiles,
            protectedSelectorsOrComponents: [],
            confidence: 0.35,
        };
    }

    if (explicitSelectors.length > 0) {
        for (const selector of explicitSelectors) {
            selectors.add(selector);
        }

        const selectorPattern = new RegExp(
            explicitSelectors
                .map((selector) =>
                    selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
                )
                .join("|"),
            "iu",
        );
        const selectorFiles = filesMatching(
            input.beforeSnapshots,
            selectorPattern,
        );

        for (const filePath of selectorFiles) {
            allowedFiles.add(filePath);
        }

        if (selectorFiles.length === 0) {
            confidence = 0.45;
        }
    }

    if (/\babout\b|\/about|关于/iu.test(request)) {
        const aboutFiles = sourceFiles.filter((filePath) =>
            /(?:^|\/)about\.(?:tsx?|jsx?)$/iu.test(filePath),
        );
        for (const filePath of aboutFiles.length > 0
            ? aboutFiles
            : ["src/App.tsx"]) {
            allowedFiles.add(filePath);
        }
        selectors.add("AboutPage");
        selectors.add("[data-route='/about']");
    } else if (/\bhero\b|首屏|头图|主视觉/iu.test(request)) {
        for (const filePath of filesMatching(input.beforeSnapshots, /hero|page-hero|Hero/iu)) {
            allowedFiles.add(filePath);
        }
        allowedFiles.add("src/App.css");
        allowedFiles.add("src/App.tsx");
        selectors.add(".hero");
        selectors.add(".page-hero");
        selectors.add("Hero");
    } else if (/\bsidebar\b|左侧栏|侧边栏/iu.test(request)) {
        for (const filePath of filesMatching(input.beforeSnapshots, /sidebar|aside|侧边栏|左侧栏/iu)) {
            allowedFiles.add(filePath);
        }
        allowedFiles.add("src/App.css");
        allowedFiles.add("src/App.tsx");
        selectors.add(".sidebar");
        selectors.add(".app-sidebar");
        selectors.add("aside");
    } else if (/\bbutton\b|按钮/iu.test(request)) {
        for (const filePath of filesMatching(input.beforeSnapshots, /<button|button|\.button|Button/iu)) {
            allowedFiles.add(filePath);
        }
        selectors.add("button");
        selectors.add(".button");
        selectors.add("Button");
    } else if (/\b(?:feature|module|section|card)\b|模块|区块|卡片/iu.test(request)) {
        for (const filePath of filesMatching(input.beforeSnapshots, /feature|module|section|card|<article|<section/iu)) {
            allowedFiles.add(filePath);
        }
        allowedFiles.add("src/App.css");
        allowedFiles.add("src/App.tsx");
        selectors.add("section");
        selectors.add("article");
        selectors.add(".feature");
        selectors.add(".card");
    } else {
        for (const filePath of filesMatching(input.beforeSnapshots, /className|export function|<main|<section/iu).slice(0, 4)) {
            allowedFiles.add(filePath);
        }
        if (explicitSelectors.length === 0) {
            confidence = 0.7;
        }
    }

    if (
        intent === "color" ||
        intent === "spacing" ||
        intent === "size" ||
        intent === "position" ||
        intent === "visibility" ||
        intent === "responsive"
    ) {
        allowedFiles.add("src/App.css");
    }

    if (intent === "asset") {
        allowedFiles.add("src/App.tsx");
        allowedFiles.add("src/App.css");
        allowedFiles.add("public/assets/*");
        selectors.add("img");
        selectors.add(".hero img");
    }

    const normalizedAllowedFiles = [...allowedFiles]
        .filter(
            (filePath) =>
                filePath === "public/assets/*" ||
                snapshotFileExists(input.beforeSnapshots, filePath),
        )
        .sort();
    const protectedFiles = sourceFiles
        .filter((filePath) => !normalizedAllowedFiles.includes(filePath))
        .sort();

    if (normalizedAllowedFiles.length === 0) {
        confidence = Math.min(confidence, 0.45);
    }

    return {
        intent,
        allowedFiles: normalizedAllowedFiles,
        allowedSelectorsOrComponents: [...selectors].sort(),
        protectedFiles,
        protectedSelectorsOrComponents: [],
        confidence,
    };
}

function pathAllowedByScope(filePath: string, scope: FocusedEditScope): boolean {
    const normalized = normalizeWorkspacePath(filePath);

    return scope.allowedFiles.some((allowedFile) =>
        allowedFile.endsWith("/*")
            ? normalized.startsWith(allowedFile.slice(0, -1))
            : normalized === allowedFile,
    );
}

function isMutatingAction(action: AgentAction): boolean {
    return (
        action.type === "write_file" ||
        action.type === "append_file" ||
        action.type === "edit_file" ||
        action.type === "get_image"
    );
}

export function validateFocusedEditAction(input: {
    action: AgentAction;
    scope: FocusedEditScope;
    beforeSnapshots: FileSnapshot[];
}): ActionExecutionResult | undefined {
    const { action, scope } = input;

    if (!isMutatingAction(action)) {
        return undefined;
    }

    const filePath =
        action.type === "get_image"
            ? action.outputPath
            : action.type === "write_file" ||
                action.type === "append_file" ||
                action.type === "edit_file"
              ? action.path
              : "";
    const normalizedPath = normalizeWorkspacePath(filePath);
    const forbiddenManifest =
        normalizedPath === "package.json" ||
        normalizedPath === "package-lock.json" ||
        normalizedPath === "npm-shrinkwrap.json";

    if (forbiddenManifest) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: ${normalizedPath} cannot be modified in fast edit.`,
        };
    }

    if (!pathAllowedByScope(normalizedPath, scope)) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: ${normalizedPath} is outside allowed files (${scope.allowedFiles.join(", ")}).`,
        };
    }

    if (
        action.type === "write_file" &&
        snapshotFileExists(input.beforeSnapshots, normalizedPath) &&
        /\.(?:tsx?|jsx?)$/iu.test(normalizedPath)
    ) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: write_file would rewrite existing source file ${normalizedPath}; use edit_file for focused edits.`,
        };
    }

    if (action.type === "append_file" && /\.(?:tsx?|jsx?)$/iu.test(normalizedPath)) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: append_file is not allowed for existing component source ${normalizedPath}.`,
        };
    }

    if (action.type === "get_image" && scope.intent !== "asset") {
        return {
            ok: false,
            changed: false,
            message: "Focused edit scope violation: image changes are only allowed for asset-focused requests.",
        };
    }

    return undefined;
}

export function createFileDiffEvidence(
    workspaceDiff: WorkspaceDiff,
): RequirementEvidence[] {
    return workspaceDiff.changedRanges.map((range) => ({
        source: "file_diff",
        file: range.file,
        before: `${range.beforeStartLine}-${range.beforeEndLine}`,
        after: `${range.afterStartLine}-${range.afterEndLine}`,
    }));
}

export function findUnexpectedScopeFiles(
    workspaceDiff: WorkspaceDiff,
    scope: FocusedEditScope | undefined,
): string[] {
    if (!scope) {
        return [];
    }

    return [
        ...workspaceDiff.addedFiles,
        ...workspaceDiff.deletedFiles,
        ...workspaceDiff.modifiedFiles,
    ].filter((filePath) => !pathAllowedByScope(filePath, scope));
}
