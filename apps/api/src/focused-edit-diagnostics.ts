import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

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
    source:
        | "file_diff"
        | "browser"
        | "computed_style"
        | "build"
        | "manual"
        | "scope";
    file?: string;
    requirementId?: string;
    selector?: string;
    property?: string;
    before?: string;
    after?: string;
    expected?: string;
    actual?: string;
    unexpectedFiles?: string[];
    unexpectedSelectors?: string[];
    unexpectedRanges?: Array<{
        file: string;
        startLine: number;
        endLine: number;
    }>;
    beforeElement?: ElementSnapshot;
    afterElement?: ElementSnapshot;
};

export type FocusedEditRange = {
    file: string;
    kind: "css_rule" | "component" | "jsx_element" | "text_range";
    symbol?: string;
    selector?: string;
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
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
    allowedRanges: FocusedEditRange[];
    confidence: number;
};

export type FocusedEditExecutionMode = "fast_edit" | "structural_edit";

export type ScopeViolation = {
    action: string;
    file: string;
    reason: string;
    attemptedRange?: {
        startOffset: number;
        endOffset: number;
    };
    allowedRanges: FocusedEditRange[];
};

export type BrowserProbe = {
    requirementId: string;
    route?: string;
    selector: string;
    viewport: {
        width: number;
        height: number;
    };
    measurement:
        | "computed_style"
        | "bounding_box"
        | "visibility"
        | "text"
        | "attribute"
        | "element_count";
    property?: string;
    expected?: string | number | boolean;
    tolerance?: number;
};

export type ElementSnapshot = {
    route: string;
    selector: string;
    viewport: {
        width: number;
        height: number;
    };
    exists: boolean;
    visible: boolean;
    text?: string;
    boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    computedStyles: Record<string, string>;
};

export type PreservationResult = {
    status: "PASS" | "FAIL" | "UNVERIFIED";
    unexpectedFiles: string[];
    unexpectedRanges: Array<{
        file: string;
        startLine: number;
        endLine: number;
    }>;
    changedProtectedElements: Array<{
        selector: string;
        changedProperties: string[];
        before?: ElementSnapshot;
        after?: ElementSnapshot;
    }>;
};

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

function lineForOffset(content: string, offset: number): number {
    return content.slice(0, Math.max(0, offset)).split(/\r?\n/u).length;
}

function createRange(input: {
    file: string;
    content: string;
    kind: FocusedEditRange["kind"];
    startOffset: number;
    endOffset: number;
    symbol?: string;
    selector?: string;
}): FocusedEditRange {
    return {
        file: input.file,
        kind: input.kind,
        ...(input.symbol ? { symbol: input.symbol } : {}),
        ...(input.selector ? { selector: input.selector } : {}),
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        startLine: lineForOffset(input.content, input.startOffset),
        endLine: lineForOffset(input.content, input.endOffset),
    };
}

type ParsedCssRule = {
    selector: string;
    startOffset: number;
    endOffset: number;
};

function skipCssComment(content: string, offset: number): number {
    const end = content.indexOf("*/", offset + 2);

    return end === -1 ? content.length : end + 2;
}

function parseCssRules(content: string): ParsedCssRule[] {
    const rules: ParsedCssRule[] = [];
    const stack: Array<{ name: string; startOffset: number }> = [];
    let segmentStart = 0;
    let offset = 0;

    while (offset < content.length) {
        if (content.startsWith("/*", offset)) {
            offset = skipCssComment(content, offset);
            continue;
        }

        const character = content[offset];

        if (character === "{") {
            const rawHeader = content.slice(segmentStart, offset).trim();
            const headerStart =
                segmentStart +
                content.slice(segmentStart, offset).search(/\S/u);
            const safeHeaderStart = headerStart >= segmentStart ? headerStart : segmentStart;

            stack.push({
                name: rawHeader,
                startOffset: safeHeaderStart,
            });
            segmentStart = offset + 1;
        } else if (character === "}") {
            const current = stack.pop();

            if (current && current.name.length > 0 && !current.name.startsWith("@")) {
                rules.push({
                    selector: current.name,
                    startOffset: current.startOffset,
                    endOffset: offset + 1,
                });
            }

            segmentStart = offset + 1;
        }

        offset += 1;
    }

    return rules;
}

