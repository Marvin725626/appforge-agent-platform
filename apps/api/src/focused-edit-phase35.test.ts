import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FakeModelProvider } from "@appforge/agent-core";
import type { BrowserEvalResult } from "@appforge/harness";
import { afterEach, describe, expect, it } from "vitest";

import {
    createWorkspaceSnapshot,
    locateFocusedEditScope,
    validateFocusedEditAction,
} from "./focused-edit-diagnostics.js";
import { runReactAppAgent } from "./run-react-app-agent.js";

const PLANNER_RESPONSE = {
    content: JSON.stringify({
        summary: "Plan the structural edit.",
        steps: [
            {
                id: "step-1",
                title: "Apply structural change",
                description: "Modify the requested files.",
                acceptanceCriteria: ["The request is represented in code."],
            },
        ],
    }),
};

const APPROVED_REVIEW_RESPONSE = {
    content: JSON.stringify({
        accepted: true,
        reason: "The result satisfies the requested change.",
        issues: [],
    }),
};

const BASE_APP = `import React from 'react';
import './App.css';
import { AboutPage } from './About';

export function App() {
    return (
        <div className="app-shell">
            <Header />
            <aside className="sidebar">Navigation</aside>
            <main className="content">
                <section className="hero">
                    <img className="hero-image" src="/old-hero.jpg" alt="Hero" />
                    <h1>Welcome</h1>
                    <SubmitButton />
                </section>
                <section className="feature-grid">
                    <article className="feature-card feature-one">First feature</article>
                    <article className="feature-card feature-two">Second feature</article>
                    <article className="feature-card feature-three">Third feature</article>
                </section>
                <AboutPage />
            </main>
        </div>
    );
}

function Header() {
    return <header className="app-header">Header copy</header>;
}

function SubmitButton() {
    return <button className="primary-button">Start</button>;
}
`;

const BASE_CSS = `.app-shell {
    display: grid;
    grid-template-columns: 260px 1fr;
}

.sidebar {
    width: 260px;
}

.hero {
    background: blue;
    padding: 24px;
}

.primary-button {
    margin-left: 0;
}

.content {
    padding: 24px;
}

.feature-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
}

@media (max-width: 640px) {
    .feature-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
`;

const BASE_ABOUT = `import React from 'react';

export function AboutPage() {
    return <main className="about-page"><h1>About old</h1><p>Keep route copy.</p></main>;
}
`;

type ScenarioWorkspace = {
    workspaceRoot: string;
    templateRoot: string;
};

