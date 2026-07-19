import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    FakeImageAssetProvider,
    FakeModelProvider,
    type ModelProvider,
} from "@appforge/agent-core";
import { afterEach, describe, expect, it } from "vitest";

import {
    classifyNavigationRequest,
    runReactAppAgent,
} from "./run-react-app-agent.js";
import { createFallbackDesignPlan } from "./design-plan-utils.js";

describe("runReactAppAgent", () => {
    const temporaryDirectories: string[] = [];
    const PLANNER_RESPONSE = {
        content: JSON.stringify({
            summary: "Implement the requested React application",
            steps: [
                {
                    id: "step-1",
                    title: "Implement the interface",
                    description: "Build the requested UI in src/App.tsx.",
                    acceptanceCriteria: [
                        "The application satisfies the user goal",
                        "The application builds successfully",
                    ],
                },
            ],
        }),
    };
    const APPROVED_REVIEW_RESPONSE = {
        content: JSON.stringify({
            accepted: true,
            reason: "The generated app satisfies the requested goal.",
            issues: [],
        }),
    };
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

    it.each([
        ["我想要一个介绍温州的界面并且可以跳转", "routes"],
        ["做一个温州主题网页，支持页面切换", "routes"],
        ["创建完整温州介绍网站，包含首页、文化和行程三个页面", "routes"],
        ["点击导航跳到页面内的学校概况板块", "in-page"],
        ["页面跳转这种要求", "routes"],
        ["点击按钮进入对应页面", "routes"],
        ["Add page navigation for Home and About", "routes"],
        ["Let users navigate between pages", "routes"],
        ["Add page switching between Home and Game Modes", "routes"],
        ["Apex 界面切换", "routes"],
        ["Open the admissions page from the menu", "routes"],
        ["跳到页面内的学校概况板块", "in-page"],
        ["当前页滚动到介绍锚点", "in-page"],
        ["Jump to the matching sections on the same page", "in-page"],
        [
            "Make the homepage navigation buttons jump to the matching introduction sections",
            "in-page",
        ],
        ["Polish the existing header spacing", "none"],
    ] as const)("classifies navigation goal %s as %s", (goal, expected) => {
        expect(classifyNavigationRequest(goal)).toBe(expected);
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
            PLANNER_RESPONSE,
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
            APPROVED_REVIEW_RESPONSE,
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
            reason: "Agent finished and install/build/static eval passed.",
            checks: {
                agentFinished: true,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
            },
        });
        expect(model.requests[1]?.messages[1]?.content).toContain("Agent plan:");
        expect(model.requests[1]?.messages[1]?.content).toContain("planner");
        expect(model.requests[1]?.messages[1]?.content).toContain("coder");
        expect(model.requests[1]?.messages[1]?.content).toContain("reviewer");
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "The application builds successfully",
        );
    }, 15_000);

    it("records Design Planner calls separately from ordinary Planner calls", async () => {
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

        const plannerOutput = JSON.parse(PLANNER_RESPONSE.content);
        const designPlan = createFallbackDesignPlan({
            goal: "Create a polished product page",
            plannerOutput,
            routes: [{ path: "/", purpose: "Product landing page" }],
        });
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify(designPlan),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { return <main><h1>Product page</h1><input aria-label=\"email\" /><button>Start</button><p>Useful product workflow details.</p></main>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "Create a polished product page",
            workspaceRoot,
            templateRoot,
            model,
            designPlanning: true,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.metrics?.plannerCalls).toBe(1);
        expect(result.metrics?.designPlannerCalls).toBe(1);
        expect(result.metrics?.plannerDurationMs).toBeGreaterThanOrEqual(0);
        expect(result.metrics?.designPlannerDurationMs).toBeGreaterThanOrEqual(
            0,
        );
        expect(result.designPlanSource).toBe("planner");
        expect(result.designPlan).toEqual(designPlan);
    }, 15_000);

    it("uses the focused edit fast path for a small button text change", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export function App() { return <main><button>Start</button><p>Keep this copy.</p></main>; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.tsx",
                    oldText: "<button>Start</button>",
                    newText: "<button>Submit</button>",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Updated the button text only.",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "Create a simple button page",
            currentRequest:
                "Change the button text to Submit and do not modify other areas",
            resetWorkspace: false,
            workspaceRoot,
            templateRoot,
            model,
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "button text is Submit", passed: true }],
                evidence: [
                    {
                        source: "browser",
                        requirementId: "REQ-1",
                        selector: "button",
                        property: "textContent",
                        expected: "Submit",
                        actual: "Submit",
                    },
                ],
            }),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.review.accepted).toBe(true);
        expect(result.metrics?.plannerCalls).toBe(0);
        expect(result.metrics?.reviewerCalls).toBe(0);
        expect(result.metrics?.installDurationMs).toBe(0);
        expect(result.install.stdout).toContain("Skipped npm install");
        expect(result.metrics?.modifiedFiles).toEqual(["src/App.tsx"]);
        expect(
            result.requirements?.find((item) => item.id === "REQ-1")?.status,
        ).toBe("PASS");
        expect(
            result.requirements?.find((item) => item.id === "PRESERVE-1")
                ?.status,
        ).toBe("PASS");
        expect(model.requests).toHaveLength(2);
        expect(model.requests[0]?.messages[1]?.content).toContain(
            "Focused Edit Fast Path",
        );
    });

    it("does not launch another full attempt after the coding model times out", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-model-timeout-"),
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

        const model = new FakeModelProvider([PLANNER_RESPONSE]);
        const progressStages: string[] = [];
        const result = await runReactAppAgent({
            goal: "Create a task app",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 2,
            onProgress: (stage) => {
                progressStages.push(stage);
            },
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.attempts).toHaveLength(1);
        expect(result.agent.stopReason).toBe("model_error");
        expect(result.review.accepted).toBe(false);
        expect(result.review.reason).toContain("No new draft was produced");
        expect(result.review.reason).toContain("model request failed");
        expect(result.install.exitCode).toBe(1);
        expect(result.install.stderr).toContain(
            "Coding Agent produced no workspace changes",
        );
        expect(result.build.exitCode).toBe(1);
        expect(result.eval.passed).toBe(false);
        expect(progressStages).toEqual([
            "preparing",
            "planning",
            "coding",
        ]);
        expect(model.requests).toHaveLength(2);
    }, 15_000);

    it("continues a changed draft with one bounded repair after a model timeout", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-progress-timeout-"),
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

        const partialDraft =
            "export function App() { return <main><h1>Task draft</h1><p>The route shell and content plan are ready.</p></main>; }";
        const completeDraft =
            "export function App() { const tasks = ['Review draft']; return <main><h1>Task application</h1><p>Add and review project tasks.</p><input aria-label=\"New task\" /><button>Add task</button>{tasks.map((task) => <p key={task}>{task}</p>)}</main>; }";
        let requestCount = 0;
        const requests: Array<{
            messages: Array<{ content: string }>;
        }> = [];
        const model: ModelProvider = {
            async complete(request) {
                requestCount += 1;
                requests.push(request);

                if (requestCount === 1) {
                    return PLANNER_RESPONSE;
                }

                if (requestCount === 2) {
                    return {
                        content: JSON.stringify({
                            type: "write_file",
                            path: "src/App.tsx",
                            content: partialDraft,
                        }),
                    };
                }

                if (requestCount === 3) {
                    throw new Error("Model request timed out after 90000ms");
                }

                if (requestCount === 4) {
                    return {
                        content: JSON.stringify({
                            type: "write_file",
                            path: "src/App.tsx",
                            content: completeDraft,
                        }),
                    };
                }

                if (requestCount === 5) {
                    return {
                        content: JSON.stringify({
                            type: "finish",
                            summary: "Completed the existing draft",
                        }),
                    };
                }

                return APPROVED_REVIEW_RESPONSE;
            },
        };

        const result = await runReactAppAgent({
            goal: "Create a task app",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 1,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.review.accepted).toBe(true);
        expect(result.attempts).toHaveLength(2);
        expect(result.attempts[0]?.agent.stopReason).toBe("model_error");
        expect(result.attempts[1]?.kind).toBe("repair");
        expect(requestCount).toBe(6);
        expect(requests[3]?.messages[0]?.content).toContain("repair agent");
        await expect(
            readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).resolves.toBe(`import React from "react";\n${completeDraft}`);
    }, 15_000);

    it("accepts a fully validated routed draft when the model times out before finish", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-validated-timeout-"),
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

        const routedDraft = [
            'import { useEffect, useState } from "react";',
            'const links = [{ key: "home", label: "首页", hash: "#/home" }, { key: "culture", label: "历史文化", hash: "#/culture" }, { key: "food", label: "美食特产", hash: "#/food" }];',
            'const views = { home: { title: "温州", body: "山水之城与温润之州的城市介绍。" }, culture: { title: "历史文化", body: "永嘉学派、南戏与瓯越文脉在这里传承。" }, food: { title: "美食特产", body: "鱼丸、糯米饭与瓯菜展现温州风味。" } };',
            'type Route = keyof typeof views;',
            'function readRoute(): Route { const key = window.location.hash.replace("#/", "") as Route; return key in views ? key : "home"; }',
            'export function App() {',
            '  const [route, setRoute] = useState<Route>(readRoute);',
            '  useEffect(() => { const sync = () => setRoute(readRoute()); window.addEventListener("hashchange", sync); if (!window.location.hash) history.replaceState(null, "", "#/home"); return () => window.removeEventListener("hashchange", sync); }, []);',
            '  const view = views[route];',
            '  return <main><nav>{links.map((item) => <a key={item.key} href={item.hash}>{item.label}</a>)}</nav><h1>{view.title}</h1><p>{view.body}</p></main>;',
            '}',
        ].join("\n");
        let requestCount = 0;
        const requestMessages: string[][] = [];
        const model: ModelProvider = {
            async complete(request) {
                requestCount += 1;
                requestMessages.push(
                    request.messages.map((message) => message.content),
                );

                if (requestCount === 1) {
                    return PLANNER_RESPONSE;
                }

                if (requestCount === 2) {
                    return {
                        content: JSON.stringify({
                            type: "write_file",
                            path: "src/App.tsx",
                            content: routedDraft,
                        }),
                    };
                }

                if (requestCount === 3) {
                    throw new Error("Model request timed out after 90000ms");
                }

                return APPROVED_REVIEW_RESPONSE;
            },
        };

        const result = await runReactAppAgent({
            goal: "我想要一个介绍温州的界面 并且可以跳转",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 1,
            evaluateBrowser: async () => ({
                passed: true,
                checks: [
                    {
                        name: "internal navigation works",
                        passed: true,
                    },
                ],
            }),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.attempts).toHaveLength(1);
        expect(result.agent.finished).toBe(false);
        expect(result.agent.stopReason).toBe("model_error");
        expect(result.eval.passed).toBe(true);
        expect(result.browserEval?.passed).toBe(true);
        expect(result.review.accepted).toBe(true);
        expect(result.review.checks.agentFinished).toBe(true);
        expect(result.review.reason).toContain("model timed out");
        expect(requestCount).toBe(4);
        expect(requestMessages[1]?.join("\n")).toContain(
            "Complex routed-page execution profile",
        );
        expect(requestMessages[1]?.join("\n")).toContain(
            "first implementation action must be a write_file for src/App.tsx",
        );
    }, 15_000);

    it("uses the focused route request for execution while reviewing the full goal", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-focused-route-"),
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
        const starter =
            "export function App() { return <main><h1>Apex Arena</h1><p>Legends await.</p></main>; }";
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            starter,
            "utf8",
        );
        await mkdir(path.join(workspaceRoot, "src"));
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            starter,
            "utf8",
        );
        const routedApp = [
            "import { useEffect, useState } from 'react';",
            "const views = { '/home': { title: 'Apex Arena', copy: 'Legends await in the Outlands.' }, '/about': { title: 'Game Modes', copy: 'Explore ranked, mixtape, and battle royale modes.' } };",
            "type Route = keyof typeof views;",
            "const readRoute = (): Route => { const value = window.location.hash.slice(1) as Route; return value in views ? value : '/home'; };",
            "export function App() {",
            "  const [route, setRoute] = useState<Route>(readRoute);",
            "  useEffect(() => { const sync = () => setRoute(readRoute()); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);",
            "  const view = views[route];",
            "  return <main><nav><a href=\"#/home\">Home</a><a href=\"#/about\">Modes</a></nav><h1>{view.title}</h1><p>{view.copy}</p></main>;",
            "}",
        ].join("\n");
        const fullGoal =
            "Build a complete polished Apex Legends official homepage";
        const currentRequest =
            "Add page switching between Home and Game Modes";
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.tsx",
                    oldText: starter,
                    newText: routedApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Connected routed views",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);
        const progressStages: string[] = [];

        const result = await runReactAppAgent({
            goal: fullGoal,
            currentRequest,
            resetWorkspace: false,
            workspaceRoot,
            templateRoot,
            model,
            onProgress: (stage) => {
                progressStages.push(stage);
            },
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.review.accepted).toBe(true);
        expect(result.coordination.plan[0]).toContain(
            "Connect the route shell in src/App.tsx",
        );
        expect(model.requests[0]?.messages[1]?.content).toContain(
            currentRequest,
        );
        expect(model.requests[0]?.messages[1]?.content).not.toContain(
            fullGoal,
        );
        expect(model.requests[1]?.messages[0]?.content).toContain(
            "When context says route-shell-first, edit src/App.tsx",
        );
        expect(model.requests[1]?.messages[0]?.content).not.toContain(
            "This request is being treated as a complex page.",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Full accumulated goal contract:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(fullGoal);
        expect(model.requests[3]?.messages[1]?.content).toContain(fullGoal);
        expect(progressStages).toEqual([
            "preparing",
            "coding",
            "planning",
            "repairing",
            "installing",
            "building",
            "evaluating",
            "reviewing",
        ]);
    }, 15_000);

    it("continues with a fallback plan when the planner model request fails", async () => {
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

        let requestCount = 0;
        const responses = [
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { const tasks = ['Fallback app']; return <main><h1>Fallback app</h1><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</main>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ];
        const model: ModelProvider = {
            async complete() {
                requestCount += 1;

                if (requestCount === 1) {
                    throw new Error("Model request timed out after 180000ms");
                }

                const response = responses[requestCount - 2];

                if (!response) {
                    throw new Error("No test response");
                }

                return response;
            },
        };

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

        expect(result.review.accepted).toBe(true);
        expect(result.coordination.plan[0]).toContain(
            "Implement the requested app",
        );
        expect(result.coordination.plan[1]).toContain(
            "Keep the implementation buildable",
        );
        expect(
            result.trace?.find((event) => event.id === "planner-agent"),
        ).toEqual(
            expect.objectContaining({
                status: "failed",
                label: "Planner Agent unavailable; local fallback plan used",
                message: expect.stringContaining(
                    "Model request timed out after 180000ms",
                ),
            }),
        );

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        expect(appSource).toContain("Fallback app");
    }, 15_000);

    it("allows complex pages to complete across more staged write actions", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-complex-workspace-"),
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
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: "export const title = 'Complete task homepage';",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.css",
                    content: ".app { font-family: sans-serif; }",
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
                    path: "src/widgets.ts",
                    content: "export const helper = true;",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "README.md",
                    content: "Complex staged app",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "import './App.css'; export function App() { const tasks = ['Learn']; return <main className=\"app\"><h1>Complete task homepage</h1><input /><button>Add</button>{tasks.map((task) => <p key={task}>{task}</p>)}</main>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Complex staged app finished",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "Create a complete polished React task homepage with an input, add button, and task list",
            workspaceRoot,
            templateRoot,
            model,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.agent.finished).toBe(true);
        expect(result.agent.steps).toHaveLength(7);
        expect(result.agent.stopReason).toBe("finish");
        expect(result.review.accepted).toBe(true);
        expect(model.requests).toHaveLength(9);
    }, 20_000);

    it("accepts deterministic results when the LLM reviewer times out", async () => {
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

        const responses = [
            PLANNER_RESPONSE,
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
        ];
        const model: ModelProvider = {
            async complete() {
                const response = responses.shift();

                if (!response) {
                    throw new Error(
                        "Model request timed out after 180000ms",
                    );
                }

                return response;
            },
        };

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

        expect(result.review.accepted).toBe(true);
        expect(result.review.reason).toContain(
            "LLM reviewer was unavailable",
        );
        expect(result.review.reason).toContain(
            "Model request timed out after 180000ms",
        );
        expect(result.llmReview).toBeUndefined();
        expect(result.attempts[0]?.llmReview).toBeUndefined();
    }, 15_000);

    it("sends a compact multi-file source snapshot to the LLM reviewer", async () => {
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
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/content.ts",
                    content: `export const tasks = ["${"task ".repeat(900)}"];`,
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.css",
                    content: ".app { color: #111; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        'import "./App.css"; import { tasks } from "./content.js"; export function App() { return <div className="app"><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }',
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        await runReactAppAgent({
            goal: "Create a complex task app",
            workspaceRoot,
            templateRoot,
            model,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const reviewerRequest = JSON.parse(
            model.requests[5]?.messages[1]?.content ?? "{}",
        ) as { source?: string };

        expect(reviewerRequest.source).toContain(
            "Generated source evidence for review",
        );
        expect(reviewerRequest.source).toContain("--- src/App.tsx ---");
        expect(reviewerRequest.source).toContain("--- src/content.ts ---");
        expect(reviewerRequest.source).toContain("--- src/App.css ---");
        expect(reviewerRequest.source?.length).toBeLessThan(5_800);
        expect(reviewerRequest.source).toContain("omitted");
    }, 15_000);

    it("auto-fixes invalid JSX text before building", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-jsx-autofix-"),
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
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        'export function App() { return <main><a href="#">更多 >></a><input /><button>添加</button></main>; }',
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "Create a Chinese app with a more link and task input",
            workspaceRoot,
            templateRoot,
            model,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
            maxRepairAttempts: 0,
        });
        const source = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(source).toContain("更多 &gt;&gt;");
        expect(result.build.exitCode).toBe(0);
        expect(result.build.stdout).toContain(
            "Auto-fixed generated React/TypeScript source",
        );
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
            PLANNER_RESPONSE,
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
            APPROVED_REVIEW_RESPONSE,
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

        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Recent memory:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Prefer named App exports.",
        );
    }, 15_000);

    it("includes generated image asset evidence in the reviewer request", async () => {
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
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "get_image",
                    query: "温州城市风景横幅",
                    mode: "generate",
                    altText: "温州城市风景横幅",
                    outputPath: "public/assets/wenzhou-banner.jpg",
                }),
            },
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content:
                        "export function App() { const tasks = ['温州旅游']; return <main><img src=\"/assets/wenzhou-banner.jpg\" alt=\"温州城市风景横幅\" /><h1>温州旅游</h1><input /><button>添加</button>{tasks.map((task) => <p>{task}</p>)}<p>美食 景点 交通</p></main>; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);
        const imageAssetProvider = new FakeImageAssetProvider({
            data: Uint8Array.from([1, 2, 3]),
            mediaType: "image/jpeg",
            source: "fake://wenzhou-banner",
        });

        await runReactAppAgent({
            goal: "创建中文温州旅游页面，并生成横幅图片",
            workspaceRoot,
            templateRoot,
            model,
            imageAssetProvider,
            imageAssetModes: ["generate"],
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const reviewerRequest = model.requests[4]?.messages[1]?.content ?? "";

        expect(reviewerRequest).toContain("Generated local assets:");
        expect(reviewerRequest).toContain("public/assets/wenzhou-banner.jpg");
        expect(reviewerRequest).toContain("fake://wenzhou-banner");
    }, 15_000);

    it("includes missing local asset references in the reviewer request", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-missing-asset-"),
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

        const appWithMissingLogo = [
            "export function App() {",
            "return <main>",
            '<img src="/assets/tsinghua-logo.png" alt="Tsinghua logo" />',
            "<h1>Tsinghua University</h1>",
            "<p>This page introduces the campus, news, admissions, research, and university culture.</p>",
            "<p>It contains enough readable content for a university home page.</p>",
            "</main>;",
            "}",
        ].join("");

        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: appWithMissingLogo,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        await runReactAppAgent({
            goal: "Create a university homepage with a local logo image",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const reviewerRequest = model.requests[3]?.messages[1]?.content ?? "";

        expect(reviewerRequest).toContain("Local asset references:");
        expect(reviewerRequest).toContain(
            "/assets/tsinghua-logo.png: missing at public/assets/tsinghua-logo.png",
        );
    }, 15_000);

    it("repairs a missing local logo asset without calling the model again", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-logo-asset-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "export function App() {",
                "return <main>",
                '<img src="/assets/tsinghua-logo.png" alt="清华大学校徽" />',
                "<h1>清华大学</h1>",
                "<p>这里展示学校简介、新闻动态、招生信息和校园文化。</p>",
                "<p>页面内容用于模拟大学官网首页，包含学校概况、科研成果、人才培养、校园服务、合作交流等栏目。</p>",
                "<p>用户可以通过导航快速了解学校历史、院系设置、学术活动、招生就业和信息公开内容。</p>",
                "</main>;",
                "}",
            ].join(""),
            "utf8",
        );

        const model = new FakeModelProvider([]);
        const imageAssetProvider = new FakeImageAssetProvider({
            data: Uint8Array.from([1, 2, 3]),
            mediaType: "image/jpeg",
            source: "fake://tsinghua-logo",
        });

        const result = await runReactAppAgent({
            goal: "左上角需要一个logo",
            workspaceRoot,
            templateRoot,
            model,
            imageAssetProvider,
            imageAssetModes: ["generate"],
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        const savedLogo = await readFile(
            path.join(workspaceRoot, "public", "assets", "tsinghua-logo.jpg"),
        );

        expect(model.requests).toHaveLength(0);
        expect(result.review.accepted).toBe(true);
        expect(appSource).toContain('/assets/tsinghua-logo.jpg');
        expect(appSource).not.toContain('/assets/tsinghua-logo.png');
        expect(savedLogo).toEqual(Buffer.from([1, 2, 3]));
    }, 15_000);

    it("can preserve the current workspace for iteration", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

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
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('build ok')\"",
                },
            }),
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <div>Starter</div>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export function App() { const tasks = ['Existing App']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Existing app is already suitable.",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        await runReactAppAgent({
            goal: "Keep the existing app",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        await expect(
            readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8"),
        ).resolves.toContain("Existing App");
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Continuation mode:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Existing App",
        );
        expect(model.requests[1]?.messages[0]?.content).toContain(
            "You are a repair agent for an existing React/Vite app.",
        );
    }, 15_000);

    it("applies simple navigation changes locally without rewriting a large page", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page content.</p></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "export function App() {",
                "  return (",
                "    <main>",
                "      <nav>",
                "        <a href=\"#\">首页</a>",
                "        <a href=\"#\">学校概况</a>",
                "      </nav>",
                "      <section>",
                "        <h1>学校概况</h1>",
                "        <p>这里是学校介绍内容，用户点击导航后应该能跳转到这一块。</p>",
                "      </section>",
                "    </main>",
                "  );",
                "}",
            ].join("\n"),
            "utf8",
        );

        const model = new FakeModelProvider([]);

        const result = await runReactAppAgent({
            goal: "我想要首页这一栏的按钮可以在同一页面内滚动到相应的介绍区块锚点",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(model.requests).toHaveLength(0);
        expect(result.agent.steps[0]?.action.type).toBe("edit_file");
        expect(appSource).toContain('href="#home"');
        expect(appSource).toContain('href="#学校概况"');
        expect(appSource).toContain('<main id="home">');
        expect(appSource).toContain('<h1 id="学校概况">学校概况</h1>');
    }, 15_000);

    it("routes readability feedback through the coding model instead of local CSS-only stabilization", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "import React from 'react';",
                "import './App.css';",
                "export function App() {",
                "  return <main className=\"route-main\">",
                "    <section className=\"page-hero\"><h1>温州文化导览</h1></section>",
                "    <section className=\"page-grid\">",
                "      <article className=\"page-card page-card--accent\"><h2>瓯绣与百工</h2><p>文化名字需要可读。</p></article>",
                "      <article className=\"page-card\"><img src=\"/assets/wenzhou.jpg\" /><h2>江心屿</h2></article>",
                "      <article className=\"metric\"><h3>市场海岸线</h3><strong>355公里</strong><p>洞头、乐清湾到苍南渔村的蓝色长卷。</p></article>",
                "    </section>",
                "  </main>;",
                "}",
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.css"),
            [
                ".route-main { width: min(100% - 4rem, 1180px); margin: auto; }",
                ".page-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 2rem; }",
                ".page-card { grid-column: span 4; }",
                ".page-card h2 { font-size: 3.5rem; }",
                ".page-card img { width: 100%; }",
                ".metric strong { display: block; font-size: 5rem; }",
            ].join("\n"),
            "utf8",
        );

        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.css",
                    content:
                        ".route-main { width: min(100% - 2rem, 1120px); margin: auto; }\n.page-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }\n.page-card { min-width: 0; }\n.page-card h2 { font-size: clamp(1.18rem, 2vw, 1.8rem); overflow-wrap: anywhere; }\n.page-card img { width: 100%; max-height: clamp(9rem, 20vw, 15rem); object-fit: contain; }\n.metric strong { font-size: clamp(1.8rem, 5vw, 3rem); white-space: nowrap; }\n",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Focused readability CSS update completed.",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "\u6587\u5316\u540d\u5b57\u91cc\u9762\u7684\u5b57\u770b\u4e0d\u89c1\uff0c\u6709\u4e9b\u5b57\u4f53\u592a\u5927\u4e86\u7f29\u5c0f\u70b9\uff0c\u6392\u7248\u91cd\u65b0\u641e\u4e00\u4e0b",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        const firstAction = result.agent.steps[0]?.action;
        expect(firstAction?.type).toBe("write_file");
        if (firstAction?.type !== "write_file") {
            throw new Error("Expected the focused visual iteration to write CSS");
        }
        expect(firstAction.path).toBe("src/App.css");
        expect(cssSource).toContain("font-size: clamp(1.18rem");
        expect(cssSource).toContain("max-height: clamp(9rem");
        expect(cssSource).toContain("object-fit: contain");
        expect(cssSource).toContain("white-space: nowrap");
        expect(cssSource).toContain("overflow-wrap: anywhere");
    }, 15_000);

    it("applies a semantic tactical point-label fix for raw A/B/C table text", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-tactical-point-fix-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src", "pages"), {
            recursive: true,
        });

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "import { HomePage } from './pages/home.js'; export function App() { return <HomePage />; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            [
                "export function HomePage() {",
                "  return <main className=\"page-genre-game\">",
                "    <h1>Valorant 地图池</h1>",
                "    <p>当前竞技地图池需要保持点位横排、文字清楚、表格可读。</p>",
                "    <span className=\"eyebrow\">MAP POOL // 当前竞技地图池</span>",
                "    <table className=\"data-table\"><tbody>",
                "      <tr><td>Haven</td><td>A / B / C</td><td>三点图</td></tr>",
                "      <tr><td>Bind</td><td>A / B</td><td>传送门</td></tr>",
                "    </tbody></table>",
                "  </main>;",
                "}",
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.css"),
            ".data-table td { color: #9ff; background: #aee8b2; }",
            "utf8",
        );

        const model = new FakeModelProvider([]);

        const result = await runReactAppAgent({
            goal: "MAP POOL // 当前竞技地图池把这个变成竖着的字，而且字体颜色看不清，点位字体是竖着的，ABC 要在一排",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const homeSource = await readFile(
            path.join(workspaceRoot, "src", "pages", "home.tsx"),
            "utf8",
        );
        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(model.requests).toHaveLength(0);
        expect(result.review.accepted).toBe(true);
        expect(homeSource).not.toContain("MAP POOL //");
        expect(homeSource).not.toContain("<td>A / B / C</td>");
        expect(homeSource).toContain("game-sites--compact");
        expect(homeSource).toContain("site-letter");
        expect(cssSource).toContain("appforge semantic-visual-fix");
        expect(cssSource).toContain("background: rgba(7, 13, 24, .84)");
    }, 15_000);

    it("applies the same visual stabilization for image-fit and large-font feedback", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "import React from 'react';",
                "import './App.css';",
                "export function App() {",
                "  return <main className=\"route-main\">",
                "    <article className=\"page-card\"><img src=\"/assets/craft.jpg\" alt=\"Craft\" /><h2>百工巧技</h2></article>",
                "    <article className=\"metric\"><strong>2200+</strong><p>建城历史</p></article>",
                "  </main>;",
                "}",
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.css"),
            ".page-card img, .metric strong { object-fit: cover; height: 22rem; font-size: 5rem; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.css",
                    oldText:
                        ".page-card img, .metric strong { object-fit: cover; height: 22rem; font-size: 5rem; }",
                    newText:
                        ".page-card img, .metric strong { object-fit: contain; width: 100%; max-height: clamp(9rem, 22vw, 15rem); height: auto; display: block; font-size: clamp(1.8rem, 5vw, 3rem); word-break: keep-all; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Focused image and typography update completed.",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "\u56fe\u7247\u4e0d\u80fd\u5f88\u597d\u7684\u653e\u5728\u91cc\u9762\uff0c\u800c\u4e14\u5b57\u4f53\u5f88\u5927",
            currentRequest:
                "\u8c03\u6574 .page-card img \u7684\u56fe\u7247\u9002\u914d\u548c\u5b57\u4f53\u5927\u5c0f",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            evaluateBrowser: async () => ({
                passed: true,
                checks: [
                    { name: "image fit and text size adjusted", passed: true },
                ],
                evidence: [
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".page-card img",
                        property: "object-fit",
                        expected: "contain",
                        actual: "contain",
                    },
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".metric strong",
                        property: "font-size",
                        expected: "clamped below oversized value",
                        actual: "32px",
                    },
                ],
            }),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        expect(result.review.accepted).toBe(true);
        expect(cssSource).toContain("object-fit: contain");
        expect(cssSource).toContain("font-size: clamp(1.8rem");
        expect(cssSource).toContain("word-break: keep-all");
    }, 15_000);

    it("applies game visual grammar stabilization for card-like oversized UI feedback", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "import './App.css';",
                "export function App() {",
                "  return <main className=\"page-view page-genre-game\">",
                "    <section className=\"game-stage\">",
                "      <aside className=\"game-rail\"><section className=\"game-panel\"><h2>Core Modes</h2><p>Competitive tactical overview.</p></section></aside>",
                "      <section className=\"game-callout\"><h2>Oversized Panel</h2><p>Round flow and agent utility.</p></section>",
                "    </section>",
                "  </main>;",
                "}",
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.css"),
            ".page-genre-game .game-panel, .page-genre-game .game-callout { padding: 2rem; border-radius: 1.5rem; background: rgba(255,255,255,.1); font-size: 3.2rem; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.css",
                    oldText:
                        ".page-genre-game .game-panel, .page-genre-game .game-callout { padding: 2rem; border-radius: 1.5rem; background: rgba(255,255,255,.1); font-size: 3.2rem; }",
                    newText:
                        ".page-genre-game .game-panel, .page-genre-game .game-callout { padding: clamp(.85rem, 1.9vw, 1.35rem); border-radius: .35rem; background: rgba(255,255,255,.1); clip-path: polygon(0 0, calc(100% - .75rem) 0, 100% .75rem, 100% 100%, .75rem 100%, 0 calc(100% - .75rem)); font-size: clamp(1.05rem, 1.5vw, 1.45rem); }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Focused game visual grammar update completed.",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "\u8fd9\u4e0d\u8fd8\u662f\u5361\u7247\u7684\u5417\uff0c\u800c\u4e14\u5b57\u4f53\u8d85\u7ea7\u5927",
            currentRequest:
                "\u8c03\u6574 .game-panel \u548c .game-callout \u7684\u6e38\u620f\u89c6\u89c9\u8bed\u6cd5\uff0c\u7f29\u5c0f\u8fc7\u5927\u5b57\u4f53\uff0c\u5176\u4ed6\u533a\u57df\u4e0d\u8981\u6539",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            evaluateBrowser: async () => ({
                passed: true,
                checks: [
                    { name: "game panel typography and shape stabilized", passed: true },
                ],
                evidence: [
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".game-panel",
                        property: "font-size",
                        expected: "smaller game panel text",
                        actual: "20px",
                    },
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".game-panel",
                        property: "border-radius",
                        expected: ".35rem",
                        actual: "5.6px",
                    },
                ],
            }),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        expect(result.agent.steps[0]?.action.type).toBe("edit_file");
        expect(cssSource).toContain(".page-genre-game .game-panel");
        expect(cssSource).toContain("clip-path: polygon");
        expect(cssSource).toContain("font-size: clamp(1.05rem");
        expect(cssSource).toContain("border-radius: .35rem");
    }, 15_000);

    it.each([
        "\u6c5f\u5fc3\u5c7f\uff1a\u96c1\u8361\u5c71\uff1a\u6960\u6eaa\u6c5f\uff1a\u4e94\u9a6c\u8857\u2014\u7985\u8857\uff1a\u5b57\u4f53\u8fc7\u5927\u4e86",
        "\u8fd9\u4e9b\u666f\u70b9\u540d\u592a\u62a2\u773c\u4e86\uff0c\u5c0f\u4e00\u70b9",
        "\u8def\u7ebf\u8282\u70b9\u522b\u90a3\u4e48\u5927\uff0c\u770b\u8d77\u6765\u538b\u8fc7\u6b63\u6587",
        "\u4e94\u9a6c\u8857\u2014\u7985\u8857\u8fd9\u4e2a\u540d\u5b57\u65ad\u884c\u5f88\u4e11\uff0c\u522b\u6491\u5f00\u5361\u7247",
    ])("shrinks oversized Wenzhou route stop names in existing drafts: %s", async (request) => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "import './App.css';",
                "export function App() {",
                "  return <main className=\"route-main\">",
                "    <section className=\"page-card\">",
                "      <ul className=\"feature-list\">",
                "        <li><strong>江心屿：</strong>双塔与瓯江夜色。</li>",
                "        <li><strong>雁荡山：</strong>灵峰夜景与飞瀑。</li>",
                "        <li><strong>楠溪江：</strong>古村与溪流。</li>",
                "        <li><strong>五马街—禅街：</strong>老城商业与新消费。</li>",
                "      </ul>",
                "    </section>",
                "  </main>;",
                "}",
            ].join("\n"),
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.css"),
            ".feature-list strong { display: block; font-size: 3.8rem; }",
            "utf8",
        );

        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.css",
                    oldText:
                        ".feature-list strong { display: block; font-size: 3.8rem; }",
                    newText:
                        ".feature-list strong, .place-name { display: inline; font-size: clamp(1rem, 1.45vw, 1.32rem); line-height: 1.35; word-break: keep-all; overflow-wrap: normal; }",
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Focused route stop typography update completed.",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: request,
            currentRequest: `${request}，只调整 .feature-list strong 和 .place-name 的字体与换行，其他区域不要修改`,
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            evaluateBrowser: async () => ({
                passed: true,
                checks: [
                    { name: "route stop names are smaller and stay readable", passed: true },
                ],
                evidence: [
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".feature-list strong",
                        property: "font-size",
                        expected: "clamped route stop name size",
                        actual: "18px",
                    },
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".feature-list strong",
                        property: "word-break",
                        expected: "keep-all",
                        actual: "keep-all",
                    },
                ],
            }),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const cssSource = await readFile(
            path.join(workspaceRoot, "src", "App.css"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        expect(result.agent.steps[0]?.action.type).toBe("edit_file");
        expect(cssSource).toContain(".feature-list strong");
        expect(cssSource).toContain(".place-name");
        expect(cssSource).toContain("font-size: clamp(1rem, 1.45vw, 1.32rem)");
        expect(cssSource).toContain("word-break: keep-all");
    }, 15_000);

    it("connects existing navigation buttons locally without calling the model", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page content.</p></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "export function App() {",
                "  return (",
                "    <main>",
                "      <nav>",
                "        <button>Home</button>",
                "        <button>About</button>",
                "      </nav>",
                "      <section>",
                "        <h1>About</h1>",
                "        <p>This section describes the generated app and should be reachable from navigation.</p>",
                "      </section>",
                "    </main>",
                "  );",
                "}",
            ].join("\n"),
            "utf8",
        );

        const model = new FakeModelProvider([]);

        await runReactAppAgent({
            goal: "Make the homepage navigation buttons jump to the matching introduction sections",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(model.requests).toHaveLength(0);
        expect(appSource).toContain(
            'document.getElementById("home")?.scrollIntoView',
        );
        expect(appSource).toContain(
            'document.getElementById("about")?.scrollIntoView',
        );
        expect(appSource).toContain('<main id="home">');
        expect(appSource).toContain('<h1 id="about">About</h1>');
    }, 15_000);

    it("does not treat dynamic JSX navigation labels as a valid local navigation fix", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(
            path.join(templateRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            packageJson,
            "utf8",
        );
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page content.</p></main>; }",
            "utf8",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            [
                "const navItems = ['Home', 'About'];",
                "export function App() {",
                "  return (",
                "    <main>",
                "      <nav>",
                "        {navItems.map((item) => <a key={item} href=\"#\">{item}</a>)}",
                "      </nav>",
                "      <section>",
                "        <h1>About</h1>",
                "        <p>This section describes the generated app and should be reachable from navigation.</p>",
                "      </section>",
                "    </main>",
                "  );",
                "}",
            ].join("\n"),
            "utf8",
        );

        const repairedApp = [
            "const navItems = ['Home', 'About'];",
            "export function App() {",
            "  return (",
            "    <main id=\"home\">",
            "      <nav>",
            "        <a href=\"#home\">Home</a>",
            "        <a href=\"#about\">About</a>",
            "      </nav>",
            "      <section id=\"about\">",
            "        <h1>About</h1>",
            "        <input />",
            "        <button>Add</button>",
            "        <p>This section describes the generated app and should be reachable from navigation.</p>",
            "      </section>",
            "    </main>",
            "  );",
            "}",
        ].join("\n");
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: repairedApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Connected navigation links.",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        await runReactAppAgent({
            goal: "Make the homepage navigation links jump to matching sections",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        expect(appSource).toContain('href="#about"');
        expect(appSource).not.toContain('href="#item"');
    }, 15_000);

    it("uses the coding agent for independent pages and accepts History API routes", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });

        await writeFile(path.join(templateRoot, "package.json"), packageJson);
        await writeFile(path.join(workspaceRoot, "package.json"), packageJson);
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page.</p></main>; }",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            'export function App() { return <main><nav><a href="#">首页</a><a href="#">学校概况</a></nav><h1>现有首页</h1><p>现有内容</p></main>; }',
        );

        const routedApp = [
            'import { useEffect, useState, type MouseEvent } from "react";',
            "function HomeView() { return <section><h1>现有首页</h1><p>保留原有首页的核心内容与入口。</p></section>; }",
            "function AboutView() { return <section><h1>学校概况</h1><p>这里介绍学校历史、使命和办学特色。</p></section>; }",
            "function AdmissionsView() { return <section><h1>招生就业</h1><p>这里提供招生项目与就业服务信息。</p></section>; }",
            'const routeViews = { "/": HomeView, "/about": AboutView, "/admissions": AdmissionsView };',
            "type RoutePath = keyof typeof routeViews;",
            "function readRoute(): RoutePath { const path = window.location.pathname as RoutePath; return path in routeViews ? path : \"/\"; }",
            "export function App() {",
            "  const [pathname, setPathname] = useState<RoutePath>(readRoute);",
            "  useEffect(() => {",
            "    const syncRoute = () => setPathname(readRoute());",
            '    window.addEventListener("popstate", syncRoute);',
            '    return () => window.removeEventListener("popstate", syncRoute);',
            "  }, []);",
            "  const navigate = (event: MouseEvent<HTMLAnchorElement>, target: RoutePath) => {",
            "    event.preventDefault();",
            '    window.history.pushState({}, "", target);',
            "    setPathname(target);",
            "  };",
            "  const View = routeViews[pathname];",
            "  return <main><nav>",
            '    <a href="/" onClick={(event) => navigate(event, "/")}>首页</a>',
            '    <a href="/about" onClick={(event) => navigate(event, "/about")}>学校概况</a>',
            '    <a href="/admissions" onClick={(event) => navigate(event, "/admissions")}>招生就业</a>',
            "  </nav><View /></main>;",
            "}",
        ].join("\n");
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: routedApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Implemented independent routed pages.",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "保留现有首页，新增学校概况和招生就业两个独立页面；导航要进行页面跳转，URL 改变并支持浏览器前进后退",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const appSource = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(model.requests.length).toBeGreaterThan(0);
        expect(appSource).toContain("window.history.pushState");
        expect(appSource).toContain('addEventListener("popstate"');
        expect(appSource).toContain('href="/about"');
        expect(appSource).not.toContain('href="#"');
        expect(result.eval.passed).toBe(true);
        expect(result.review.accepted).toBe(true);
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "Independent page routing requirement:",
        );
        expect(model.requests[1]?.messages[1]?.content).toContain(
            "browser Back/Forward",
        );
        expect(model.requests[1]?.messages[0]?.content).toContain(
            "same-page anchors and independent URL routes",
        );
        expect(model.requests[1]?.messages[0]?.content).toContain(
            "location.hash and handle hashchange",
        );
    }, 15_000);

    it("accepts a URL-aware manual hash router with distinct route views", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });
        await writeFile(path.join(templateRoot, "package.json"), packageJson);
        await writeFile(path.join(workspaceRoot, "package.json"), packageJson);
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page.</p></main>; }",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>现有首页</h1><p>现有内容</p></main>; }",
        );

        const hashRoutedApp = [
            'import { useEffect, useState } from "react";',
            "function HomeView() { return <section><h1>现有首页</h1><p>保留原有首页内容。</p></section>; }",
            "function AboutView() { return <section><h1>学校概况</h1><p>学校历史与办学特色。</p></section>; }",
            "function AdmissionsView() { return <section><h1>招生就业</h1><p>招生项目与就业服务。</p></section>; }",
            'const routeViews = { "/": HomeView, "/about": AboutView, "/admissions": AdmissionsView };',
            'const navItems = [{ label: "首页", href: "#/" }, { label: "学校概况", href: "#/about" }, { label: "招生就业", href: "#/admissions" }];',
            "type RoutePath = keyof typeof routeViews;",
            'const routeLinks = [{ label: "Home", hash: "#/" }, { label: "About", hash: "#/about" }, { label: "Admissions", hash: "#/admissions" }];',
            "function readRoute(): RoutePath { const route = window.location.hash.slice(1) || \"/\"; return route in routeViews ? route as RoutePath : \"/\"; }",
            "export function App() {",
            "  const [route, setRoute] = useState<RoutePath>(readRoute);",
            "  useEffect(() => {",
            "    const syncRoute = () => setRoute(readRoute());",
            '    window.addEventListener("hashchange", syncRoute);',
            '    return () => window.removeEventListener("hashchange", syncRoute);',
            "  }, []);",
            "  const View = routeViews[route];",
            "  return <main><nav>",
            "    {routeLinks.map((item) => <a key={item.hash} href={item.hash}>{item.label}</a>)}",
            "  </nav><View /></main>;",
            "}",
        ].join("\n");
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: hashRoutedApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Implemented URL-aware hash routes.",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "保留现有首页并新增两个独立页面，使用路由支持 URL 页面跳转和浏览器前进后退",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.eval.passed).toBe(true);
        expect(result.review.accepted).toBe(true);
        expect(hashRoutedApp).toContain("window.location.hash");
        expect(hashRoutedApp).toContain('addEventListener("hashchange"');
        expect(hashRoutedApp).toContain('href: "#/about"');
        expect(hashRoutedApp).toContain('hash: "#/about"');
        expect(hashRoutedApp).toContain("href={item.hash}");
        expect(hashRoutedApp).not.toContain('href="#"');
    }, 15_000);

    it("rejects ordinary anchors and placeholder links for independent page requests", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-workspace-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));
        await mkdir(path.join(workspaceRoot, "src"));

        const packageJson = JSON.stringify({
            scripts: {
                build: "node -e \"console.log('build ok')\"",
            },
        });
        await writeFile(path.join(templateRoot, "package.json"), packageJson);
        await writeFile(path.join(workspaceRoot, "package.json"), packageJson);
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>Starter</h1><p>Starter page.</p></main>; }",
        );
        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export function App() { return <main><h1>现有首页</h1><p>现有内容</p></main>; }",
        );

        const anchorOnlyApp = [
            'import { useEffect, useState } from "react";',
            "export function App() {",
            "  const [hash, setHash] = useState(window.location.hash);",
            "  useEffect(() => {",
            "    const syncHash = () => setHash(window.location.hash);",
            '    window.addEventListener("hashchange", syncHash);',
            '    return () => window.removeEventListener("hashchange", syncHash);',
            "  }, []);",
            "  return <main><nav>",
            '    <a href="#">首页</a>',
            '    <a href="#about">学校概况</a>',
            '    <a href="#admissions">招生就业</a>',
            "  </nav>",
            '  <section id="about"><h1>学校概况</h1><p>同一文档中的介绍区块。</p></section>',
            '  <section id="admissions"><h1>招生就业</h1><p>内容建设中……</p></section>',
            "  <p>{hash}</p></main>;",
            "}",
        ].join("\n");
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: anchorOnlyApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Connected page links.",
                }),
            },
        ]);

        const result = await runReactAppAgent({
            goal: "保留现有首页并新增学校概况和招生就业两个独立页面，使用路由进行页面跳转",
            workspaceRoot,
            templateRoot,
            model,
            resetWorkspace: false,
            maxRepairAttempts: 0,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.eval.passed).toBe(false);
        expect(result.review.accepted).toBe(false);
        expect(result.review.reason).toContain(
            "verifiable routing implementation",
        );
        expect(result.review.reason).toContain('href="#"');
        expect(result.review.reason).toContain(
            "placeholder-only content",
        );
        expect(
            result.eval.checks.some(
                (check) =>
                    !check.passed &&
                    check.name.startsWith("has distinct URL routes:"),
            ),
        ).toBe(true);
    }, 15_000);

    it("feeds a failed edit and the latest target source into repair", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-failed-edit-context-"),
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
        const latestSource =
            "export function App() { return <main><h1>Starter</h1><p>Current source stays available.</p></main>; }";
        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            latestSource,
            "utf8",
        );
        const repairedSource =
            "export function App() { const tasks = ['Learn']; return <main><h1>Tasks</h1><input /><button>Add</button>{tasks.map((task) => <p key={task}>{task}</p>)}</main>; }";
        const missingOldText =
            "export function App() { return <h1>Outdated source</h1>; }";
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.tsx",
                    oldText: missingOldText,
                    newText: repairedSource,
                }),
            },
            {
                content: JSON.stringify({
                    type: "edit_file",
                    path: "src/App.tsx",
                    oldText: latestSource,
                    newText: repairedSource,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Applied the repair from current source",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const result = await runReactAppAgent({
            goal: "Create a simple task app",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 1,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });
        const repairRequest =
            model.requests[2]?.messages[1]?.content ?? "";

        expect(result.review.accepted).toBe(true);
        expect(result.attempts).toHaveLength(2);
        expect(repairRequest).toContain(
            "Previous failed implementation action:",
        );
        expect(repairRequest).toContain("Edit target not found");
        expect(repairRequest).toContain(missingOldText);
        expect(repairRequest).toContain(
            "Do not repeat this action unchanged",
        );
        expect(repairRequest).toContain(
            "Latest target file source (src/App.tsx):",
        );
        expect(repairRequest).toContain(latestSource);
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
            PLANNER_RESPONSE,
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
            APPROVED_REVIEW_RESPONSE,
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
        expect(result.attempts[1]?.install.stdout).toContain(
            "Reused successful npm install result because dependency manifests are unchanged.",
        );
        expect(model.requests).toHaveLength(6);
        expect(model.requests[3]?.messages[0]?.content).toContain(
            "repair agent",
        );
        expect(model.requests[3]?.messages[1]?.content).toContain(
            "Repair request:",
        );
        expect(model.requests[3]?.messages[1]?.content).toContain(
            "Eval passed: no",
        );
        expect(model.requests[3]?.messages[1]?.content).toContain(
            "Current workspace source:",
        );
        expect(model.requests[3]?.messages[1]?.content).toContain(badApp);
    }, 15_000);

    it("preserves the latest draft when automatic repair times out", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-repair-timeout-"),
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

        const draftApp =
            "export function App() { return <main><h1>Draft page</h1></main>; }";
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: draftApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Draft done",
                }),
            },
            // No repair response: this simulates a model timeout/failure in the
            // repair Coding Agent after a previewable draft already exists.
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
        const source = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(source).toBe(`import React from "react";\n${draftApp}`);
        expect(result.attempts).toHaveLength(1);
        expect(result.agent.finished).toBe(true);
        expect(result.review.accepted).toBe(false);
        expect(result.review.reason).toContain("Automatic repair failed");
        expect(result.review.reason).toContain(
            "latest generated draft was preserved",
        );
        expect(model.requests).toHaveLength(4);
    }, 15_000);

    it("includes source near the build error in the repair request", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-build-error-context-"),
        );

        temporaryDirectories.push(templateRoot, workspaceRoot);

        await mkdir(path.join(templateRoot, "src"));

        await writeFile(
            path.join(templateRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build:
                        "node -e \"console.error('src/App.tsx:16:8: Unexpected closing footer tag'); process.exit(1)\"",
                },
            }),
            "utf8",
        );

        await writeFile(
            path.join(templateRoot, "src", "App.tsx"),
            "export function App() { return null; }",
            "utf8",
        );

        const brokenApp = [
            'import React from "react";',
            "export function App() {",
            "  return (",
            "    <main>",
            "      <section>",
            "        <h1>清华大学</h1>",
            "        <p>学校简介</p>",
            "        <p>新闻动态</p>",
            "        <p>招生信息</p>",
            "        <p>科研成果</p>",
            "        <p>校园文化</p>",
            "        <div>",
            "          <span>更多链接</span>",
            "        </div>",
            "      </section>",
            "      </footer>",
            "    </main>",
            "  );",
            "}",
        ].join("\n");
        const repairedApp =
            "export function App() { return <main><h1>清华大学</h1><p>学校简介 新闻动态 招生信息 科研成果 校园文化</p></main>; }";

        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: brokenApp,
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
                    content: repairedApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Repair done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        await runReactAppAgent({
            goal: "创建清华大学官网风格页面",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 1,
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        const repairRequest = model.requests[3]?.messages[1]?.content ?? "";

        expect(repairRequest).toContain(
            "Relevant source near build error:",
        );
        expect(repairRequest).toContain(">   16 |       </footer>");
        expect(repairRequest).toContain(
            "Unexpected closing footer tag",
        );
    }, 20_000);

    it("keeps browser eval failures as non-blocking warnings", async () => {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-api-browser-repair-"),
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

        const taskApp =
            "export function App() { const tasks = ['Learn']; return <div><input /><button>Add</button>{tasks.map((task) => <p>{task}</p>)}</div>; }";
        const model = new FakeModelProvider([
            PLANNER_RESPONSE,
            {
                content: JSON.stringify({
                    type: "write_file",
                    path: "src/App.tsx",
                    content: taskApp,
                }),
            },
            {
                content: JSON.stringify({
                    type: "finish",
                    summary: "Initial attempt done",
                }),
            },
            APPROVED_REVIEW_RESPONSE,
        ]);

        const browserResults = [
            {
                passed: false,
                checks: [
                    {
                        name: "adds a task item",
                        passed: false,
                        message: "The task text was not rendered.",
                    },
                ],
            },
            {
                passed: true,
                checks: [
                    {
                        name: "adds a task item",
                        passed: true,
                    },
                ],
            },
        ];

        const result = await runReactAppAgent({
            goal: "Create a simple task app",
            workspaceRoot,
            templateRoot,
            model,
            maxRepairAttempts: 1,
            evaluateBrowser: async () => {
                const nextResult = browserResults.shift();

                if (!nextResult) {
                    throw new Error("Missing fake browser result");
                }

                return nextResult;
            },
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        expect(result.review.accepted).toBe(true);
        expect(result.browserEval?.passed).toBe(false);
        expect(result.review.reason).toContain("Browser eval warning");
        expect(result.attempts).toHaveLength(1);
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
            PLANNER_RESPONSE,
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
            APPROVED_REVIEW_RESPONSE,
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
        expect(result.trace).toHaveLength(19);
        expect(result.trace?.map((event) => event.id)).toEqual(
            expect.arrayContaining([
                "planner-agent",
                "repair-3-llm-review",
            ]),
        );
        expect(result.trace?.map((event) => event.id)).not.toEqual(
            expect.arrayContaining([
                "initial-1-llm-review",
                "repair-2-llm-review",
            ]),
        );
        expect(model.requests).toHaveLength(8);
    }, 60_000);
});