function normalizeSelectorToken(selector: string): string {
    return selector
        .trim()
        .replace(/:+[a-z-]+(?:\([^)]*\))?/giu, "")
        .replace(/\s+/gu, " ");
}

function cssSelectorMatches(
    ruleSelector: string,
    requestedSelector: string,
): boolean {
    const requested = normalizeSelectorToken(requestedSelector);

    if (
        requested.length === 0 ||
        requested === "Hero" ||
        requested === "Button" ||
        requested === "AboutPage"
    ) {
        return false;
    }

    return ruleSelector
        .split(",")
        .map(normalizeSelectorToken)
        .some(
            (selectorPart) =>
                selectorPart === requested ||
                selectorPart.includes(`${requested} `) ||
                selectorPart.includes(` ${requested}`) ||
                selectorPart.includes(requested),
        );
}

function findCssAllowedRanges(input: {
    snapshot: FileSnapshot;
    selectors: readonly string[];
}): FocusedEditRange[] {
    if (!/\.(?:css|scss)$/iu.test(input.snapshot.path)) {
        return [];
    }

    const rules = parseCssRules(input.snapshot.content);

    return rules
        .filter((rule) =>
            input.selectors.some((selector) =>
                cssSelectorMatches(rule.selector, selector),
            ),
        )
        .map((rule) =>
            createRange({
                file: input.snapshot.path,
                content: input.snapshot.content,
                kind: "css_rule",
                selector: rule.selector,
                startOffset: rule.startOffset,
                endOffset: rule.endOffset,
            }),
        );
}

function extractComponentNames(request: string): string[] {
    return [
        ...new Set(
            [
                ...request.matchAll(
                    /\b([A-Z][A-Za-z0-9_]*(?:Button|Header|Hero|Page|Card|Panel|Section|Nav|Sidebar)?)\b/gu,
                ),
            ].map((match) => match[1] ?? ""),
        ),
    ].filter((name) => name.length > 0);
}

function jsxElementName(node: ts.JsxOpeningLikeElement): string | undefined {
    const tagName = node.tagName;

    if (ts.isIdentifier(tagName)) {
        return tagName.text;
    }

    if (ts.isPropertyAccessExpression(tagName)) {
        return tagName.name.text;
    }

    return undefined;
}

function jsxClassName(node: ts.JsxOpeningLikeElement): string | undefined {
    for (const property of node.attributes.properties) {
        if (
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "className" &&
            property.initializer
        ) {
            if (ts.isStringLiteral(property.initializer)) {
                return property.initializer.text;
            }

            if (
                ts.isJsxExpression(property.initializer) &&
                property.initializer.expression &&
                ts.isStringLiteral(property.initializer.expression)
            ) {
                return property.initializer.expression.text;
            }
        }
    }

    return undefined;
}

function nodeRange(node: ts.Node, sourceFile: ts.SourceFile): {
    startOffset: number;
    endOffset: number;
} {
    return {
        startOffset: node.getStart(sourceFile),
        endOffset: node.getEnd(),
    };
}

