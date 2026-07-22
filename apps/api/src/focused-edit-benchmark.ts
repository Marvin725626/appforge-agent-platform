import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FakeModelProvider } from "@appforge/agent-core";
import type { BrowserEvalResult } from "@appforge/harness";

import { runReactAppAgent, type RunReactAppAgentResult } from "./run-react-app-agent.js";

const BASE_APP = `import React from 'react';
import './App.css';
import { AboutPage } from './About';

export function App() {
    return (
        <div className="app-shell">
            <aside className="sidebar">Navigation</aside>
            <main className="content">
                <section className="hero">
                    <img className="hero-image" src="/old-hero.jpg" alt="Hero" />
                    <h1>Welcome</h1>
                    <button className="primary-button">Start</button>
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

const PLANNER_RESPONSE = {
    content: JSON.stringify({
        summary: "Plan structural edit.",
        steps: [
            {
                id: "step-1",
                title: "Apply structural edit",
                description: "Modify the requested workspace.",
                acceptanceCriteria: ["The request is reflected in files."],
            },
        ],
    }),
};

const APPROVED_REVIEW_RESPONSE = {
    content: JSON.stringify({
        accepted: true,
        reason: "Accepted.",
        issues: [],
    }),
};

type Scenario = {
    name: string;
    request: string;
    expectedMode: "fast_edit" | "structural_edit";
    expectedAccepted: boolean;
    expectedScopeViolation?: boolean;
    responses: Array<{ content: string }>;
    browserEval?: BrowserEvalResult;
};

type ScenarioResult = {
    name: string;
    expectedMode: Scenario["expectedMode"];
    actualMode: RunReactAppAgentResult["executionMode"];
    expectedAccepted: boolean;
    expectedScopeViolation: boolean;
    actualAccepted: boolean;
    plannerCalls: number;
    codingCalls: number;
    reviewerCalls: number;
    retryCalls: number;
    npmInstallSkipped: boolean;
    totalDurationMs: number;
    modifiedFiles: string[];
    workspaceDiffModifiedFiles: string[];
    requirementStatuses: Array<{ id: string; status: string }>;
    unexpectedFileChanges: string[];
    unexpectedRangeChanges: number;
    scopeViolations: number;
    browserEvidenceCount: number;
};

function editFile(filePath: string, oldText: string, newText: string) {
    return {
        content: JSON.stringify({
            type: "edit_file",
            path: filePath,
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

const scenarios: Scenario[] = [
    {
        name: "button_text",
        request: "Change the button text from Start to Submit and do not modify other areas",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/App.tsx", ">Start</button>", ">Submit</button>"),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "button text", passed: true }],
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
        },
    },
    {
        name: "sidebar_width",
        request: "Change the left sidebar width to 220px, other areas do not modify",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/App.css", "width: 260px;", "width: 220px;"),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "computed width is 220px", passed: true }],
            evidence: [
                {
                    source: "computed_style",
                    requirementId: "REQ-1",
                    selector: ".sidebar",
                    property: "width",
                    expected: "220px",
                    actual: "220.00px",
                },
            ],
        },
    },
    {
        name: "hero_background",
        request: "Change the Hero background from blue to dark gray",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/App.css", "background: blue;", "background: #202124;"),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "hero background", passed: true }],
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
        },
    },
    {
        name: "delete_second_module",
        request: "Delete the second feature module, do not modify the other modules",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile(
                "src/App.tsx",
                '                    <article className="feature-card feature-two">Second feature</article>\n',
                "",
            ),
            finish,
        ],
        browserEval: {
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
        },
    },
    {
        name: "move_button",
        request: "Move the button to the right by 16px",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/App.css", "margin-left: 0;", "margin-left: 16px;"),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "button moved", passed: true }],
            evidence: [
                {
                    source: "computed_style",
                    requirementId: "REQ-1",
                    selector: "button",
                    property: "margin-left",
                    expected: "16px",
                    actual: "16px",
                },
            ],
        },
    },
    {
        name: "about_title",
        request: "Only modify the /about page title to About new, do not modify other routes",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/About.tsx", "<h1>About old</h1>", "<h1>About new</h1>"),
            finish,
        ],
        browserEval: {
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
        },
    },
    {
        name: "mobile_single_column",
        request: "On mobile make the feature grid single column, keep desktop layout unchanged",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile(
                "src/App.css",
                "grid-template-columns: repeat(2, 1fr);",
                "grid-template-columns: 1fr;",
            ),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "mobile single column", passed: true }],
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
        },
    },
    {
        name: "hero_image",
        request: "Replace the Hero image asset only, do not modify the copy",
        expectedMode: "fast_edit",
        expectedAccepted: true,
        responses: [
            editFile("src/App.tsx", 'src="/old-hero.jpg"', 'src="/new-hero.jpg"'),
            finish,
        ],
        browserEval: {
            passed: true,
            checks: [{ name: "hero image", passed: true }],
            evidence: [
                {
                    source: "browser",
                    requirementId: "REQ-1",
                    selector: ".hero img",
                    property: "src",
                    expected: "/new-hero.jpg",
                    actual: "/new-hero.jpg",
                },
            ],
        },
    },
    {
        name: "scope_outside_css",
        request: "Change the left sidebar width to 220px, other areas do not modify",
        expectedMode: "fast_edit",
        expectedAccepted: false,
        expectedScopeViolation: true,
        responses: [
            editFile(
                "src/App.css",
                `.sidebar {
    width: 260px;
}