describe("Phase 3.5 focused edit hardening", () => {
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

    async function createWorkspace(): Promise<ScenarioWorkspace> {
        const templateRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-phase35-template-"),
        );
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-phase35-workspace-"),
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
        await writeFile(path.join(workspaceRoot, "src", "App.tsx"), BASE_APP, "utf8");
        await writeFile(path.join(workspaceRoot, "src", "App.css"), BASE_CSS, "utf8");
        await writeFile(
            path.join(workspaceRoot, "src", "About.tsx"),
            BASE_ABOUT,
            "utf8",
        );

        return { workspaceRoot, templateRoot };
    }

    async function runScenario(input: {
        currentRequest: string;
        responses: Array<{ content: string }>;
        evaluateBrowser?: () => Promise<BrowserEvalResult>;
        maxRepairAttempts?: number;
    }) {
        const workspace = await createWorkspace();
        const model = new FakeModelProvider(input.responses);
        const result = await runReactAppAgent({
            goal: "Iterate the existing workspace.",
            currentRequest: input.currentRequest,
            resetWorkspace: false,
            maxRepairAttempts: input.maxRepairAttempts ?? 0,
            workspaceRoot: workspace.workspaceRoot,
            templateRoot: workspace.templateRoot,
            model,
            ...(input.evaluateBrowser
                ? {
                      evaluateBrowser: async () => input.evaluateBrowser!(),
                  }
                : {}),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "test-key",
                model: "test-model",
            },
        });

        return {
            result,
            model,
            workspaceRoot: workspace.workspaceRoot,
        };
    }

    function editFile(pathname: string, oldText: string, newText: string) {
        return {
            content: JSON.stringify({
                type: "edit_file",
                path: pathname,
                oldText,
                newText,
            }),
        };
    }

    const finish = {
        content: JSON.stringify({
            type: "finish",
            summary: "Done",
        }),
    };

    function expectFastEdit(result: Awaited<ReturnType<typeof runReactAppAgent>>) {
        expect(result.executionMode).toBe("fast_edit");
        expect(result.metrics?.plannerCalls).toBe(0);
        expect(result.metrics?.reviewerCalls).toBe(0);
        expect(result.metrics?.retryCalls).toBe(0);
        expect(result.install.stdout).toContain("Skipped npm install");
        expect(result.workspaceDiff).toBeDefined();
        expect(result.requirements?.find((item) => item.id === "PRESERVE-1")?.status).toBe("PASS");
    }

    function elementSnapshot(width: number) {
        return {
            route: "/",
            selector: ".sidebar",
            viewport: { width: 1440, height: 900 },
            exists: true,
            visible: true,
            text: "Navigation",
            boundingBox: { x: 0, y: 0, width, height: 900 },
            computedStyles: {
                display: "block",
                position: "static",
                width: `${width}px`,
                height: "900px",
                margin: "0px",
                padding: "0px",
                gap: "normal",
                color: "rgb(0, 0, 0)",
                backgroundColor: "rgba(0, 0, 0, 0)",
                borderRadius: "0px",
                transform: "none",
                gridTemplateColumns: "none",
                flexDirection: "row",
            },
        };
    }

    it("changes a button text from Start to Submit with file-diff evidence", async () => {
        const { result, workspaceRoot } = await runScenario({
            currentRequest: "Change the button text from Start to Submit and do not modify other areas",
            responses: [
                editFile("src/App.tsx", ">Start</button>", ">Submit</button>"),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "button text is Submit", passed: true }],
                evidence: [
                    {
                        source: "browser",
                        selector: "button",
                        property: "textContent",
                        expected: "Submit",
                        actual: "Submit",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        expect(result.workspaceDiff?.modifiedFiles).toEqual(["src/App.tsx"]);
        expect(await readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8")).toContain(">Submit</button>");
        expect(result.requirements?.[0]?.evidences.length).toBeGreaterThan(0);
    });

    it("sets the left sidebar width to 220px and preserves unrelated files", async () => {
        const { result } = await runScenario({
            currentRequest: "Change the left sidebar width to 220px, other areas do not modify",
            responses: [
                editFile("src/App.css", "width: 260px;", "width: 220px;"),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "computed width is 220px", passed: true }],
                evidence: [
                    {
                        source: "computed_style",
                        selector: ".sidebar",
                        property: "width",
                        expected: "220px",
                        actual: "220.00px",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        expect(result.workspaceDiff?.modifiedFiles).toEqual(["src/App.css"]);
        expect(result.requirements?.[0]?.evidences).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: "computed_style",
                    property: "width",
                    actual: "220.00px",
                }),
            ]),
        );
    });

    it("attaches before and after element snapshots to browser-backed evidence", async () => {
        let browserCallCount = 0;
        const { result } = await runScenario({
            currentRequest: "Change the left sidebar width to 220px, other areas do not modify",
            responses: [
                editFile("src/App.css", "width: 260px;", "width: 220px;"),
                finish,
            ],
            evaluateBrowser: async () => {
                browserCallCount += 1;
                const width = browserCallCount === 1 ? 260 : 220;

                return {
                    passed: true,
                    checks: [{ name: `sidebar width is ${width}px`, passed: true }],
                    evidence: [
                        {
                            source: "computed_style",
                            requirementId: "REQ-1",
                            selector: ".sidebar",
                            property: "width",
                            expected: "220px",
                            actual: `${width}px`,
                            afterElement: elementSnapshot(width),
                        },
                    ],
                };
            },
        });
        const widthEvidence = result.requirements?.[0]?.evidences.find(
            (evidence) =>
                evidence.requirementId === "REQ-1" &&
                evidence.selector === ".sidebar" &&
                evidence.property === "width",
        );

        expect(browserCallCount).toBe(2);
        expect(result.review.accepted).toBe(true);
        expect(widthEvidence?.beforeElement?.boundingBox?.width).toBe(260);
        expect(widthEvidence?.afterElement?.boundingBox?.width).toBe(220);
    });

    it("runs one limited focused repair when a requirement browser probe fails", async () => {
        let browserCallCount = 0;
        const { result } = await runScenario({
            currentRequest: "Change the left sidebar width to 220px, other areas do not modify",
            maxRepairAttempts: 1,
            responses: [
                editFile("src/App.css", "width: 260px;", "width: 200px;"),
                finish,
                editFile("src/App.css", "width: 200px;", "width: 220px;"),
                finish,
            ],
            evaluateBrowser: async () => {
                browserCallCount += 1;
                const width =
                    browserCallCount === 1
                        ? 260
                        : browserCallCount === 2
                          ? 200
                          : 220;

                return {
                    passed: width === 220 || browserCallCount === 1,
                    checks: [
                        {
                            name: "sidebar bounding box width is 220px",
                            passed: width === 220 || browserCallCount === 1,
                            ...(width !== 220 && browserCallCount !== 1
                                ? { message: `actual width was ${width}px` }
                                : {}),
                        },
                    ],
                    evidence: [
                        {
                            source: "computed_style",
                            requirementId: "REQ-1",
                            selector: ".sidebar",
                            property: "width",
                            expected: "220px",
                            actual: `${width}px`,
                            afterElement: elementSnapshot(width),
                        },
                    ],
                };
            },
        });

        expect(result.executionMode).toBe("fast_edit");
        expect(result.metrics?.retryCalls).toBe(1);
        expect(result.metrics?.plannerCalls).toBe(0);
        expect(result.metrics?.reviewerCalls).toBe(0);
        expect(result.review.accepted).toBe(true);
        expect(result.requirements?.find((item) => item.id === "REQ-1")?.status).toBe("PASS");
        expect(result.requirements?.find((item) => item.id === "PRESERVE-1")?.status).toBe("PASS");
        expect(browserCallCount).toBe(3);
    });

    it("changes the Hero background from blue to dark gray with computed style evidence", async () => {
        const { result } = await runScenario({
            currentRequest: "Change the Hero background from blue to dark gray",
            responses: [
                editFile("src/App.css", "background: blue;", "background: #202124;"),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "hero background is dark gray", passed: true }],
                evidence: [
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".hero",
                        property: "background-color",
                        expected: "dark gray",
                        actual: "rgb(32, 33, 36)",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        expect(result.workspaceDiff?.modifiedFiles).toEqual(["src/App.css"]);
    });

    it("deletes the second feature module without changing the other modules", async () => {
        const { result, workspaceRoot } = await runScenario({
            currentRequest: "Delete the second feature module, do not modify the other modules",
            responses: [
                editFile(
                    "src/App.tsx",
                    '                    <article className="feature-card feature-two">Second feature</article>\n',
                    "",
                ),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "second feature removed", passed: true }],
                evidence: [
                    {
                        source: "browser",
                        requirementId: "REQ-1",
                        selector: ".feature-two",
                        property: "element_count",
                        expected: "0",
                        actual: "0",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        const appSource = await readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8");
        expect(appSource).toContain("First feature");
        expect(appSource).not.toContain("Second feature");
        expect(appSource).toContain("Third feature");
    });

    it("moves a button right by 16px", async () => {
        const { result } = await runScenario({
            currentRequest: "Move the button to the right by 16px",
            responses: [
                editFile("src/App.css", "margin-left: 0;", "margin-left: 16px;"),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "button margin-left is 16px", passed: true }],
                evidence: [
                    {
                        source: "computed_style",
                        selector: "button",
                        property: "margin-left",
                        expected: "16px",
                        actual: "16px",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        expect(result.workspaceDiff?.modifiedFiles).toEqual(["src/App.css"]);
    });

    it("only changes the /about page title and does not modify other routes", async () => {
        const { result } = await runScenario({
            currentRequest: "Only modify the /about page title to About new, do not modify other routes",
            responses: [
                editFile("src/About.tsx", "<h1>About old</h1>", "<h1>About new</h1>"),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "about title changed", passed: true }],
                evidence: [
                    {
                        source: "browser",
                        requirementId: "REQ-1",
                        selector: ".about-page h1",
                        property: "textContent",
                        expected: "About new",
                        actual: "About new",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        expect(result.workspaceDiff?.modifiedFiles).toEqual(["src/About.tsx"]);
    });

    it("makes mobile layout single column while preserving desktop CSS", async () => {
        const { result, workspaceRoot } = await runScenario({
            currentRequest: "On mobile make the feature grid single column, keep desktop layout unchanged",
            responses: [
                editFile(
                    "src/App.css",
                    "grid-template-columns: repeat(2, 1fr);",
                    "grid-template-columns: 1fr;",
                ),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "mobile grid is single column", passed: true }],
                evidence: [
                    {
                        source: "computed_style",
                        requirementId: "REQ-1",
                        selector: ".feature-grid",
                        property: "grid-template-columns",
                        expected: "single column on mobile",
                        actual: "1fr",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        const css = await readFile(path.join(workspaceRoot, "src", "App.css"), "utf8");
        expect(css).toContain("grid-template-columns: repeat(3, 1fr);");
        expect(css).toContain("grid-template-columns: 1fr;");
    });

    it("replaces the Hero image without modifying copy", async () => {
        const { result, workspaceRoot } = await runScenario({
            currentRequest: "Replace the Hero image asset only, do not modify the copy",
            responses: [
                editFile("src/App.tsx", 'src="/old-hero.jpg"', 'src="/new-hero.jpg"'),
                finish,
            ],
            evaluateBrowser: async () => ({
                passed: true,
                checks: [{ name: "hero image source changed", passed: true }],
                evidence: [
                    {
                        source: "browser",
                        selector: ".hero img",
                        property: "src",
                        expected: "/new-hero.jpg",
                        actual: "/new-hero.jpg",
                    },
                ],
            }),
        });

        expectFastEdit(result);
        expect(result.review.accepted).toBe(true);
        const appSource = await readFile(path.join(workspaceRoot, "src", "App.tsx"), "utf8");
        expect(appSource).toContain('src="/new-hero.jpg"');
        expect(appSource).toContain("<h1>Welcome</h1>");
    });

    it("does not incorrectly enter Focused Edit for a whole homepage redo", async () => {
        const { result } = await runScenario({
            currentRequest: "Completely redo the entire homepage with a new structure",
            responses: [
                PLANNER_RESPONSE,
                editFile("src/App.tsx", "<h1>Welcome</h1>", "<h1>New homepage</h1>"),
                finish,
                APPROVED_REVIEW_RESPONSE,
            ],
        });

        expect(result.executionMode).toBe("structural_edit");
        expect(result.metrics?.plannerCalls).toBe(1);
        expect(result.metrics?.reviewerCalls).toBe(0);
        expect(result.review.accepted).toBe(false);
        expect(result.review.reason).toContain("eval failed");
    }, 15_000);

    it("upgrades package.json task changes to Structural Edit", async () => {
        const { result } = await runScenario({
            currentRequest: "Modify package.json build script to echo changed",
            responses: [
                PLANNER_RESPONSE,
                editFile(
                    "package.json",
                    "node -e \\\"console.log('build ok')\\\"",
                    "node -e \\\"console.log('changed')\\\"",
                ),
                finish,
                APPROVED_REVIEW_RESPONSE,
            ],
        });

        expect(result.executionMode).toBe("structural_edit");
        expect(result.metrics?.plannerCalls).toBe(1);
        expect(result.workspaceDiff?.modifiedFiles).toContain("package.json");
    }, 15_000);

    it("does not PASS when the Locator points to a nonexistent selector and no diff is produced", async () => {
        const { result } = await runScenario({
            currentRequest: "Change .missing-widget color to red",
            responses: [PLANNER_RESPONSE, finish, APPROVED_REVIEW_RESPONSE],
        });

        expect(result.executionMode).toBe("structural_edit");
        expect(result.review.accepted).toBe(false);
        expect(result.workspaceDiff?.modifiedFiles).toEqual([]);
        expect(result.requirements?.[0]?.status).toBe("UNVERIFIED");
    });

    it("rejects a CSS edit that also changes a scope-outside rule in the same file", async () => {
        const { workspaceRoot } = await createWorkspace();
        const beforeSnapshots = await createWorkspaceSnapshot(workspaceRoot);
        const scope = await locateFocusedEditScope({
            request: "Change the left sidebar width to 220px, other areas do not modify",
            workspaceRoot,
            beforeSnapshots,
        });
        const rejected = validateFocusedEditAction({
            scope,
            beforeSnapshots,
            action: {
                type: "edit_file",
                path: "src/App.css",
                oldText: `.sidebar {
    width: 260px;
}

.hero {
    background: blue;
    padding: 24px;
}`,
                newText: `.sidebar {
    width: 220px;
}

.hero {
    background: red;
    padding: 24px;
}`,
            },
        });

        expect(scope.allowedRanges.some((range) => range.kind === "css_rule")).toBe(true);
        expect(rejected?.ok).toBe(false);
        expect(rejected?.message).toContain(
            "outside allowed ranges",
        );
    });

    it("rejects an AST-range edit to Header when the target is SubmitButton", async () => {
        const { workspaceRoot } = await createWorkspace();
        const beforeSnapshots = await createWorkspaceSnapshot(workspaceRoot);
        const scope = await locateFocusedEditScope({
            request: "Only modify SubmitButton text to Submit",
            workspaceRoot,
            beforeSnapshots,
        });
        const rejected = validateFocusedEditAction({
            scope,
            beforeSnapshots,
            action: {
                type: "edit_file",
                path: "src/App.tsx",
                oldText: "Header copy",
                newText: "Unexpected header copy",
            },
        });

        expect(scope.allowedRanges.some((range) => range.symbol === "SubmitButton")).toBe(true);
        expect(rejected?.ok).toBe(false);
        expect(rejected?.message).toContain(
            "outside allowed ranges",
        );
    });

    it("marks size requirements UNVERIFIED when browser evidence is missing", async () => {
        const { result } = await runScenario({
            currentRequest: "Change the left sidebar width to 220px",
            responses: [
                editFile("src/App.css", "width: 260px;", "width: 220px;"),
                finish,
            ],
        });

        expect(result.executionMode).toBe("fast_edit");
        expect(result.review.accepted).toBe(false);
        expect(result.requirements?.[0]?.status).toBe("UNVERIFIED");
    });

    it("rejects Coding Agent writes outside the Focused Edit scope", async () => {
        const { workspaceRoot } = await createWorkspace();
        const beforeSnapshots = await createWorkspaceSnapshot(workspaceRoot);
        const scope = await locateFocusedEditScope({
            request: "Change the button text from Start to Submit",
            workspaceRoot,
            beforeSnapshots,
        });
        const rejected = validateFocusedEditAction({
            scope,
            beforeSnapshots,
            action: {
                type: "edit_file",
                path: "src/About.tsx",
                oldText: "<h1>About old</h1>",
                newText: "<h1>Unexpected</h1>",
            },
        });

        expect(scope.confidence).toBeGreaterThanOrEqual(0.7);
        expect(rejected?.ok).toBe(false);
        expect(rejected?.message).toContain("Focused edit scope violation");
    });
});
