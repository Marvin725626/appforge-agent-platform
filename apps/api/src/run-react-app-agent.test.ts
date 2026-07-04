import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FakeModelProvider } from "@appforge/agent-core";
import { afterEach, describe, expect, it } from "vitest";

import { runReactAppAgent } from "./run-react-app-agent.js";

describe("runReactAppAgent", () => {
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

    it("copies a starter, runs the agent, and builds the app", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));

        await writeFile(
            path.join(templateRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { const tasks = ['Learn']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "Create a simple app",
            workspaceRoot,
            templateRoot,
            model,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.workspaceRoot).toBe(workspaceRoot);
        expect(result.agent.finished).toBe(true);
        expect(result.install.exitCode).toBe(0);
        expect(result.build.exitCode).toBe(0);
        expect(result.build.stdout).toContain("build ok");
        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.kind).toBe("initial");
        expect(result.eval).toEqual({
            passed: true,
            checks: [
                {
                    name: "has readable text",
                    passed: true,
                },
                {
                    name: "has input",
                    passed: true,
                },
                {
                    name: "has button",
                    passed: true,
                },
                {
                    name: "has task rendering",
                    passed: true,
                },
            ],
        });
        expect(result.review).toEqual({
            accepted: true,
            reason: "Agent finished and install/build/eval passed.",
            checks: {
                agentFinished: true,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
            },
        });
        expect(model.requests[0]?.messages[1]?.content).toContain("Agent plan:");
        expect(model.requests[0]?.messages[1]?.content).toContain("planner");
        expect(model.requests[0]?.messages[1]?.content).toContain("coder");
        expect(model.requests[0]?.messages[1]?.content).toContain("reviewer");
    }, 15_000);
    it("includes memory context in the first agent request", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));

        await writeFile(
            path.join(templateRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { const tasks = ['Learn']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
        ]);

        await runReactAppAgent({
            goal: "Create a simple task app",
            workspaceRoot,
            templateRoot,
            model,
            memoryContext:
                "Recent memory:\n- Goal: Create another task app\n  Outcome: succeeded\n  Summary: Prefer named App exports.",
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(model.requests[0]?.messages[1]?.content).toContain(
            "Recent memory:",
        );
        expect(model.requests[0]?.messages[1]?.content).toContain(
            "Prefer named App exports.",
        );
    }, 15_000);
    it("repairs the app when the first attempt fails eval", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));

        await writeFile(
            path.join(templateRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );

        const badApp =
            "export function App() { return <h1>Hello</h1>; }";

        const goodApp =
            "export function App() { const tasks = ['Learn']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }";

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: badApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "First attempt done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: goodApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Repair done",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "Create a simple task app",
            workspaceRoot,
            templateRoot,
            model,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.eval.passed).toBe(true);
        expect(result.review.accepted).toBe(true);
        expect(result.attempts).toHaveLength(2);
        expect(result.attempts[0]?.kind).toBe("initial");
        expect(result.attempts[0]?.review.accepted).toBe(false);
        expect(result.attempts[1]?.kind).toBe("repair");
        expect(result.attempts[1]?.review.accepted).toBe(true);
        expect(model.requests).toHaveLength(4);
        expect(model.requests[2]?.messages[1]?.content).toContain(
            "Repair request:",
        );
        expect(model.requests[2]?.messages[1]?.content).toContain(
            "Eval passed: no",
        );
    }, 15_000);
    it("keeps repairing until review passes or max repair attempts is reached", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-react-repair-loop-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));

        await writeFile(
            path.join(templateRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );

        const firstBadApp =
            "export function App() { return <div>Broken</div>; }";

        const secondBadApp =
            "export function App() { return <div><input /></div>; }";

        const goodApp =
            "export function App() { const tasks = ['Learn']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }";

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: firstBadApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Initial attempt done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: secondBadApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "First repair done",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: goodApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Second repair done",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "Create a simple task app",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 2,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.review.accepted).toBe(true);
        expect(result.attempts).toHaveLength(3);
        expect(result.attempts[0]?.kind).toBe("initial");
        expect(result.attempts[0]?.review.accepted).toBe(false);
        expect(result.attempts[1]?.kind).toBe("repair");
        expect(result.attempts[1]?.review.accepted).toBe(false);
        expect(result.attempts[2]?.kind).toBe("repair");
        expect(result.attempts[2]?.review.accepted).toBe(true);
        expect(result.trace).toHaveLength(17);
        expect(model.requests).toHaveLength(6);
    }, 20_000);
});
