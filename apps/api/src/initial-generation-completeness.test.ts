import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateInitialGenerationCompleteness } from "./initial-generation-completeness.js";

const createdRoots: string[] = [];

async function createWorkspace(files: Record<string, string>): Promise<string> {
    const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-completeness-"),
    );
    createdRoots.push(workspaceRoot);

    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(workspaceRoot, relativePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf8");
    }

    return workspaceRoot;
}

afterEach(async () => {
    await Promise.all(
        createdRoots.splice(0).map((root) =>
            rm(root, { recursive: true, force: true }),
        ),
    );
});

describe("evaluateInitialGenerationCompleteness", () => {
    const starter = `import React from "react";
export function App() {
  return <main><p>AppForge Starter</p><h1>React task app workspace</h1></main>;
}`;

    it("rejects an unchanged starter App.tsx", async () => {
        const workspaceRoot = await createWorkspace({
            "src/App.tsx": starter,
        });

        const result = await evaluateInitialGenerationCompleteness({
            workspaceRoot,
            baselineAppSource: starter,
            requireVisiblePageStructure: true,
        });

        expect(result.passed).toBe(false);
        expect(result.checks.some((check) =>
            check.name.includes("starter template is replaced"),
        )).toBe(true);
    });

    it("rejects generated content that is not connected to the rendered app", async () => {
        const workspaceRoot = await createWorkspace({
            "src/App.tsx": `import React from "react";
export function App() {
  return <main><section><h1>Tactical command</h1></section></main>;
}`,
            "src/content.ts": `export const features = [{ title: "Trace" }];`,
        });

        const result = await evaluateInitialGenerationCompleteness({
            workspaceRoot,
            baselineAppSource: starter,
            requireVisiblePageStructure: true,
        });

        expect(result.passed).toBe(false);
        expect(result.checks.some((check) =>
            check.name.includes("content.ts changed but is not imported"),
        )).toBe(true);
    });

    it("accepts content imported and used by a rendered page component", async () => {
        const workspaceRoot = await createWorkspace({
            "src/App.tsx": `import React from "react";
import { HomePage } from "./pages/home.js";
export function App() { return <main><HomePage /></main>; }`,
            "src/pages/home.tsx": `import React from "react";
import { features } from "../content.js";
export function HomePage() {
  return <article><h1>Tactical command</h1><section>{features[0]?.title}</section></article>;
}`,
            "src/content.ts": `export const features = [{ title: "Trace" }];`,
        });

        const result = await evaluateInitialGenerationCompleteness({
            workspaceRoot,
            baselineAppSource: starter,
            requireVisiblePageStructure: true,
        });

        expect(result.passed).toBe(true);
        expect(result.checks.every((check) => check.passed)).toBe(true);
    });
});
