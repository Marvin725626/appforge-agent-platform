import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeModelProvider } from "./fake-model-provider.js";
import { runCodingAgentLoop } from "./run-coding-agent-loop.js";
import { FakeImageAssetProvider } from "./fake-image-asset-provider.js";
import { ImageAssetTool } from "./image-asset-tool.js";

describe("runCodingAgentLoop", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, {
                    recursive: true,
                    force: true,
                }),
            ),
        );

        temporaryDirectories.length = 0;
    });

    it("runs steps until the model returns finish", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 5,
        });

        const writtenContent = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.finished).toBe(true);
        expect(result.stopReason).toBe("finish");
        expect(result.steps).toHaveLength(2);
        expect(result.steps[0]?.action.type).toBe("write_file");
        expect(result.steps[1]?.action.type).toBe("finish");
        expect(writtenContent).toBe("export default function App() {}");
    });
    it("passes previous step results as context to the next model request", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 5,
        });

        const secondRequestUserMessage = model.requests[1]?.messages[1]?.content;

        expect(secondRequestUserMessage).toContain("Create a React app");
        expect(secondRequestUserMessage).toContain("Previous execution context:");
        expect(secondRequestUserMessage).toContain("Step 1:");
        expect(secondRequestUserMessage).toContain('"type":"write_file"');
        expect(secondRequestUserMessage).toContain('"contentCharacters":32');
        expect(secondRequestUserMessage).not.toContain(
            "export default function App() {}",
        );
        expect(secondRequestUserMessage).toContain("Wrote file: src/App.tsx");
        expect(secondRequestUserMessage).toContain(
            "Completed workspace stages in this attempt:",
        );
    });
    it("does not accept finish before a continuation request changes the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-continuation-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Already done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export function App() { return <h1>Changed</h1>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Changed the draft",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create an app\n\nIteration request:\nChange the background",
            model,
            workspaceRoot,
            maxSteps: 4,
        });

        const writtenContent = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.finished).toBe(true);
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "finish",
        ]);
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Premature finish rejected:",
        );
        expect(writtenContent).toContain("Changed");
    });
    it("does not accept finish before an explicitly required initial workspace change", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-initial-change-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Already done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { return <h1>New page</h1>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Created the initial page",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a new React page",
            model,
            workspaceRoot,
            maxSteps: 4,
            requireWorkspaceChange: true,
        });

        expect(result.finished).toBe(true);
        expect(result.stopReason).toBe("finish");
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "finish",
        ]);
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Premature finish rejected:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "requires a workspace change",
        );
        await expect(
            readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).resolves.toContain("New page");
    });
    it("marks the loop as max_steps_reached when the model never returns finish", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 1,
        });

        expect(result.finished).toBe(false);
        expect(result.stopReason).toBe("max_steps_reached");
        expect(model.requests[0]?.messages[1]?.content).toContain(
            "This is the final allowed action",
        );
    });
    it("keeps completed file edits when a later model request fails", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-partial-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export function App() { return <h1>Partial draft</h1>; }",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 2,
        });

        expect(result.finished).toBe(false);
        expect(result.stopReason).toBe("model_error");
        expect(result.errorMessage).toContain(
            "FakeModelProvider has no response",
        );
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
        ]);
        await expect(
            readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).resolves.toContain("Partial draft");
    });
    it("warns the model to finish when only two steps remain", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 2,
        });

        expect(model.requests[0]?.messages[1]?.content).toContain(
            "You are near the end.",
        );
    });
    it("asks for a final finish action after implementation steps are used", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Finished after finalization prompt.",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 1,
        });

        expect(result.finished).toBe(true);
        expect(result.stopReason).toBe("finish_after_max_steps");
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "finish",
        ]);
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Finalization step:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Do not return write_file",
        );
    });
    it("does not execute non-finish actions returned during finalization", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function App() {}",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export default function BrokenApp() {}",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a React app",
            model,
            workspaceRoot,
            maxSteps: 1,
        });
        const writtenContent = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.finished).toBe(false);
        expect(result.stopReason).toBe("max_steps_reached");
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
        ]);
        expect(writtenContent).toBe("export default function App() {}");
    });
    it("gets an image and uses it in the generated app", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-image-loop-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const imageData = Uint8Array.from([
            137, 80, 78, 71,
        ]);

        const imageProvider =
            new FakeImageAssetProvider({
                data: imageData,
                mediaType: "image/png",
                source: "fake://hero-image",
            });

        const imageAssetTool = new ImageAssetTool({
            workspaceRoot,
            provider: imageProvider,
        });

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "get_image",
                    query: "温州江心屿风景",
                    mode: "search",
                    altText: "温州江心屿风景",
                    outputPath:
                        "public/assets/hero.png",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        'export function App() { return <img src="/assets/hero.png" alt="温州江心屿风景" />; }',
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Created the page with an image.",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "创建一个包含温州风景图片的页面",
            model,
            workspaceRoot,
            maxSteps: 3,
            imageAssetTool,
        });

        expect(result.finished).toBe(true);
        expect(result.stopReason).toBe("finish");
        expect(
            result.steps.map((step) => step.action.type),
        ).toEqual([
            "get_image",
            "write_file",
            "finish",
        ]);

        const savedImage = await readFile(
            path.join(
                workspaceRoot,
                "public",
                "assets",
                "hero.png",
            ),
        );

        expect([...savedImage]).toEqual([...imageData]);

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(appSource).toContain(
            'src="/assets/hero.png"',
        );

        expect(
            model.requests[0]?.messages[0]?.content,
        ).toContain("get_image");

        expect(
            model.requests[1]?.messages[1]?.content,
        ).toContain(
            "Saved image: public/assets/hero.png",
        );
    });

    it("keeps generated module exports and CSS classes in compact stage context", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-stage-metadata-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: "export const heroTitle = 'AppForge';",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.css",
                    content: ".shell { display: grid; } .hero-card { padding: 2rem; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "README.md",
                    content: "Generated app",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/theme.ts",
                    content: "export const accent = '#2563eb';",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/data.ts",
                    content: "export const metrics = [1, 2, 3];",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/utils.ts",
                    content: "export function identity<T>(value: T) { return value; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "import { heroTitle } from './content.js'; import './App.css'; export function App() { return <main className=\"shell\"><h1 className=\"hero-card\">{heroTitle}</h1></main>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Create a complex polished dashboard homepage",
            model,
            workspaceRoot,
            maxSteps: 8,
        });
        const appRequestContext =
            model.requests[6]?.messages[1]?.content ?? "";

        expect(result.finished).toBe(true);
        expect(appRequestContext).toContain(
            "src/content.ts (latest: write_file; successful operations: 1; exports: heroTitle)",
        );
        expect(appRequestContext).toContain(
            "src/App.css (latest: write_file; successful operations: 1; CSS classes: shell, hero-card)",
        );
        expect(appRequestContext).not.toContain(
            "export const heroTitle = 'AppForge';",
        );
    });

    it("caps large read results before sending the next model request", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-read-context-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeFile(
            path.join(workspaceRoot, "large.txt"),
            `${"A".repeat(5_000)}MIDDLE_SENTINEL${"Z".repeat(5_000)}`,
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "read_file",
                    path: "large.txt",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        await runCodingAgentLoop({
            goal: "Inspect the existing file",
            model,
            workspaceRoot,
            maxSteps: 2,
        });

        const secondRequestContext =
            model.requests[1]?.messages[1]?.content ?? "";

        expect(secondRequestContext.length).toBeLessThan(3_000);
        expect(secondRequestContext).toContain("omitted");
        expect(secondRequestContext).not.toContain("MIDDLE_SENTINEL");
    });

    it("does not count an identical write as an iteration change", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-idempotent-iteration-"),
        );
        const appPath = path.join(workspaceRoot, "src", "App.tsx");

        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.dirname(appPath), { recursive: true });
        await writeFile(
            appPath,
            "export function App() { return <h1>Original</h1>; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export function App() { return <h1>Original</h1>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Already done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: "export function App() { return <h1>Updated</h1>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Updated the page",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Iteration request: update the page title",
            model,
            workspaceRoot,
            maxSteps: 4,
        });

        expect(result.finished).toBe(true);
        expect(result.steps[0]?.execution.changed).toBe(false);
        expect(result.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "write_file",
            "finish",
        ]);
        expect(model.requests[2]?.messages[1]?.content).toContain(
            "Premature finish rejected:",
        );
        await expect(readFile(appPath, "utf8")).resolves.toContain(
            "Updated",
        );
    });
});

describe("retryable action validation", () => {
    it("feeds a retryable validation failure back to the repair model", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-loop-retryable-validation-"),
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: 'export const roster = { kicker: "BROKEN",UT" };',
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: 'export const roster = { kicker: "FIXED" };',
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Repaired source",
                }),
            },
        ]);

        const result = await runCodingAgentLoop({
            goal: "Repair the generated app",
            model,
            workspaceRoot,
            maxSteps: 4,
            mode: "repair",
            requireWorkspaceChange: true,
            validateAction: (action) =>
                action.type === "write_file" &&
                action.content.includes('"BROKEN",UT"')
                    ? {
                          ok: false,
                          changed: false,
                          retryable: true,
                          message: "Unterminated string literal",
                      }
                    : undefined,
        });

        const writtenContent = await readFile(
            path.join(workspaceRoot, "src", "content.ts"),
            "utf8",
        );

        expect(result.finished).toBe(true);
        expect(result.stopReason).toBe("finish");
        expect(result.steps).toHaveLength(3);
        expect(result.steps[0]?.execution.retryable).toBe(true);
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Retryable repair action rejected:",
        );
        expect(writtenContent).toContain("FIXED");

        await rm(workspaceRoot, { recursive: true, force: true });
    });
});
