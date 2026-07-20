import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    autofixReactSource,
    ensureReactRuntimeImport,
    escapeInvalidJsxTextGreaterThan,
    insertMissingCommasBetweenStringArrayItems,
    restoreHtmlEscapedArrowOperators,
    restoreMissingClosingTagOpeningAngle,
} from "./react-source-autofix.js";

describe("escapeInvalidJsxTextGreaterThan", () => {
    it("escapes raw greater-than characters inside JSX text", () => {
        expect(
            escapeInvalidJsxTextGreaterThan(
                '<a href="#">更多 >></a>',
            ),
        ).toBe('<a href="#">更多 &gt;&gt;</a>');
    });

    it("does not rewrite normal JSX tags or expressions", () => {
        const source =
            "export function App() { return <div>{items.map((item) => <p>{item}</p>)}</div>; }";

        expect(escapeInvalidJsxTextGreaterThan(source)).toBe(source);
    });

    it("does not rewrite TypeScript arrow operators before JSX", () => {
        const source = [
            "const activeRouteData = useMemo(",
            "  () => mapRoutes.find((route) => route.id === activeRoute) ?? mapRoutes[1],",
            "  [activeRoute],",
            ");",
            "return <main><h1>战区地图</h1></main>;",
        ].join("\n");

        expect(escapeInvalidJsxTextGreaterThan(source)).toBe(source);
    });

    it("escapes JSX text after a nested closing tag without scanning preceding code", () => {
        expect(
            escapeInvalidJsxTextGreaterThan(
                "const render = () => <div><span>状态</span>更多 >></div>;",
            ),
        ).toBe(
            "const render = () => <div><span>状态</span>更多 &gt;&gt;</div>;",
        );
    });
});

describe("restoreMissingClosingTagOpeningAngle", () => {
    it("restores closing tags when the model drops the opening angle", () => {
        expect(
            restoreMissingClosingTagOpeningAngle(
                '<h4>快速导航/h4><a href="#">图书馆/a><span>微信/span>',
            ),
        ).toBe(
            '<h4>快速导航</h4><a href="#">图书馆</a><span>微信</span>',
        );
    });

    it("does not rewrite normal self-closing JSX tags", () => {
        const source = '<img src="/assets/logo.png" alt="Logo" />';

        expect(restoreMissingClosingTagOpeningAngle(source)).toBe(source);
    });
});

describe("insertMissingCommasBetweenStringArrayItems", () => {
    it("inserts a missing comma between string array entries", () => {
        expect(
            insertMissingCommasBetweenStringArrayItems(
                [
                    "export const items = [",
                    '  "北大始于1898年"',
                    '  "思想自由、兼容并包",',
                    "];",
                ].join("\n"),
            ),
        ).toBe(
            [
                "export const items = [",
                '  "北大始于1898年",',
                '  "思想自由、兼容并包",',
                "];",
            ].join("\n"),
        );
    });
});

describe("restoreHtmlEscapedArrowOperators", () => {
    it("restores an HTML-escaped TypeScript arrow without touching JSX entities", () => {
        expect(
            restoreHtmlEscapedArrowOperators(
                "const home = routes.find((route) =&gt; route.path === '/'); const label = 'A &gt; B';",
            ),
        ).toBe(
            "const home = routes.find((route) => route.path === '/'); const label = 'A &gt; B';",
        );
    });
});

describe("ensureReactRuntimeImport", () => {
    it("adds React to an existing named hooks import", () => {
        expect(
            ensureReactRuntimeImport(
                'import { useState } from "react";\nexport function App() { return <main />; }',
            ),
        ).toBe(
            'import React, { useState } from "react";\nexport function App() { return <main />; }',
        );
    });

    it("prepends a React binding when the component has no React import", () => {
        expect(
            ensureReactRuntimeImport(
                "export function App() { return <main />; }",
            ),
        ).toBe(
            'import React from "react";\nexport function App() { return <main />; }',
        );
    });

    it("does not duplicate an existing React runtime binding", () => {
        const source =
            'import React, { useState } from "react";\nexport function App() { return <main />; }';

        expect(ensureReactRuntimeImport(source)).toBe(source);
    });
});

describe("autofixReactSource", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, {
                    recursive: true,
                    force: true,
                    maxRetries: 5,
                    retryDelay: 100,
                }),
            ),
        );

        temporaryDirectories.length = 0;
    });

    it("rewrites src/App.tsx before build", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            'export function App() { return <a href="#">更多 >></a>; }',
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.changed).toBe(true);
        expect(result.messages[0]).toContain(
            "Auto-fixed generated React/TypeScript source",
        );
        expect(fixedSource).toBe(
            'import React from "react";\nexport function App() { return <a href="#">更多 &gt;&gt;</a>; }',
        );
    });

    it("recursively rewrites src/pages/home.tsx before build", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);
        const pagePath = path.join(
            workspaceRoot,
            "src",
            "pages",
            "home.tsx",
        );

        await mkdir(path.dirname(pagePath), { recursive: true });
        await writeFile(
            pagePath,
            'export function Page() { return <main><h1>首页</h1><p>更多 >></p></main>; }',
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(pagePath, "utf8");

        expect(result.changed).toBe(true);
        expect(fixedSource).toBe(
            'import React from "react";\nexport function Page() { return <main><h1>首页</h1><p>更多 &gt;&gt;</p></main>; }',
        );
    });

    it("repairs missing closing tag angles before escaping JSX text", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            'export function App() { return <div><h4>快速导航/h4><a href="#">更多 >></a></div>; }',
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.changed).toBe(true);
        expect(fixedSource).toBe(
            'import React from "react";\nexport function App() { return <div><h4>快速导航</h4><a href="#">更多 &gt;&gt;</a></div>; }',
        );
    });

    it("rewrites generated content modules before build", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "src", "content.ts"),
            [
                "export const intro = [",
                '  "北大创办于1898年"',
                '  "思想自由、兼容并包",',
                "];",
            ].join("\n"),
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(
            path.join(workspaceRoot, "src", "content.ts"),
            "utf8",
        );

        expect(result.changed).toBe(true);
        expect(fixedSource).toContain('"北大创办于1898年",');
    });

    it("does not convert valid arrow functions into HTML entities before build", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                'import { useMemo } from "react";',
                "const routes = [{ id: 'a' }];",
                "export function App() {",
                "  const active = useMemo(",
                "    () => routes.find((route) => route.id === 'a') ?? routes[0],",
                "    [],",
                "  );",
                "  return <main><h1>{active?.id}</h1><p>更多 >></p></main>;",
                "}",
            ].join("\n"),
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.changed).toBe(true);
        expect(fixedSource).toContain(
            "routes.find((route) => route.id === 'a')",
        );
        expect(fixedSource).not.toContain("(route) =&gt;");
        expect(fixedSource).toContain("更多 &gt;&gt;");
    });

    it("restores HTML-escaped arrow functions before build", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export const home = routes.find((route) =&gt; route.path === '/');",
            "utf8",
        );

        const result = await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.changed).toBe(true);
        expect(fixedSource).toContain(
            "routes.find((route) => route.path === '/')",
        );
    });
});