.hero {
    background: blue;
    padding: 24px;
}`,
                `.sidebar {
    width: 220px;
}

.hero {
    background: red;
    padding: 24px;
}`,
            ),
            finish,
        ],
    },
    {
        name: "scope_outside_tsx",
        request: "Change the button text from Start to Submit and do not modify other areas",
        expectedMode: "fast_edit",
        expectedAccepted: false,
        expectedScopeViolation: true,
        responses: [
            editFile("src/App.tsx", "<h1>Welcome</h1>", "<h1>Unexpected title</h1>"),
            finish,
        ],
    },
    {
        name: "missing_browser_evidence",
        request: "Change the Hero background from blue to dark gray",
        expectedMode: "fast_edit",
        expectedAccepted: false,
        responses: [
            editFile("src/App.css", "background: blue;", "background: #202124;"),
            finish,
        ],
    },
    {
        name: "whole_redo",
        request: "Completely redo the entire homepage with a new structure",
        expectedMode: "structural_edit",
        expectedAccepted: false,
        responses: [
            PLANNER_RESPONSE,
            editFile("src/App.tsx", "<h1>Welcome</h1>", "<h1>New homepage</h1>"),
            finish,
            APPROVED_REVIEW_RESPONSE,
        ],
    },
    {
        name: "package_json",
        request: "Modify package.json build script to echo changed",
        expectedMode: "structural_edit",
        expectedAccepted: false,
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
    },
    {
        name: "missing_selector",
        request: "Change .missing-widget color to red",
        expectedMode: "structural_edit",
        expectedAccepted: false,
        responses: [PLANNER_RESPONSE, finish, APPROVED_REVIEW_RESPONSE],
    },
];

async function createWorkspace(): Promise<{
    workspaceRoot: string;
    templateRoot: string;
}> {
    const templateRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-focused-benchmark-template-"),
    );
    const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-focused-benchmark-workspace-"),
    );

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
    await writeFile(path.join(workspaceRoot, "src", "About.tsx"), BASE_ABOUT, "utf8");

    return { workspaceRoot, templateRoot };
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const { workspaceRoot, templateRoot } = await createWorkspace();

    try {
        const result = await runReactAppAgent({
            goal: "Benchmark existing workspace iteration.",
            currentRequest: scenario.request,
            resetWorkspace: false,
            maxRepairAttempts: 0,
            workspaceRoot,
            templateRoot,
            model: new FakeModelProvider(scenario.responses),
            ...(scenario.browserEval
                ? {
                      evaluateBrowser: async () => scenario.browserEval!,
                  }
                : {}),
            llm: {
                baseUrl: "https://example.com/v1",
                apiKey: "benchmark",
                model: "fake",
            },
        });

        return {
            name: scenario.name,
            expectedMode: scenario.expectedMode,
            actualMode: result.executionMode,
            expectedAccepted: scenario.expectedAccepted,
            expectedScopeViolation: scenario.expectedScopeViolation === true,
            actualAccepted: result.review.accepted,
            plannerCalls: result.metrics?.plannerCalls ?? 0,
            codingCalls: result.metrics?.codingCalls ?? 0,
            reviewerCalls: result.metrics?.reviewerCalls ?? 0,
            retryCalls: result.metrics?.retryCalls ?? 0,
            npmInstallSkipped: result.install.stdout.includes("Skipped npm install"),
            totalDurationMs: result.metrics?.totalDurationMs ?? 0,
            modifiedFiles: result.metrics?.modifiedFiles ?? [],
            workspaceDiffModifiedFiles: result.workspaceDiff?.modifiedFiles ?? [],
            requirementStatuses:
                result.requirements?.map((requirement) => ({
                    id: requirement.id,
                    status: requirement.status,
                })) ?? [],
            unexpectedFileChanges:
                result.requirements
                    ?.flatMap((requirement) =>
                        requirement.evidences.flatMap(
                            (evidence) => evidence.unexpectedFiles ?? [],
                        ),
                    )
                    .filter((filePath, index, files) => files.indexOf(filePath) === index) ?? [],
            unexpectedRangeChanges:
                result.requirements?.reduce(
                    (count, requirement) =>
                        count +
                        requirement.evidences.reduce(
                            (innerCount, evidence) =>
                                innerCount +
                                (evidence.unexpectedRanges?.length ?? 0),
                            0,
                        ),
                    0,
                ) ?? 0,
            scopeViolations: result.scopeViolations?.length ?? 0,
            browserEvidenceCount:
                result.requirements?.reduce(
                    (count, requirement) =>
                        count +
                        requirement.evidences.filter(
                            (evidence) =>
                                evidence.source === "browser" ||
                                evidence.source === "computed_style",
                        ).length,
                    0,
                ) ?? 0,
        };
    } finally {
        await Promise.all([
            rm(templateRoot, { recursive: true, force: true }),
            rm(workspaceRoot, { recursive: true, force: true }),
        ]);
    }
}

function rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function average(values: number[]): number {
    return values.length === 0
        ? 0
        : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function createMarkdown(summary: Record<string, number>, results: ScenarioResult[]): string {
    const metricRows = Object.entries(summary)
        .map(([key, value]) => `| ${key} | ${value} |`)
        .join("\n");
    const scenarioRows = results
        .map(
            (result) =>
                `| ${result.name} | ${result.actualMode} | ${result.actualAccepted ? "PASS" : "FAIL"} | ${result.plannerCalls} | ${result.codingCalls} | ${result.reviewerCalls} | ${result.npmInstallSkipped ? "yes" : "no"} | ${result.workspaceDiffModifiedFiles.join(", ") || "-"} |`,
        )
        .join("\n");

    return `# Focused Edit Benchmark