function findTsxAllowedRanges(input: {
    snapshot: FileSnapshot;
    selectors: readonly string[];
    request: string;
}): FocusedEditRange[] {
    if (!/\.(?:tsx|jsx|ts|js)$/iu.test(input.snapshot.path)) {
        return [];
    }

    const sourceFile = ts.createSourceFile(
        input.snapshot.path,
        input.snapshot.content,
        ts.ScriptTarget.Latest,
        true,
        input.snapshot.path.endsWith(".tsx") || input.snapshot.path.endsWith(".jsx")
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS,
    );
    const ranges: FocusedEditRange[] = [];
    const componentNames = new Set([
        ...input.selectors.filter((selector) => /^[A-Z][A-Za-z0-9_]*$/u.test(selector)),
        ...extractComponentNames(input.request),
    ]);
    const wantsButton = input.selectors.some((selector) =>
        /button|Button/iu.test(selector),
    );
    const wantsHero = input.selectors.some((selector) =>
        /hero|Hero/iu.test(selector),
    );
    const wantsFeature = input.selectors.some((selector) =>
        /feature|card|section|article/iu.test(selector),
    );

    const visit = (node: ts.Node): void => {
        if (
            (ts.isFunctionDeclaration(node) ||
                ts.isFunctionExpression(node) ||
                ts.isArrowFunction(node)) &&
            node.parent
        ) {
            const name = ts.isFunctionDeclaration(node)
                ? node.name?.text
                : ts.isVariableDeclaration(node.parent)
                  ? ts.isIdentifier(node.parent.name)
                      ? node.parent.name.text
                      : undefined
                  : undefined;

            if (name && componentNames.has(name)) {
                const range = nodeRange(
                    ts.isVariableDeclaration(node.parent) ? node.parent : node,
                    sourceFile,
                );
                ranges.push(
                    createRange({
                        file: input.snapshot.path,
                        content: input.snapshot.content,
                        kind: "component",
                        symbol: name,
                        ...range,
                    }),
                );
            }
        }

        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            const opening = ts.isJsxElement(node)
                ? node.openingElement
                : node;
            const tagName = jsxElementName(opening);
            const className = jsxClassName(opening);
            const matchesButton = wantsButton && tagName === "button";
            const matchesHero =
                wantsHero && Boolean(className && /hero/iu.test(className));
            const matchesFeature =
                wantsFeature &&
                (tagName === "section" ||
                    tagName === "article" ||
                    Boolean(className && /feature|card/iu.test(className)));
            const matchesSelector = input.selectors.some((selector) => {
                if (!className || !selector.startsWith(".")) {
                    return false;
                }

                return className.split(/\s+/u).includes(selector.slice(1));
            });

            if (matchesButton || matchesHero || matchesFeature || matchesSelector) {
                const range = nodeRange(node, sourceFile);
                ranges.push(
                    createRange({
                        file: input.snapshot.path,
                        content: input.snapshot.content,
                        kind: "jsx_element",
                        ...(tagName ? { symbol: tagName } : {}),
                        ...(className
                            ? { selector: `.${className.split(/\s+/u)[0]}` }
                            : tagName
                              ? { selector: tagName }
                              : {}),
                        ...range,
                    }),
                );
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return ranges;
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
            allowedRanges: [],
            confidence: 0.35,
        };
    }

    for (const componentName of extractComponentNames(request)) {
        selectors.add(componentName);
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
    const allowedRanges = input.beforeSnapshots
        .filter((snapshot) => normalizedAllowedFiles.includes(snapshot.path))
        .flatMap((snapshot) => [
            ...findCssAllowedRanges({
                snapshot,
                selectors: [...selectors],
            }),
            ...findTsxAllowedRanges({
                snapshot,
                selectors: [...selectors],
                request,
            }),
        ])
        .sort(
            (left, right) =>
                left.file.localeCompare(right.file) ||
                left.startOffset - right.startOffset,
        );

    if (normalizedAllowedFiles.length === 0) {
        confidence = Math.min(confidence, 0.45);
    }

    if (allowedRanges.length === 0) {
        confidence = Math.min(confidence, 0.65);
    }

    return {
        intent,
        allowedFiles: normalizedAllowedFiles,
        allowedSelectorsOrComponents: [...selectors].sort(),
        protectedFiles,
        protectedSelectorsOrComponents: [],
        allowedRanges,
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

function rangeAllowedByScope(
    filePath: string,
    attemptedRange: { startOffset: number; endOffset: number },
    scope: FocusedEditScope,
): boolean {
    const normalized = normalizeWorkspacePath(filePath);
    const fileRanges = scope.allowedRanges.filter(
        (range) => range.file === normalized,
    );

    if (fileRanges.length === 0) {
        return false;
    }

    return fileRanges.some(
        (range) =>
            attemptedRange.startOffset >= range.startOffset &&
            attemptedRange.endOffset <= range.endOffset,
    );
}

function findEditOccurrences(
    content: string,
    oldText: string,
    replaceAll: boolean | undefined,
): Array<{ startOffset: number; endOffset: number }> {
    if (oldText.length === 0) {
        return [];
    }

    const ranges: Array<{ startOffset: number; endOffset: number }> = [];
    let offset = content.indexOf(oldText);

    while (offset !== -1) {
        ranges.push({
            startOffset: offset,
            endOffset: offset + oldText.length,
        });

        if (!replaceAll) {
            break;
        }

        offset = content.indexOf(oldText, offset + oldText.length);
    }

    return ranges;
}

export function createScopeViolationForAction(input: {
    action: AgentAction;
    scope: FocusedEditScope;
    beforeSnapshots: FileSnapshot[];
    reason: string;
}): ScopeViolation {
    const filePath =
        input.action.type === "get_image"
            ? input.action.outputPath
            : input.action.type === "write_file" ||
                input.action.type === "append_file" ||
                input.action.type === "edit_file"
              ? input.action.path
              : "";
    const normalizedPath = normalizeWorkspacePath(filePath);
    const snapshot = input.beforeSnapshots.find(
        (item) => item.path === normalizedPath,
    );
    const attemptedRange =
        input.action.type === "edit_file" && snapshot
            ? findEditOccurrences(
                  snapshot.content,
                  input.action.oldText,
                  input.action.replaceAll,
              )[0]
            : undefined;

    return {
        action: input.action.type,
        file: normalizedPath,
        reason: input.reason,
        ...(attemptedRange ? { attemptedRange } : {}),
        allowedRanges: input.scope.allowedRanges.filter(
            (range) => range.file === normalizedPath,
        ),
    };
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
        /\.(?:tsx?|jsx?|s?css)$/iu.test(normalizedPath)
    ) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: write_file would rewrite existing source file ${normalizedPath}; use edit_file for focused edits.`,
        };
    }

    if (action.type === "append_file" && /\.(?:tsx?|jsx?|s?css)$/iu.test(normalizedPath)) {
        return {
            ok: false,
            changed: false,
            message: `Focused edit scope violation: append_file is not allowed for existing component source ${normalizedPath}.`,
        };
    }

    if (action.type === "edit_file") {
        const snapshot = input.beforeSnapshots.find(
            (item) => item.path === normalizedPath,
        );

        if (!snapshot) {
            return {
                ok: false,
                changed: false,
                message: `Focused edit scope violation: ${normalizedPath} was not present in the before snapshot.`,
            };
        }

        const occurrences = findEditOccurrences(
            snapshot.content,
            action.oldText,
            action.replaceAll,
        );

        if (occurrences.length === 0) {
            return {
                ok: false,
                changed: false,
                message: `Focused edit scope violation: oldText was not found in ${normalizedPath}; refusing an unbounded edit.`,
            };
        }

        const forbiddenRange = occurrences.find(
            (occurrence) =>
                !rangeAllowedByScope(normalizedPath, occurrence, scope),
        );

        if (forbiddenRange) {
            return {
                ok: false,
                changed: false,
                message: `Focused edit scope violation: edit in ${normalizedPath} is outside allowed ranges.`,
            };
        }
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

export function findUnexpectedScopeRanges(
    workspaceDiff: WorkspaceDiff,
    scope: FocusedEditScope | undefined,
): Array<{ file: string; startLine: number; endLine: number }> {
    if (!scope) {
        return [];
    }

    return workspaceDiff.changedRanges
        .map((range) => {
            const startLine =
                range.beforeStartLine > 0
                    ? range.beforeStartLine
                    : range.afterStartLine;
            const endLine =
                range.beforeEndLine > 0
                    ? range.beforeEndLine
                    : range.afterEndLine;

            return {
                file: range.file,
                startLine,
                endLine: Math.max(startLine, endLine),
            };
        })
        .filter((range) => pathAllowedByScope(range.file, scope))
        .filter((range) => {
            const allowedRanges = scope.allowedRanges.filter(
                (allowedRange) => allowedRange.file === range.file,
            );

            if (allowedRanges.length === 0) {
                return true;
            }

            return !allowedRanges.some(
                (allowedRange) =>
                    range.startLine >= allowedRange.startLine &&
                    range.endLine <= allowedRange.endLine,
            );
        });
}
