import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    autofixReactSource,
    autofixReactStyles,
    ensureReactRuntimeImport,
    ensureResponsiveCssSafetyNet,
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


    it("does not escape TypeScript arrows or comparisons before JSX", () => {
        const source = [
            "export function App() {",
            '  const metricsSection = page.sections.find((section) => section.kind === "metrics");',
            "  const remainingSections = metricsSection",
            "      ? page.sections.filter((section) => section.id !== metricsSection.id)",
            "      : page.sections;",
            "  const isBusy = remainingSections.length > 3;",
            "  return <main>{isBusy ? remainingSections.length : 0}</main>;",
            "}",
        ].join("\n");

        expect(escapeInvalidJsxTextGreaterThan(source)).toBe(source);
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

describe("ensureResponsiveCssSafetyNet", () => {
    it("adds an idempotent platform responsive layer", () => {
        const first = ensureResponsiveCssSafetyNet(
            ".dashboard-layout { display: grid; grid-template-columns: 240px 1fr; }",
        );
        const second = ensureResponsiveCssSafetyNet(first);

        expect(first).toContain(
            "appforge platform-responsive-safety-net start",
        );
        expect(first).toContain(
            "grid-template-columns: minmax(0, 1fr) !important",
        );
        expect(first).toContain('[class*="sidebar" i]');
        expect(first).toContain("min-width: 0 !important");
        expect(first).toContain("table-layout: fixed");
        expect(second).toBe(first);
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

    it("applies responsive styles without rewriting stable TSX", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-styles-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        const appPath = path.join(workspaceRoot, "src", "App.tsx");
        const cssPath = path.join(workspaceRoot, "src", "App.css");
        const appSource =
            'export function App() { return <main>{[1].map((item) => <span key={item}>{item}</span>)}</main>; }';
        await writeFile(appPath, appSource, "utf8");
        await writeFile(
            cssPath,
            "table { min-width: 720px; }",
            "utf8",
        );

        const result = await autofixReactStyles(workspaceRoot);
        const fixedApp = await readFile(appPath, "utf8");
        const fixedCss = await readFile(cssPath, "utf8");

        expect(result.changed).toBe(true);
        expect(fixedApp).toBe(appSource);
        expect(fixedCss).toContain("min-width: 0 !important");
        expect(fixedCss).toContain("table-layout: fixed");
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


    it("preserves generated arrow functions and comparisons before a JSX return", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        const appPath = path.join(workspaceRoot, "src", "App.tsx");
        await writeFile(
            appPath,
            [
                "export function App() {",
                '  const metricsSection = page.sections.find((section) => section.kind === "metrics");',
                "  const remainingSections = metricsSection",
                "      ? page.sections.filter((section) => section.id !== metricsSection.id)",
                "      : page.sections;",
                "  const isBusy = remainingSections.length > 3;",
                "  return <main>{isBusy ? remainingSections.length : 0}</main>;",
                "}",
            ].join("\n"),
            "utf8",
        );

        await autofixReactSource(workspaceRoot);
        const fixedSource = await readFile(appPath, "utf8");

        expect(fixedSource).toContain(
            "page.sections.filter((section) => section.id !== metricsSection.id)",
        );
        expect(fixedSource).toContain("remainingSections.length > 3");
        expect(fixedSource).not.toContain("=&gt;");
        expect(fixedSource).not.toContain("length &gt; 3");
    });

    it("applies the platform responsive safety net to generated App.css", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-autofix-"),
        );
        temporaryDirectories.push(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "src"));
        const cssPath = path.join(workspaceRoot, "src", "App.css");
        await writeFile(
            cssPath,
            ".dashboard-layout { display: grid; grid-template-columns: 260px 1fr; }",
            "utf8",
        );

        const first = await autofixReactSource(workspaceRoot);
        const firstCss = await readFile(cssPath, "utf8");
        const second = await autofixReactSource(workspaceRoot);
        const secondCss = await readFile(cssPath, "utf8");

        expect(first.changed).toBe(true);
        expect(first.messages).toContain(
            "Applied the platform responsive CSS safety net before build.",
        );
        expect(firstCss).toContain(
            "appforge platform-responsive-safety-net start",
        );
        expect(second.changed).toBe(false);
        expect(secondCss).toBe(firstCss);
    });

});