## Summary

| metric | value |
| --- | ---: |
${metricRows}

## Scenarios

| scenario | mode | accepted | plannerCalls | codingCalls | reviewerCalls | npm install skipped | workspace diff |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
${scenarioRows}

Real-model smoke entry: set APPFORGE_REAL_MODEL_SMOKE=1 and run a separate smoke command; this deterministic benchmark intentionally uses FakeModelProvider by default.
`;
}

async function main(): Promise<void> {
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
        results.push(await runScenario(scenario));
    }

    const fastScenarios = results.filter(
        (result) => result.expectedMode === "fast_edit",
    );
    const structuralScenarios = results.filter(
        (result) => result.expectedMode === "structural_edit",
    );
    const scopeViolationScenarios = results.filter(
        (result) => result.expectedScopeViolation,
    );
    const acceptedScenarios = results.filter((result) => result.actualAccepted);
    const acceptedFastScenarios = fastScenarios.filter(
        (result) => result.actualAccepted,
    );
    const requiredBrowserProbeScenarios = fastScenarios.filter(
        (result) => !result.expectedScopeViolation,
    );
    const executedBrowserProbeScenarios = results.filter(
        (result) => result.browserEvidenceCount > 0,
    );
    const summary = {
        totalCases: results.length,
        passedCases: results.filter(
            (result) => result.actualAccepted === result.expectedAccepted,
        ).length,
        focusedEditDetectionAccuracy: rate(
            results.filter((result) => result.actualMode === result.expectedMode)
                .length,
            results.length,
        ),
        requirementPassAccuracy: rate(
            results.filter(
                (result) => result.actualAccepted === result.expectedAccepted,
            ).length,
            results.length,
        ),
        preservationSuccessRate: rate(
            fastScenarios.filter(
                (result) => result.unexpectedFileChanges.length === 0,
            ).length,
            fastScenarios.length,
        ),
        scopeViolationDetectionRate: rate(
            scopeViolationScenarios.filter((result) => result.scopeViolations > 0)
                .length,
            scopeViolationScenarios.length,
        ),
        scopeViolationAttemptRate: rate(
            scopeViolationScenarios.length,
            results.length,
        ),
        unexpectedFileChangeRate: rate(
            results.filter((result) => result.unexpectedFileChanges.length > 0)
                .length,
            results.length,
        ),
        unexpectedRangeChangeRateOnAcceptedCases: rate(
            acceptedScenarios.filter(
                (result) => result.unexpectedRangeChanges > 0,
            ).length,
            acceptedScenarios.length,
        ),
        browserProbeCoverageForRequiredCases: rate(
            requiredBrowserProbeScenarios.filter(
                (result) => result.browserEvidenceCount > 0,
            ).length,
            requiredBrowserProbeScenarios.length,
        ),
        browserProbePassRateForExecutedProbes: rate(
            executedBrowserProbeScenarios.filter((result) => result.actualAccepted)
                .length,
            executedBrowserProbeScenarios.length,
        ),
        missingRequiredBrowserEvidenceRate: rate(
            requiredBrowserProbeScenarios.filter(
                (result) => result.browserEvidenceCount === 0,
            ).length,
            requiredBrowserProbeScenarios.length,
        ),
        averageCodingCalls: average(
            results.map((result) => result.codingCalls),
        ),
        averageTotalDurationMs: average(
            results.map((result) => result.totalDurationMs),
        ),
        npmInstallSkipRate: rate(
            acceptedFastScenarios.filter((result) => result.npmInstallSkipped)
                .length,
            acceptedFastScenarios.length,
        ),
        falseFastEditRate: rate(
            structuralScenarios.filter(
                (result) => result.actualMode === "fast_edit",
            ).length,
            structuralScenarios.length,
        ),
    };
    const payload = {
        generatedAt: new Date().toISOString(),
        provider: "FakeModelProvider",
        summary,
        results,
    };

    const repositoryRoot = path.resolve(process.cwd(), "../..");
    const artifactsDirectory = path.join(repositoryRoot, "artifacts");
    const jsonPath = path.join(artifactsDirectory, "focused-edit-benchmark.json");
    const markdownPath = path.join(artifactsDirectory, "focused-edit-benchmark.md");
    const markdown = createMarkdown(summary, results);

    await mkdir(artifactsDirectory, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, markdown, "utf8");

    console.log(JSON.stringify(payload, null, 2));
    console.log("\n--- markdown ---\n");
    console.log(markdown);
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${markdownPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
