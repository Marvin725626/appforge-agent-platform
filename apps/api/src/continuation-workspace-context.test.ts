import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateReactApp } from "@appforge/harness";

import {
    formatBuildErrorSourceExcerpt,
    formatContinuationWorkspaceContext,
    formatStaticEvaluationSource,
} from "./run-react-app-agent.js";

describe("formatContinuationWorkspaceContext", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    async function createLargeWorkspace(): Promise<string> {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-continuation-context-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src", "components"));
        await Promise.all([
            writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                `export const app = ${JSON.stringify("app-shell-".repeat(900))};`,
                "utf8",
            ),
            writeFile(
                path.join(workspaceRoot, "src", "App.css"),
                ".brand-logo { color: white; background: white; } /* LOGO_CONTRAST_MARKER */",
                "utf8",
            ),
            writeFile(
                path.join(workspaceRoot, "src", "content.ts"),
                "export const news = ['NEWS_CONTENT_MARKER'];",
                "utf8",
            ),
            writeFile(
                path.join(
                    workspaceRoot,
                    "src",
                    "components",
                    "Header.tsx",
                ),
                "export function Header() { return <header>HEADER_COMPONENT_MARKER</header>; }",
                "utf8",
            ),
            writeFile(
                path.join(
                    workspaceRoot,
                    "src",
                    "components",
                    "Header.test.tsx",
                ),
                "export const ignored = 'TEST_FILE_MARKER';",
                "utf8",
            ),
        ]);
        return workspaceRoot;
    }

    it("puts CSS before a large App file for a focused logo visibility request", async () => {
        const workspaceRoot = await createLargeWorkspace();
        const context = await formatContinuationWorkspaceContext(
            workspaceRoot,
            "左上角 logo 的颜色和背景一样，看不见",
        );

        expect(context).toContain("LOGO_CONTRAST_MARKER");
        expect(context).toContain("NEWS_CONTENT_MARKER");
        expect(context.indexOf("--- src/App.css ---")).toBeLessThan(
            context.indexOf("--- src/App.tsx ---"),
        );
    });

    it("puts content before App for a focused news-content request", async () => {
        const workspaceRoot = await createLargeWorkspace();
        const context = await formatContinuationWorkspaceContext(
            workspaceRoot,
            "更新最新资讯内容",
        );

        expect(context.indexOf("--- src/content.ts ---")).toBeLessThan(
            context.indexOf("--- src/App.tsx ---"),
        );
        expect(context).toContain("LOGO_CONTRAST_MARKER");
    });

    it("includes a matching nested component without letting App consume the context", async () => {
        const workspaceRoot = await createLargeWorkspace();
        const context = await formatContinuationWorkspaceContext(
            workspaceRoot,
            "Update the Header logo contrast",
        );

        expect(context).toContain("HEADER_COMPONENT_MARKER");
        expect(context).not.toContain("TEST_FILE_MARKER");
        expect(context).toContain("LOGO_CONTRAST_MARKER");
        expect(context).toContain("NEWS_CONTENT_MARKER");
        expect(
            context.indexOf("--- src/components/Header.tsx ---"),
        ).toBeLessThan(context.indexOf("--- src/App.tsx ---"));
        expect(context.match(/^--- /gmu)?.length ?? 0).toBeLessThanOrEqual(12);
    });

    it("evaluates page content from a split nested page instead of only App", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-split-eval-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src", "pages"), {
            recursive: true,
        });
        await Promise.all([
            writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                'import { Home } from "./pages/Home.js";\nexport function App() { return <Home />; }',
                "utf8",
            ),
            writeFile(
                path.join(workspaceRoot, "src", "pages", "Home.tsx"),
                "export function Home() { return <main><h1>Explore Wenzhou</h1><p>Discover the city, its landscape, food, living traditions, neighborhoods, and welcoming local culture through this complete introduction.</p></main>; }",
                "utf8",
            ),
        ]);

        const source = await formatStaticEvaluationSource(workspaceRoot);
        const result = evaluateReactApp({
            source,
            goal: "Create a city introduction page",
        });

        expect(source.indexOf("--- src/App.tsx ---")).toBeLessThan(
            source.indexOf("--- src/pages/Home.tsx ---"),
        );
        expect(source).toContain("Explore Wenzhou");
        expect(result.passed).toBe(true);
    });

    it("shows the nested source file referenced by a build error", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-build-excerpt-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src", "components"), {
            recursive: true,
        });
        await writeFile(
            path.join(workspaceRoot, "src", "components", "Header.tsx"),
            [
                "export function Header() {",
                "  return <header>BUILD_ERROR_MARKER</header>;",
                "}",
            ].join("\n"),
            "utf8",
        );

        const excerpt = await formatBuildErrorSourceExcerpt(
            workspaceRoot,
            "src/components/Header.tsx:2:18 - error TS1005",
        );
        const unsafeExcerpt = await formatBuildErrorSourceExcerpt(
            workspaceRoot,
            "src/../../outside.ts:1:1 - error TS1005",
        );

        expect(excerpt).toContain("Source: src/components/Header.tsx");
        expect(excerpt).toContain("BUILD_ERROR_MARKER");
        expect(unsafeExcerpt).toBe("");
    });
});
