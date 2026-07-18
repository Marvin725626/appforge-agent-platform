import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RunSchema } from "@appforge/protocol";
import {
  readWorkspaceFile,
  WorkspaceManager,
  writeWorkspaceFile,
} from "@appforge/workspace";
import {
  FakeBrowserEvaluator,
  type BrowserEvaluator,
} from "@appforge/harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp, resolveExecutionContract } from "./app.js";
import { MemoryRepository } from "./memory-repository.js";
import { PreviewManager } from "./preview-manager.js";
import { RunRepository } from "./run-repository.js";
import { saveRunVersionSnapshot } from "./run-version-snapshot.js";
import type { RunReactAppAgentResult } from "./run-react-app-agent.js";

vi.mock("./run-version-snapshot.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./run-version-snapshot.js")>();

  return {
    ...actual,
    saveRunVersionSnapshot: vi.fn(actual.saveRunVersionSnapshot),
  };
});

const temporaryDirectories: string[] = [];

const TEST_COORDINATION = {
  goal: "Create a task application",
  plan: [],
  assignments: [],
};

const CHANGED_AGENT_STEPS = [
  {
    action: {
      type: "write_file" as const,
      path: "src/App.tsx",
      content: "export function App() { return null; }",
    },
    execution: {
      ok: true,
      message: "Wrote file: src/App.tsx",
    },
  },
];

describe("resolveExecutionContract", () => {
  it("keeps accepted requirements and makes the current request authoritative", () => {
    const contract = resolveExecutionContract({
      initialGoal: "Create an Apex landing page",
      versions: [
        {
          id: "version-0-duplicate",
          runId: "run-1",
          versionNumber: 1,
          goal: "Create an Apex landing page",
          summary: "Duplicate legacy goal",
          createdAt: "2026-07-15T23:00:00.000Z",
        },
        {
          id: "version-2",
          runId: "run-1",
          versionNumber: 3,
          goal: "Add working page navigation",
          summary: "Navigation",
          createdAt: "2026-07-16T01:00:00.000Z",
        },
        {
          id: "version-1",
          runId: "run-1",
          versionNumber: 2,
          goal: "Keep an Apex landing page",
          summary: "Initial design",
          createdAt: "2026-07-16T00:00:00.000Z",
        },
        {
          id: "version-3-rejected",
          runId: "run-1",
          versionNumber: 4,
          goal: "Discard the working navigation",
          summary: "Rejected attempt",
          review: {
            accepted: false,
            reason: "Rejected by review",
            checks: {
              agentFinished: true,
              installPassed: true,
              buildPassed: true,
              evalPassed: false,
            },
          },
          createdAt: "2026-07-16T02:00:00.000Z",
        },
        {
          id: "version-legacy-needs-review",
          runId: "run-1",
          versionNumber: 5,
          goal: "Replace the accepted navigation with an unfinished draft",
          summary: "Iteration attempt 5 needs review",
          createdAt: "2026-07-16T03:00:00.000Z",
        },
      ],
      pendingRequest: "Increase the logo contrast",
      currentRequest: "Use a white logo on the dark header",
      maxCharacters: 1_000,
    });

    expect(contract.length).toBeLessThanOrEqual(1_000);
    expect(contract).toContain("Create an Apex landing page");
    expect(contract.match(/Create an Apex landing page/gu)).toHaveLength(1);
    expect(contract).toContain("Keep an Apex landing page");
    expect(contract).toContain("Add working page navigation");
    expect(contract).toContain("Increase the logo contrast");
    expect(contract).toContain("Use a white logo on the dark header");
    expect(contract).not.toContain("Discard the working navigation");
    expect(contract).not.toContain(
      "Replace the accepted navigation with an unfinished draft",
    );
    expect(contract).toContain("newest explicit request has highest priority");
    expect(contract.indexOf("Keep an Apex landing page")).toBeLessThan(
      contract.indexOf("Add working page navigation"),
    );
  });
});

function createSuccessfulAgentResult(workspaceRoot: string) {
  return {
    workspaceRoot,
    coordination: TEST_COORDINATION,
    agent: {
      finished: true,
      steps: [],
    },
    install: {
      exitCode: 0,
      stdout: "install ok",
      stderr: "",
    },
    build: {
      exitCode: 0,
      stdout: "build ok",
      stderr: "",
    },
    eval: {
      passed: true,
      checks: [
        {
          name: "has input",
          passed: true,
        },
        {
          name: "has button",
          passed: true,
        },
      ],
    },
    browserEval: {
      passed: true,
      checks: [
        {
          name: "adds a task item",
          passed: true,
        },
      ],
    },
    review: {
      accepted: true,
      reason: "Agent finished and install/build/eval/browser checks passed.",
      checks: {
        agentFinished: true,
        installPassed: true,
        buildPassed: true,
        evalPassed: true,
        browserPassed: true,
      },
    },
    attempts: [
      {
        kind: "initial" as const,
        agent: {
          finished: true,
          steps: [],
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "has input",
              passed: true,
            },
            {
              name: "has button",
              passed: true,
            },
          ],
        },
        browserEval: {
          passed: true,
          checks: [
            {
              name: "adds a task item",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Agent finished and install/build/eval/browser checks passed.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
            browserPassed: true,
          },
        },
      },
    ],
  };
}

function createZeroProgressModelErrorResult(
  workspaceRoot: string,
): RunReactAppAgentResult {
  const result = createSuccessfulAgentResult(workspaceRoot);
  const errorMessage =
    "initial Coding Agent model request failed: Model request timed out after 90000ms";
  const agent = {
    finished: false,
    stopReason: "model_error" as const,
    errorMessage,
    steps: [],
  };
  const review = {
    accepted: false,
    reason:
      "Rejected because the requested independent pages do not have a verifiable routing implementation.",
    checks: {
      agentFinished: false,
      installPassed: true,
      buildPassed: true,
      evalPassed: false,
      browserPassed: false,
    },
  };

  return {
    ...result,
    agent,
    review,
    attempts: result.attempts.map((attempt) => ({
      ...attempt,
      agent,
      review,
    })),
  };
}

async function writeRunnableWorkspace(
  workspaceRoot: string,
  appSource: string,
): Promise<void> {
  await Promise.all([
    writeWorkspaceFile(
      workspaceRoot,
      "package.json",
      JSON.stringify({ scripts: { build: "vite build" } }),
    ),
    writeWorkspaceFile(workspaceRoot, "index.html", '<div id="root"></div>'),
    writeWorkspaceFile(
      workspaceRoot,
      "src/main.tsx",
      "import { App } from './App.js'; void App;",
    ),
    writeWorkspaceFile(workspaceRoot, "src/App.tsx", appSource),
  ]);
}

async function buildTestApp(
  previewManager?: PreviewManager,
  browserEvaluator: BrowserEvaluator = new FakeBrowserEvaluator({
    passed: true,
    checks: [],
  }),
) {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-api-"),
  );

  temporaryDirectories.push(temporaryRoot);

  const workspaceManager = new WorkspaceManager(temporaryRoot);
  const runRepository = new RunRepository();

  return {
    app: buildApp(
        runRepository,
        workspaceManager,
        undefined,
        previewManager,
        undefined,
        browserEvaluator,
    ),
    workspaceManager,
    runRepository,
  };
}

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
  vi.mocked(saveRunVersionSnapshot).mockClear();
});

describe("GET /health", () => {
  it("returns the API health status", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
    });
  });

  it("allows browser preflight requests for deleting runs", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/runs/example-run",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain(
      "DELETE",
    );
  });
});
describe("POST /runs", () => {
  it("creates a queued run from a valid goal", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "  Create a task application  ",
      },
    });

    expect(response.statusCode).toBe(201);
    const run = RunSchema.parse(response.json());

    expect(run.goal).toBe("Create a task application");
    expect(run.status).toBe("queued");

    const workspaceStats = await stat(
      workspaceManager.resolve(run.id),
    );

    expect(workspaceStats.isDirectory()).toBe(true);
  });

  it("rejects an empty goal", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "   ",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid create run input",
    });
  });

  it("preserves Chinese goals when creating a run", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "我想要一个介绍温州的界面",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().goal).toBe("我想要一个介绍温州的界面");
  });

  it("rejects goals that appear to be garbled text", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "我想要一个介绍温州的界面",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Goal appears to be garbled text",
      message: "Please re-enter the goal using UTF-8 text.",
    });
  });
});
describe("GET /runs", () => {
  it("returns all created runs", async () => {
    const { app } = await buildTestApp();

    const firstCreateResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create the first app",
      },
    });

    const secondCreateResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create the second app",
      },
    });

    const firstRun = RunSchema.parse(firstCreateResponse.json());
    const secondRun = RunSchema.parse(secondCreateResponse.json());

    const response = await app.inject({
      method: "GET",
      url: "/runs",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runs: [firstRun, secondRun],
    });
  });

  it("keeps old step-limit-only review failures waiting for human review in the run list", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operation: "repair",
      operationPrompt: "Agent finished",
      errorMessage: "Rejected because agent did not finish.",
    });
    await runRepository.saveResult(createdRun.id, {
      ...createSuccessfulAgentResult(workspaceManager.resolve(createdRun.id)),
      agent: {
        finished: false,
        steps: [],
      },
      review: {
        accepted: false,
        reason: "Rejected because agent did not finish.",
        checks: {
          agentFinished: false,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
          browserPassed: true,
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/runs",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runs[0]).toMatchObject({
      id: createdRun.id,
      status: "waiting_for_human",
    });
  });

  it("migrates a legacy zero-progress model timeout out of human review in the run list", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a routed Wenzhou introduction page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const existingVersion = {
      id: "existing-version",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Keep the last accepted page",
      summary: "Existing accepted version",
      createdAt: "2026-07-16T09:00:00.000Z",
    };

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operation: "repair",
      operationId: "legacy-timeout",
      operationStage: "reviewing",
      operationStartedAt: "2026-07-16T10:00:00.000Z",
      operationUpdatedAt: "2026-07-16T10:03:00.000Z",
      operationPrompt: "Create working page navigation",
    });
    await runRepository.saveVersion(existingVersion);
    await runRepository.saveResult(
      createdRun.id,
      createZeroProgressModelErrorResult(
        workspaceManager.resolve(createdRun.id),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: "/runs",
    });
    const expectedReason =
      "No new draft was produced because the coding model failed before changing the workspace. Agent error: initial Coding Agent model request failed: Model request timed out after 90000ms";

    expect(response.statusCode).toBe(200);
    expect(response.json().runs[0]).toEqual(
      expect.objectContaining({
        id: createdRun.id,
        status: "failed",
        operationPrompt: "Create working page navigation",
        errorMessage: expectedReason,
        latestVersion: existingVersion,
      }),
    );
    expect(response.json().runs[0]).not.toHaveProperty("operation");
    expect(response.json().runs[0]).not.toHaveProperty("operationId");
    expect(response.json().runs[0]).not.toHaveProperty("operationStage");
    expect(await runRepository.listVersions(createdRun.id)).toEqual([
      existingVersion,
    ]);

    const persistedResult = await runRepository.findResultByRunId(
      createdRun.id,
    );
    expect(persistedResult?.review.reason).toBe(expectedReason);
    expect(persistedResult?.agent.errorMessage).toBe(
      "initial Coding Agent model request failed: Model request timed out after 90000ms",
    );
  });
});
describe("GET /runs/:id", () => {
  it("returns a previously created run", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      run: createdRun,
      versions: [],
    });
  });

  it("keeps old step-limit-only review failures rejected in run details", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operation: "repair",
      operationPrompt: "Agent finished",
      errorMessage: "Rejected because agent did not finish.",
    });
    await runRepository.saveResult(createdRun.id, {
      ...createSuccessfulAgentResult(workspaceManager.resolve(createdRun.id)),
      agent: {
        finished: false,
        steps: [],
      },
      review: {
        accepted: false,
        reason: "Rejected because agent did not finish.",
        checks: {
          agentFinished: false,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
          browserPassed: true,
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.run).toMatchObject({
      id: createdRun.id,
      status: "waiting_for_human",
    });
    expect(body.result.review).toMatchObject({
      accepted: false,
    });
    expect(body.result.review.reason).toBe("Rejected because agent did not finish.");
  });

  it("migrates a legacy zero-progress model timeout out of human review in run details", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a routed Wenzhou introduction page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operation: "initial_generation",
    });
    await runRepository.saveResult(
      createdRun.id,
      createZeroProgressModelErrorResult(
        workspaceManager.resolve(createdRun.id),
      ),
    );

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    const body = response.json();
    const expectedReason =
      "No new draft was produced because the coding model failed before changing the workspace. Agent error: initial Coding Agent model request failed: Model request timed out after 90000ms";

    expect(response.statusCode).toBe(200);
    expect(body.run).toEqual({
      ...createdRun,
      status: "failed",
      errorMessage: expectedReason,
    });
    expect(body.result.review).toMatchObject({
      accepted: false,
      reason: expectedReason,
    });
    expect(body.result.agent).toMatchObject({
      stopReason: "model_error",
      errorMessage:
        "initial Coding Agent model request failed: Model request timed out after 90000ms",
      steps: [],
    });
    expect(body.versions).toEqual([]);
    expect(await runRepository.listVersions(createdRun.id)).toEqual([]);
  });

  it("reconciles an accepted result when the run status is stale", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a university homepage",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.save({
      ...createdRun,
      status: "repairing",
      operation: "repair",
      operationId: "current-repair",
      operationPrompt: "Regenerate the page",
      errorMessage: "Model request timed out after 90000ms",
    });
    const currentResult = {
      ...createSuccessfulAgentResult(workspaceManager.resolve(createdRun.id)),
      operationId: "current-repair",
    } as RunReactAppAgentResult & { operationId: string };
    await runRepository.saveResult(
      createdRun.id,
      currentResult,
    );

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });
  });

  it("does not overwrite a failed operation with an older accepted result", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a university homepage",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const failedRun = {
      ...createdRun,
      status: "failed" as const,
      operationId: "new-iteration",
      operationPrompt: "Add the admissions pages",
      errorMessage: "The operation was stopped after timing out.",
    };
    const staleResult = {
      ...createSuccessfulAgentResult(workspaceManager.resolve(createdRun.id)),
      operationId: "old-generation",
    } as RunReactAppAgentResult & { operationId: string };

    await runRepository.save(failedRun);
    await runRepository.saveResult(createdRun.id, staleResult);

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual(failedRun);
  });

  it("reconciles an unchanged iteration out of human review", async () => {
    const { app, runRepository, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const unchangedReason =
        "Iteration did not change the workspace compared with the latest saved version.";

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "Use Apex artwork",
    });
    await runRepository.saveResult(createdRun.id, {
      ...createSuccessfulAgentResult(workspaceManager.resolve(createdRun.id)),
      review: {
        accepted: false,
        reason: unchangedReason,
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
          browserPassed: true,
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "failed",
      operationPrompt: "Use Apex artwork",
      errorMessage: unchangedReason,
    });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/runs/missing-run",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });
});
describe("GET /runs/:id/report", () => {
  it("returns a report for a run before execution", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const reportResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/report`,
    });

    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({
      run: createdRun,
      statusLine:
        "Run queued: execution has not produced an agent result yet.",
      summary: {
        attempts: 0,
        evalPassedChecks: 0,
        evalTotalChecks: 0,
        browserPassedChecks: 0,
        browserTotalChecks: 0,
      },
      versions: [],
      files: [],
      memory: [],
    });
  });

  it("returns an execution report with files, versions, memory, and browser checks", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();

    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function App() { return <h1>Task App</h1>; }",
      );

      return createSuccessfulAgentResult(input.workspaceRoot);
    };

    const app = buildApp(
      undefined,
      workspaceManager,
      executeRun,
      undefined,
      memoryRepository,
      new FakeBrowserEvaluator({
        passed: true,
        checks: [],
      }),
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const reportResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/report`,
    });

    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({
      run: {
        id: createdRun.id,
        status: "succeeded",
      },
      summary: {
        attempts: 1,
        agentFinished: true,
        buildExitCode: 0,
        evalPassed: true,
        evalPassedChecks: 2,
        evalTotalChecks: 2,
        browserPassed: true,
        browserPassedChecks: 1,
        browserTotalChecks: 1,
        reviewAccepted: true,
      },
      versions: [
        {
          runId: createdRun.id,
          versionNumber: 1,
        },
      ],
      files: expect.arrayContaining(["src/App.tsx"]),
      memory: [
        {
          outcome: "succeeded",
        },
      ],
    });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/runs/missing-run/report",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });
});
describe("DELETE /runs/:id", () => {
  it("deletes a run and its workspace", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);

    expect((await stat(workspaceRoot)).isDirectory()).toBe(true);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/runs/${createdRun.id}`,
    });

    expect(deleteResponse.statusCode).toBe(204);

    const listResponse = await app.inject({
      method: "GET",
      url: "/runs",
    });

    expect(listResponse.json()).toEqual({
      runs: [],
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.statusCode).toBe(404);

    await expect(stat(workspaceRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns 404 when deleting a missing run", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "DELETE",
      url: "/runs/missing-run",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });
});
describe("GET /runs/:id/files", () => {
  it("lists files from a run workspace directory", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "src/App.tsx",
      "export function App() {}",
    );

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/files?directory=src`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      directory: "src",
      files: [path.join("src", "App.tsx")],
    });
  });

  it("returns a file from the run workspace", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "src/App.tsx",
      "export function App() {}",
    );

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/files?path=src/App.tsx`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: "src/App.tsx",
      content: "export function App() {}",
    });
  });

  it("rejects paths that escape the run workspace", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/files?path=../secret.txt`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid file path",
    });
  });
});
describe("GET /runs/:id/versions/:versionNumber/files", () => {
  it("returns a file from a saved version snapshot", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "versions/v1/src/App.tsx",
        "export function VersionOne() {}",
    );

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/versions/1/files?path=src/App.tsx`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      path: "src/App.tsx",
      content: "export function VersionOne() {}",
    });
  });

  it("rejects an invalid version number", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/versions/0/files?path=src/App.tsx`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid version number",
    });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/runs/missing-run/versions/1/files?path=src/App.tsx",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });
});
describe("DELETE /runs/:id/versions/:versionNumber", () => {
  it("deletes a version and renumbers later snapshots", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const app = buildApp(runRepository, workspaceManager);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    for (const versionNumber of [1, 2, 3]) {
      runRepository.saveVersion({
        id: `version-${versionNumber}`,
        runId: createdRun.id,
        versionNumber,
        goal: `Version ${versionNumber}`,
        summary: `Snapshot ${versionNumber}`,
        createdAt: "2026-07-10T00:00:00.000Z",
      });
      await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        `versions/v${versionNumber}/src/App.tsx`,
        `export const version = ${versionNumber};`,
      );
    }

    const response = await app.inject({
      method: "DELETE",
      url: `/runs/${createdRun.id}/versions/2`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      versions: [
        expect.objectContaining({
          id: "version-1",
          versionNumber: 1,
        }),
        expect.objectContaining({
          id: "version-3",
          versionNumber: 2,
        }),
      ],
    });

    const fileResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/versions/2/files?path=src/App.tsx`,
    });

    expect(fileResponse.statusCode).toBe(200);
    expect(fileResponse.json()).toEqual({
      path: "src/App.tsx",
      content: "export const version = 3;",
    });
  });
});
describe("POST /runs/:id/versions/:versionNumber/continue", () => {
  it("restores a selected version into the current workspace", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const app = buildApp(runRepository, workspaceManager);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a task application" },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Initial version",
      summary: "Snapshot 1",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "versions/v1/src/App.tsx",
      "export const restored = true;",
    );
    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "src/App.tsx",
      "export const restored = false;",
    );

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/versions/1/continue`,
    });

    expect(response.statusCode).toBe(200);
    await expect(
      readWorkspaceFile(workspaceManager.resolve(createdRun.id), "src/App.tsx"),
    ).resolves.toBe("export const restored = true;");
  });

  it("clears waiting-for-human state when continuing from a version", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const app = buildApp(runRepository, workspaceManager);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a task application" },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operation: "iteration",
      operationPrompt: "Add a logo",
      errorMessage: "Model request timed out after 90000ms",
    });
    runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Initial version",
      summary: "Snapshot 1",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "versions/v1/src/App.tsx",
      "export const restored = true;",
    );

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/versions/1/continue`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });

    const detailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(detailResponse.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });
    expect(detailResponse.json().result.review).toEqual(
      expect.objectContaining({
        accepted: true,
        reason: "Restored version v1 as the current workspace baseline.",
      }),
    );
  });
});
describe("POST /runs/:id/execute", () => {
  it("executes an existing run", async () => {
    const { app, workspaceManager } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Run execution is not configured",
    });
  });

  it("calls the configured executor for an existing run", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => {
      return {
        workspaceRoot: input.workspaceRoot,
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: [],
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
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
        },
        review: {
          accepted: true,
          reason: "Agent finished and install/build/eval passed.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [
          {
            kind: "initial" as const,
            agent: {
              finished: true,
              steps: [],
            },
            install: {
              exitCode: 0,
              stdout: "install ok",
              stderr: "",
            },
            build: {
              exitCode: 0,
              stdout: "build ok",
              stderr: "",
            },
            eval: {
              passed: true,
              checks: [
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
            },
            review: {
              accepted: true,
              reason: "Agent finished and install/build/eval passed.",
              checks: {
                agentFinished: true,
                installPassed: true,
                buildPassed: true,
                evalPassed: true,
              },
            },
          },
        ],
      };
    };

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });
    const succeededRun = {
      ...createdRun,
      status: "succeeded",
    };
    const expectedResult = {
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [
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
      },
      review: {
        accepted: true,
        reason: "Agent finished and install/build/eval passed.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [
        {
          kind: "initial" as const,
          agent: {
            finished: true,
            steps: [],
          },
          install: {
            exitCode: 0,
            stdout: "install ok",
            stderr: "",
          },
          build: {
            exitCode: 0,
            stdout: "build ok",
            stderr: "",
          },
          eval: {
            passed: true,
            checks: [
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
          },
          review: {
            accepted: true,
            reason: "Agent finished and install/build/eval passed.",
            checks: {
              agentFinished: true,
              installPassed: true,
              buildPassed: true,
              evalPassed: true,
            },
          },
        },
      ],
    };

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json()).toEqual({
      run: succeededRun,
      result: expectedResult,
      versions: [
        expect.objectContaining({
          runId: createdRun.id,
          versionNumber: 1,
          summary: "Initial generated version",
        }),
      ],
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.json()).toEqual({
      run: succeededRun,
      result: {
        ...expectedResult,
        operationId: expect.any(String),
      },
      versions: [
        expect.objectContaining({
          runId: createdRun.id,
          versionNumber: 1,
          summary: "Initial generated version",
        }),
      ],
    });
  });

  it("starts a run in the background and prevents duplicate execution", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-background-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    let finishExecution:
      | ((result: ReturnType<typeof createSuccessfulAgentResult>) => void)
      | undefined;
    const executeRun = vi.fn(
      (input: { workspaceRoot: string }) =>
        new Promise<ReturnType<typeof createSuccessfulAgentResult>>(
          (resolve) => {
            finishExecution = resolve;
          },
        ).then((result) => ({
          ...result,
          workspaceRoot: input.workspaceRoot,
        })),
    );
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a background task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
      },
    });

    expect(startResponse.statusCode).toBe(202);
    expect(startResponse.json()).toEqual({
      run: {
        ...createdRun,
        status: "running",
        operation: "initial_generation",
        operationId: expect.any(String),
        operationStage: "preparing",
        operationStartedAt: expect.any(String),
        operationUpdatedAt: expect.any(String),
      },
    });

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
      },
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toEqual({
      error: "Run is already executing",
    });
    await vi.waitFor(() => {
      expect(executeRun).toHaveBeenCalledTimes(1);
    });

    finishExecution?.(
      createSuccessfulAgentResult(
        workspaceManager.resolve(createdRun.id),
      ),
    );

    await vi.waitFor(
      async () => {
        const getResponse = await app.inject({
          method: "GET",
          url: `/runs/${createdRun.id}`,
        });

        expect(getResponse.json().run.status).toBe("succeeded");
      },
      {
        timeout: 5_000,
      },
    );
  });

  it("keeps the hard-timeout terminal state when a detached execution resolves late", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-late-timeout-result-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const findRun = vi.spyOn(runRepository, "findById");
    const saveRun = vi.spyOn(runRepository, "save");
    const saveResult = vi.spyOn(runRepository, "saveResult");
    const saveVersion = vi.spyOn(runRepository, "saveVersion");
    let finishExecution:
      | ((result: ReturnType<typeof createSuccessfulAgentResult>) => void)
      | undefined;
    const executeRun = vi.fn(
      (input: { workspaceRoot: string }) =>
        new Promise<ReturnType<typeof createSuccessfulAgentResult>>(
          (resolve) => {
            finishExecution = resolve;
          },
        ).then((result) => ({
          ...result,
          workspaceRoot: input.workspaceRoot,
        })),
    );
    const app = buildApp(
      runRepository,
      workspaceManager,
      executeRun,
      undefined,
      undefined,
      undefined,
      {
        timeoutMs: 20,
        abortGraceMs: 10,
      },
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a background task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
      },
    });

    expect(startResponse.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(executeRun).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(runRepository.findById(createdRun.id)).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Run execution timed out after 20ms",
        }),
      );
      expect(runRepository.findById(createdRun.id)).not.toHaveProperty(
        "operationId",
      );
    });

    const terminalRun = {
      ...runRepository.findById(createdRun.id),
    };
    const terminalSaveCount = saveRun.mock.calls.length;
    const authorityCheckCount = findRun.mock.calls.length;
    finishExecution?.(
      createSuccessfulAgentResult(
        workspaceManager.resolve(createdRun.id),
      ),
    );

    await vi.waitFor(() => {
      expect(findRun.mock.calls.length).toBeGreaterThan(
        authorityCheckCount,
      );
    });

    expect(runRepository.findById(createdRun.id)).toEqual(terminalRun);
    expect(runRepository.findById(createdRun.id)).toEqual(
      expect.objectContaining({
        status: "failed",
        errorMessage: "Run execution timed out after 20ms",
      }),
    );
    expect(saveRun).toHaveBeenCalledTimes(terminalSaveCount);
    expect(saveResult).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
    expect(runRepository.listVersions(createdRun.id)).toEqual([]);
    expect(runRepository.findResultByRunId(createdRun.id)).toBeUndefined();
  });

  it("settles a background run when preparation fails before the executor starts", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-background-prepare-failure-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) =>
      createSuccessfulAgentResult(input.workspaceRoot),
    );
    vi.spyOn(runRepository, "listVersions").mockImplementationOnce(() => {
      throw new Error("Could not load versions for execution");
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a background task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
      },
    });

    expect(startResponse.statusCode).toBe(202);

    await vi.waitFor(async () => {
      const detailResponse = await app.inject({
        method: "GET",
        url: `/runs/${createdRun.id}`,
      });
      const detail = detailResponse.json();

      expect(detail.run).toEqual(
        expect.objectContaining({
          id: createdRun.id,
          status: "failed",
          errorMessage: "Could not load versions for execution",
        }),
      );
      expect(detail.run).not.toHaveProperty("operation");
      expect(detail.run).not.toHaveProperty("operationId");
      expect(detail.result).toEqual(
        expect.objectContaining({
          operationId: expect.any(String),
          agent: expect.objectContaining({
            finished: false,
            stopReason: "action_failed",
          }),
          review: expect.objectContaining({
            accepted: false,
            reason: "Could not load versions for execution",
          }),
        }),
      );
    });
    expect(executeRun).not.toHaveBeenCalled();
  });

  it("does not unlock a still-running task when persisted status changes", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-stale-lock-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    let callCount = 0;
    let finishFirstExecution: (() => void) | undefined;
    const executeRun = vi.fn((input: { workspaceRoot: string }) => {
      callCount += 1;

      if (callCount === 1) {
        return new Promise<ReturnType<typeof createSuccessfulAgentResult>>(
          (resolve) => {
            finishFirstExecution = () =>
              resolve(createSuccessfulAgentResult(input.workspaceRoot));
          },
        );
      }

      return Promise.resolve(createSuccessfulAgentResult(input.workspaceRoot));
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const firstStartResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
      },
    });

    expect(firstStartResponse.statusCode).toBe(202);

    await vi.waitFor(() => {
      expect(executeRun).toHaveBeenCalledTimes(1);
    });

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "Add a logo",
      errorMessage: "Model request timed out after 90000ms",
    });

    const retryResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        background: true,
        resetWorkspace: false,
      },
    });

    expect(retryResponse.statusCode).toBe(409);
    expect(retryResponse.json()).toEqual({
      error: "Run is already executing",
    });
    expect(executeRun).toHaveBeenCalledTimes(1);

    finishFirstExecution?.();
  });

  it("cancels a background execution, rolls back its draft, and does not reconcile an old result", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-cancel-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    let observedSignal: AbortSignal | undefined;
    const executeRun = vi.fn(async (input: {
      workspaceRoot: string;
      signal?: AbortSignal;
    }) => {
      observedSignal = input.signal;
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function PreservedDraft() { return null; }",
      );

      return await new Promise<RunReactAppAgentResult>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason),
          { once: true },
        );
      });
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complex page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: { background: true },
    });

    expect(startResponse.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(observedSignal).toBeDefined();
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/cancel`,
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().run).toEqual(
      expect.objectContaining({
        id: createdRun.id,
        status: "cancelled",
        operationId: expect.any(String),
        errorMessage: "Run execution was cancelled by the user.",
      }),
    );
    expect(cancelResponse.json().run.operation).toBeUndefined();
    expect(observedSignal?.aborted).toBe(true);
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    expect(getResponse.json().run.status).toBe("cancelled");
    expect(getResponse.json().versions).toEqual([]);
  });

  it("tracks foreground execution so another request cannot overlap it", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-foreground-lock-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    let observedSignal: AbortSignal | undefined;
    const executeRun = vi.fn((input: { signal?: AbortSignal }) => {
      observedSignal = input.signal;

      return new Promise<RunReactAppAgentResult>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason),
          { once: true },
        );
      });
    });
    const app = buildApp(undefined, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complex page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const firstExecution = app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    await vi.waitFor(() => {
      expect(observedSignal).toBeDefined();
    });
    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: { background: true },
    });
    expect(duplicateResponse.statusCode).toBe(409);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/cancel`,
    });
    expect(cancelResponse.statusCode).toBe(200);
    expect((await firstExecution).statusCode).toBe(409);
    expect(executeRun).toHaveBeenCalledTimes(1);
  });

  it("preserves the iteration prompt and rolls back when cancellation stops a draft update", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-cancel-iteration-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    let observedSignal: AbortSignal | undefined;
    const executeRun = vi.fn(async (input: {
      workspaceRoot: string;
      signal?: AbortSignal;
    }) => {
      observedSignal = input.signal;
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function IterationDraft() { return null; }",
      );

      return await new Promise<RunReactAppAgentResult>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason),
          { once: true },
        );
      });
    });
    const app = buildApp(undefined, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complex page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "src/App.tsx",
      "export function StableApp() { return null; }",
    );
    const prompt = "Add a research portal and keep the current hero";
    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: { prompt, background: true },
    });

    expect(startResponse.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(observedSignal).toBeDefined();
    });
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/cancel`,
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().run).toEqual(
      expect.objectContaining({
        status: "cancelled",
        operationPrompt: prompt,
        operationId: expect.any(String),
      }),
    );
    expect(cancelResponse.json().run.operation).toBeUndefined();
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toContain("StableApp");
  });

  it("does not reconcile an active background iteration with a previous result", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-active-iteration-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    let callCount = 0;
    let finishIteration: (() => Promise<void>) | undefined;
    const executeRun = vi.fn((input: { workspaceRoot: string }) => {
      callCount += 1;

      if (callCount === 1) {
        return Promise.resolve(createSuccessfulAgentResult(input.workspaceRoot));
      }

      return new Promise<RunReactAppAgentResult>(
        (resolve) => {
          finishIteration = async () => {
            await writeWorkspaceFile(
              input.workspaceRoot,
              "src/App.tsx",
              "export function App() { return <span>changed</span>; }",
            );
            const baseResult = createSuccessfulAgentResult(input.workspaceRoot);
            resolve({
              ...baseResult,
              agent: {
                finished: true,
                steps: CHANGED_AGENT_STEPS,
              },
              attempts: [
                {
                  kind: "initial",
                  agent: {
                    finished: true,
                    steps: CHANGED_AGENT_STEPS,
                  },
                  install: baseResult.install,
                  build: baseResult.build,
                  eval: baseResult.eval,
                  browserEval: baseResult.browserEval,
                  review: baseResult.review,
                },
              ],
            });
          };
        },
      );
    });
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().run.status).toBe("succeeded");

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a visible badge",
        background: true,
      },
    });

    expect(iterateResponse.statusCode).toBe(202);

    const getWhileRunningResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getWhileRunningResponse.json().run).toEqual(
      expect.objectContaining({
        status: "running",
        operation: "iteration",
        operationPrompt: "Add a visible badge",
      }),
    );

    await vi.waitFor(() => {
      expect(executeRun).toHaveBeenCalledTimes(2);
    });
    await finishIteration?.();

    await vi.waitFor(
      async () => {
        const getResponse = await app.inject({
          method: "GET",
          url: `/runs/${createdRun.id}`,
        });

        expect(getResponse.json().run.status).toBe("succeeded");
      },
      {
        timeout: 5_000,
      },
    );
  });

  it("does not save a version when a quality-passing result is missing finish", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-normalized-version-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => ({
      ...createSuccessfulAgentResult(input.workspaceRoot),
      agent: {
        finished: false,
        steps: [],
      },
      review: {
        accepted: false,
        reason: "Rejected because agent did not finish.",
        checks: {
          agentFinished: false,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
          browserPassed: true,
        },
      },
    }));
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().run.status).toBe("waiting_for_human");
    expect(executeResponse.json().versions).toEqual([]);

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.json()).toEqual(
      expect.objectContaining({
        run: expect.objectContaining({
          status: "waiting_for_human",
        }),
        result: expect.objectContaining({
          review: expect.objectContaining({
            accepted: false,
          }),
        }),
        versions: [],
      }),
    );
  });

  it("stores a new version when a failed run is retried successfully", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-retry-version-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) =>
      createSuccessfulAgentResult(input.workspaceRoot),
    );
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const firstExecuteResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(firstExecuteResponse.statusCode).toBe(200);
    expect(firstExecuteResponse.json().versions).toEqual([
      expect.objectContaining({
        versionNumber: 1,
        summary: "Initial generated version",
      }),
    ]);

    await runRepository.save({
      ...createdRun,
      status: "failed",
      errorMessage: "Previous repair failed",
    });

    const retryResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryResponse.json().versions).toEqual([
      expect.objectContaining({
        versionNumber: 1,
        summary: "Initial generated version",
      }),
      expect.objectContaining({
        versionNumber: 2,
        summary: "Execution version 2",
      }),
    ]);
  });

  it("keeps the pending request and accepted requirements when retrying", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-retry-contract-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      workspaceRoot: string;
      goal: string;
      currentRequest?: string | undefined;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function UpdatedApp() { return null; }",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a Tsinghua university homepage" },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Add working navigation between independent pages",
      summary: "Navigation version",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    await runRepository.save({
      ...createdRun,
      status: "failed",
      operationPrompt: "Make the logo white so it contrasts with the header",
      errorMessage: "Previous attempt timed out",
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(response.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRequest:
          "Make the logo white so it contrasts with the header",
        goal: expect.stringContaining(
          "Add working navigation between independent pages",
        ),
        resetWorkspace: true,
      }),
    );
    const executedGoal = executeRun.mock.calls[0]?.[0].goal ?? "";
    expect(executedGoal).toContain("Create a Tsinghua university homepage");
    expect(executedGoal).toContain(
      "Make the logo white so it contrasts with the header",
    );
    expect(response.json().versions.at(-1)).toEqual(
      expect.objectContaining({
        goal: "Make the logo white so it contrasts with the header",
      }),
    );
  });

  it("marks a rolled-back rejected execution as failed", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const rejectedResult: RunReactAppAgentResult = {
      workspaceRoot: "",
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [
          {
            action: {
              type: "write_file",
              path: "src/App.tsx",
              content: "export function App() { return null; }",
            },
            execution: {
              ok: true,
              message: "Wrote file: src/App.tsx",
            },
          },
        ],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: false,
        checks: [
          {
            name: "has input",
            passed: false,
          },
        ],
      },
      review: {
        accepted: false,
        reason: "Rejected because eval failed.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: false,
        },
      },
      attempts: [
        {
          kind: "initial" as const,
          agent: {
            finished: true,
            steps: [],
          },
          install: {
            exitCode: 0,
            stdout: "install ok",
            stderr: "",
          },
          build: {
            exitCode: 0,
            stdout: "build ok",
            stderr: "",
          },
          eval: {
            passed: false,
            checks: [
              {
                name: "has input",
                passed: false,
              },
            ],
          },
          review: {
            accepted: false,
            reason: "Rejected because eval failed.",
            checks: {
              agentFinished: true,
              installPassed: true,
              buildPassed: true,
              evalPassed: false,
            },
          },
        },
      ],
    };

    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function RejectedDraft() { return null; }",
      );
      return {
        ...rejectedResult,
        workspaceRoot: input.workspaceRoot,
      };
    };

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);
    await Promise.all([
      writeWorkspaceFile(workspaceRoot, "package.json", "{}"),
      writeWorkspaceFile(workspaceRoot, "index.html", '<div id="root"></div>'),
      writeWorkspaceFile(workspaceRoot, "src/main.tsx", "import './App.js';"),
      writeWorkspaceFile(
        workspaceRoot,
        "src/App.tsx",
        "export function StableApp() { return null; }",
      ),
    ]);

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json()).toEqual(
      expect.objectContaining({
        run: expect.objectContaining({
          id: createdRun.id,
          status: "failed",
          errorMessage: expect.stringContaining(
            "rolled back to the complete runnable baseline",
          ),
        }),
        result: {
          ...rejectedResult,
          workspaceRoot,
        },
        versions: [],
      }),
    );
    const approveResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/approve`,
    });
    expect(approveResponse.statusCode).toBe(409);
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toContain("StableApp");
  });

  it("keeps a first rejected draft when no earlier workspace baseline exists", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const rejectedSource =
      "export function App() { return <main><h1>可继续修复的温州草稿</h1></main>; }";
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        rejectedSource,
      );
      const successful = createSuccessfulAgentResult(input.workspaceRoot);

      return {
        ...successful,
        agent: {
          ...successful.agent,
          finished: false,
          steps: CHANGED_AGENT_STEPS,
          stopReason: "model_error" as const,
        },
        review: {
          ...successful.review,
          accepted: false,
          reason: "Rejected because the coding model timed out.",
          checks: {
            ...successful.review.checks,
            agentFinished: false,
          },
        },
      };
    });
    const app = buildApp(undefined, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "我想要一个介绍温州的界面并且可以跳转" },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json().run.status).toBe("waiting_for_human");
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toBe(rejectedSource);
  });

  it("rebuilds from the starter when a continuation has no runnable workspace", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      currentRequest?: string | undefined;
      resetWorkspace?: boolean | undefined;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function App() { return <main>Recovered</main>; }",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a routed Wenzhou page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await runRepository.save({
      ...createdRun,
      status: "failed",
      operationPrompt: "Keep all pages and finish navigation",
      errorMessage: "Previous draft was lost",
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(response.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRequest: "Keep all pages and finish navigation",
        resetWorkspace: true,
      }),
    );
  });

  it("restarts initial generation after a zero-progress failure instead of continuing the starter", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-zero-progress-retry-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      resetWorkspace?: boolean | undefined;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function App() { return <main>Generated page</main>; }",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a routed Wenzhou page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);

    await writeRunnableWorkspace(
      workspaceRoot,
      "export function App() { return <main>React task app workspace</main>; }",
    );
    await runRepository.save({
      ...createdRun,
      status: "failed",
      errorMessage: "No new draft was produced after a model timeout.",
    });
    await runRepository.saveResult(
      createdRun.id,
      createZeroProgressModelErrorResult(workspaceRoot),
    );

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(response.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resetWorkspace: true,
      }),
    );
  });

  it("restarts a failed no-version run from the starter even when the client requests continuation", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-failed-no-version-retry-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      resetWorkspace?: boolean | undefined;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function App() { return <main>Fresh generated page</main>; }",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "我想要一个介绍温州的界面 并且可以跳转" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);
    const rejectedResult: RunReactAppAgentResult =
      createSuccessfulAgentResult(workspaceRoot);

    rejectedResult.agent = {
      finished: true,
      steps: CHANGED_AGENT_STEPS,
    };
    rejectedResult.review = {
      accepted: false,
      reason:
        "Rejected because automatic repair failed after browser validation.",
      checks: {
        agentFinished: true,
        installPassed: true,
        buildPassed: true,
        evalPassed: true,
        browserPassed: false,
      },
    };
    rejectedResult.attempts = rejectedResult.attempts.map((attempt) => ({
      ...attempt,
      agent: rejectedResult.agent,
      review: rejectedResult.review,
    }));

    await writeRunnableWorkspace(
      workspaceRoot,
      "export function App() { return <main>Broken interrupted draft</main>; }",
    );
    await runRepository.save({
      ...createdRun,
      status: "failed",
      errorMessage:
        "Automatic repair failed before a new attempt completed. The rejected workspace changes were rolled back.",
    });
    await runRepository.saveResult(createdRun.id, rejectedResult);

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: { background: true, resetWorkspace: false },
    });

    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(executeRun).toHaveBeenCalled();
    });
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        resetWorkspace: true,
      }),
    );
  });

  it("treats a new iteration after a zero-progress failure as fresh generation", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-zero-progress-iteration-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      resetWorkspace?: boolean | undefined;
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function App() { return <main>Fresh routed page</main>; }",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a Wenzhou introduction" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);

    await writeRunnableWorkspace(
      workspaceRoot,
      "export function App() { return <main>React task app workspace</main>; }",
    );
    await runRepository.save({
      ...createdRun,
      status: "failed",
      errorMessage: "No new draft was produced after a model timeout.",
    });
    await runRepository.saveResult(
      createdRun.id,
      createZeroProgressModelErrorResult(workspaceRoot),
    );

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "增加可以跳转的独立页面",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRequest: "增加可以跳转的独立页面",
        resetWorkspace: true,
      }),
    );
  });

  it("restores the latest complete snapshot before continuing a damaged workspace", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    let restoredSource = "";
    const executeRun = vi.fn(async (input: {
      resetWorkspace?: boolean | undefined;
      workspaceRoot: string;
    }) => {
      restoredSource = await readWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
      );
      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complete multi-page site" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);
    const acceptedSource =
      "export function App() { return <main>Accepted complete site</main>; }";

    await Promise.all([
      writeWorkspaceFile(workspaceRoot, "package.json", "{}"),
      writeWorkspaceFile(workspaceRoot, "index.html", '<div id="root"></div>'),
      writeWorkspaceFile(workspaceRoot, "src/main.tsx", "import './App.js';"),
      writeWorkspaceFile(workspaceRoot, "src/App.tsx", acceptedSource),
    ]);
    await saveRunVersionSnapshot({
      workspaceRoot,
      versionNumber: 1,
      snapshotId: "accepted-complete-snapshot",
    });
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "accepted-complete-snapshot",
      goal: createdRun.goal,
      summary: "Accepted complete site",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    await Promise.all([
      rm(path.join(workspaceRoot, "package.json"), { force: true }),
      rm(path.join(workspaceRoot, "index.html"), { force: true }),
      rm(path.join(workspaceRoot, "src"), { recursive: true, force: true }),
    ]);

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: { resetWorkspace: false },
    });

    expect(response.statusCode).toBe(200);
    expect(restoredSource).toBe(acceptedSource);
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({ resetWorkspace: false }),
    );
  });

  it("marks the run as failed when execution throws", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = async () => {
      throw new Error("agent failed");
    };

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(500);
    expect(executeResponse.json()).toEqual({
      error: "Run execution failed",
      message: "agent failed",
    });

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    const failedRunResponse = getResponse.json();

    expect(failedRunResponse.run).toEqual({
      ...createdRun,
      status: "failed",
      errorMessage: "agent failed",
    });
    expect(failedRunResponse.versions).toEqual([]);
    expect(failedRunResponse.result.review).toMatchObject({
      accepted: false,
      reason: "agent failed",
    });
  });
  it("passes maxRepairAttempts from the request body to the executor", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: {
      goal: string;
      workspaceRoot: string;
      maxRepairAttempts?: number;
      resetWorkspace?: boolean;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: CHANGED_AGENT_STEPS,
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [],
      },
      review: {
        accepted: true,
        reason: "ok",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    }));

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task app",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: {
        maxRepairAttempts: 2,
        resetWorkspace: false,
      },
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith({
      goal: createdRun.goal,
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      maxRepairAttempts: 2,
      resetWorkspace: true,
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    });
  });

  it("passes long-term memory summaries to the executor", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();

    memoryRepository.saveSummary({
      id: "summary-1",
      content: [
        "Long-term lessons:",
        "- Prefer Chinese UI copy when the goal is written in Chinese.",
      ].join("\n"),
      sourceMemoryIds: ["memory-1"],
      createdAt: "2026-07-08T00:00:00.000Z",
    });

    const executeRun = vi.fn(async (input: {
      goal: string;
      workspaceRoot: string;
      memoryContext?: string;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: CHANGED_AGENT_STEPS,
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [],
      },
      review: {
        accepted: true,
        reason: "ok",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    }));

    const app = buildApp(
        undefined,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a Chinese landing page",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith({
      goal: createdRun.goal,
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      memoryContext: [
        "Long-term memory:",
        "Long-term lessons:",
        "- Prefer Chinese UI copy when the goal is written in Chinese.",
      ].join("\n"),
      resetWorkspace: true,
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    });
  });

  it("passes only relevant memory entries to the executor", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();

    memoryRepository.save({
      id: "memory-task",
      runId: "run-task",
      goal: "Create a task app",
      outcome: "succeeded",
      summary: "Generated a task list with input and add button.",
      createdAt: "2026-07-08T00:00:00.000Z",
    });
    memoryRepository.save({
      id: "memory-wenzhou",
      runId: "run-wenzhou",
      goal: "Create a Chinese Wenzhou landing page",
      outcome: "succeeded",
      summary: "Generated Chinese copy for food, attractions, and transportation.",
      createdAt: "2026-07-08T01:00:00.000Z",
    });

    const executeRun = vi.fn(async (input: {
      goal: string;
      workspaceRoot: string;
      memoryContext?: string;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [],
      },
      review: {
        accepted: true,
        reason: "ok",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    }));

    const app = buildApp(
        undefined,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Build a Chinese Wenzhou travel page",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);
    const executeInput = executeRun.mock.calls[0]?.[0];

    expect(executeInput?.memoryContext).toContain(
        "Create a Chinese Wenzhou landing page",
    );
    expect(executeInput?.memoryContext).not.toContain("Create a task app");
  });

  it("stores a memory entry after executing a run", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();
    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [
          {
            name: "has input",
            passed: true,
          },
          {
            name: "has button",
            passed: true,
          },
        ],
      },
      review: {
        accepted: true,
        reason: "Agent finished and install/build/eval passed.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    });

    const app = buildApp(
        undefined,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task app",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const memoryResponse = await app.inject({
      method: "GET",
      url: "/memory",
    });

    expect(memoryResponse.statusCode).toBe(200);
    expect(memoryResponse.json()).toEqual({
      memories: [
        {
          id: expect.any(String),
          runId: createdRun.id,
          goal: "Create a task app",
          outcome: "succeeded",
          summary:
              "Review: Agent finished and install/build/eval passed. Attempts: 0 Eval: 2/2 checks passed Build exit code: 0",
          createdAt: expect.any(String),
        },
      ],
    });
  });

  it("compacts memory after the threshold is reached", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();

    for (let index = 1; index <= 9; index += 1) {
      memoryRepository.save({
        id: `memory-${index}`,
        runId: `run-${index}`,
        goal: `Create app ${index}`,
        outcome: "succeeded",
        summary: "Previous run succeeded.",
        createdAt: "2026-07-07T00:00:00.000Z",
      });
    }

    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [
          {
            name: "has input",
            passed: true,
          },
        ],
      },
      review: {
        accepted: true,
        reason: "Agent finished and install/build/eval passed.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    });

    const app = buildApp(
        undefined,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task app",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const summaries = await memoryRepository.listSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      id: expect.any(String),
      content: expect.stringContaining("- Source memories: 10"),
      sourceMemoryIds: expect.arrayContaining(["memory-1", "memory-9"]),
      createdAt: expect.any(String),
    });
    expect(summaries[0]?.sourceMemoryIds).toHaveLength(10);
  });
});
describe("POST /runs/:id/approve", () => {
  it("approves a run that is waiting for human review", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = async (input: {
      goal: string;
      workspaceRoot: string;
    }) => ({
      workspaceRoot: input.workspaceRoot,
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: false,
        checks: [
          {
            name: "matches requested language",
            passed: false,
          },
        ],
      },
      review: {
        accepted: false,
        reason: "Generated UI did not match the requested language.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: false,
        },
      },
      attempts: [],
    });

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "我想要一个介绍温州的页面",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const approveResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/approve`,
    });

    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json()).toEqual({
      run: {
        ...createdRun,
        status: "succeeded",
      },
      versions: [
        expect.objectContaining({
          runId: createdRun.id,
          versionNumber: 1,
          summary: "Human-approved version 1",
          review: expect.objectContaining({ accepted: true }),
        }),
      ],
    });
  });

  it("returns 404 when approving a missing run", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/runs/missing-run/approve",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });

  it("rejects approval when the run is not waiting for human review", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const approveResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/approve`,
    });

    expect(approveResponse.statusCode).toBe(409);
    expect(approveResponse.json()).toEqual({
      error: "Run is not waiting for human review",
    });
  });
});
describe("POST /runs/:id/request-repair", () => {
  it("requests another repair for a run waiting for human review", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = vi
        .fn()
        .mockImplementationOnce(async (input: { workspaceRoot: string }) => {
          await writeWorkspaceFile(
              input.workspaceRoot,
              "src/App.tsx",
              "export function InitialRejectedDraft() { return null; }",
          );

          return {
          workspaceRoot: "",
          coordination: TEST_COORDINATION,
          agent: {
            finished: true,
            steps: [],
          },
          install: {
            exitCode: 0,
            stdout: "install ok",
            stderr: "",
          },
          build: {
            exitCode: 0,
            stdout: "build ok",
            stderr: "",
          },
          eval: {
            passed: false,
            checks: [
              {
                name: "matches requested language",
                passed: false,
              },
            ],
          },
          review: {
            accepted: false,
            reason: "Generated UI did not match the requested language.",
            checks: {
              agentFinished: true,
              installPassed: true,
              buildPassed: true,
              evalPassed: false,
            },
          },
          attempts: [],
        };
        })
        .mockImplementationOnce(async (input: { workspaceRoot: string }) => {
          await writeWorkspaceFile(
              input.workspaceRoot,
              "src/App.tsx",
              "export function RepairedDraft() { return null; }",
          );

          return {
          workspaceRoot: "",
          coordination: TEST_COORDINATION,
          agent: {
            finished: true,
            steps: [],
          },
          install: {
            exitCode: 0,
            stdout: "install ok",
            stderr: "",
          },
          build: {
            exitCode: 0,
            stdout: "build ok",
            stderr: "",
          },
          eval: {
            passed: true,
            checks: [
              {
                name: "matches requested language",
                passed: true,
              },
            ],
          },
          review: {
            accepted: true,
            reason: "Human feedback was applied.",
            checks: {
              agentFinished: true,
              installPassed: true,
              buildPassed: true,
              evalPassed: true,
            },
          },
          attempts: [],
        };
        });

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "我想要一个介绍温州的页面",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: {
        feedback: "请改成中文，并增加温州美食、景点和交通信息。",
      },
    });

    expect(repairResponse.statusCode).toBe(200);
    expect(repairResponse.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
        summary: "Repair version 1",
        goal: "请改成中文，并增加温州美食、景点和交通信息。",
      }),
    ]);
    expect(repairResponse.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });
    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(executeRun).toHaveBeenLastCalledWith(
        expect.objectContaining({
          goal: expect.stringContaining(
            "Newest human feedback to apply now:",
          ),
          currentRequest:
            "请改成中文，并增加温州美食、景点和交通信息。",
          workspaceRoot: workspaceManager.resolve(createdRun.id),
          resetWorkspace: true,
          memoryContext: expect.stringContaining("Recent memory:"),
        }),
    );
  });
  it("includes the pending rejected request when asking for human repair", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-pending-repair-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) =>
      createSuccessfulAgentResult(input.workspaceRoot),
    );
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "我希望图片是 Apex 里面的图片",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "我想要一个介绍 Apex Legends 的网站",
    });

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: {
        feedback: "不要自然生成图片，要更像游戏官网",
      },
    });

    expect(repairResponse.statusCode).toBe(200);
    const repairGoal =
      (executeRun.mock.calls[0]?.[0] as { goal?: string } | undefined)?.goal ??
      "";
    expect(repairGoal).toContain("Continuation repair request:");
    expect(repairGoal).toContain(
      "Apply the newest human feedback below as the highest-priority required change.",
    );
    expect(repairGoal).toContain(
      "Previous human-review context, keep only if still relevant:",
    );
    expect(repairGoal).toContain("Newest human feedback to apply now:");
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.stringContaining(
          "Previous human-review context, keep only if still relevant:",
        ),
      }),
    );
  });
  it("keeps a rejected repair draft when no runnable baseline exists", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-visible-repair-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        "export function RejectedButChangedDraft() { return null; }",
      );

      return {
        ...createSuccessfulAgentResult(input.workspaceRoot),
        review: {
          accepted: false,
          reason: "Reviewer still wants changes.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
            browserPassed: true,
          },
        },
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create an Apex themed page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "Use Apex artwork instead of generic generated art",
    });
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "version-1",
      goal: "Build an Apex Legends landing page",
      summary: "Initial version",
      createdAt: "2026-07-13T00:00:00.000Z",
    });

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: {
        feedback: "The page should look more like the official game site",
      },
    });

    expect(repairResponse.statusCode).toBe(200);
    expect(repairResponse.json().run).toEqual({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "The page should look more like the official game site",
    });
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toContain("RejectedButChangedDraft");
    const repairGoal =
      (executeRun.mock.calls[0]?.[0] as { goal?: string } | undefined)?.goal ??
      "";
    expect(repairGoal).toContain("Newest human feedback to apply now:");
    expect(repairGoal).not.toContain(
      "Previous human-review context, keep only if still relevant:\nBuild an Apex Legends landing page",
    );
    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: expect.stringContaining(
          "The page should look more like the official game site",
        ),
      }),
    );
  });
  it("marks repair as failed when it does not produce a new draft", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-unchanged-repair-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => ({
      ...createSuccessfulAgentResult(input.workspaceRoot),
      review: {
        accepted: false,
        reason: "Reviewer still wants changes.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
          browserPassed: true,
        },
      },
    }));
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create an Apex themed page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const stableSource = "export function StableApp() {}";

    await writeWorkspaceFile(
      workspaceManager.resolve(createdRun.id),
      "src/App.tsx",
      stableSource,
    );
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
      snapshotId: "version-1",
    });
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "version-1",
      goal: createdRun.goal,
      summary: "Initial version",
      createdAt: "2026-07-13T00:00:00.000Z",
    });
    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
      operationPrompt: "Use real Apex artwork",
    });

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: {
        feedback: "Use real Apex artwork instead of generated art",
      },
    });

    expect(repairResponse.statusCode).toBe(200);
    expect(repairResponse.json().run).toEqual(
      expect.objectContaining({
        status: "failed",
        operationPrompt: "Use real Apex artwork instead of generated art",
        errorMessage:
          "No new draft was produced because the workspace did not change after the repair feedback.",
      }),
    );
    expect(repairResponse.json().result.review).toEqual(
      expect.objectContaining({
        accepted: false,
        reason:
          "No new draft was produced because the workspace did not change after the repair feedback.",
      }),
    );
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toBe(stableSource);
  });
  it("passes relevant memory to repair execution", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const memoryRepository = new MemoryRepository();
    memoryRepository.save({
      id: "memory-wenzhou",
      runId: "old-run",
      goal: "Create a Chinese Wenzhou travel page",
      outcome: "succeeded",
      summary: "Use Chinese copy for Wenzhou food, attractions, and transport.",
      createdAt: "2026-07-08T00:00:00.000Z",
    });

    const executeRun = vi.fn(async (input: {
      goal: string;
      workspaceRoot: string;
      memoryContext?: string;
    }) => createSuccessfulAgentResult(input.workspaceRoot));

    const app = buildApp(
        runRepository,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a Wenzhou page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await runRepository.save({
      ...createdRun,
      status: "waiting_for_human",
    });

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: {
        feedback: "Please improve Wenzhou attractions and food sections.",
      },
    });

    expect(repairResponse.statusCode).toBe(200);
    const repairInput = executeRun.mock.calls[0]?.[0];
    expect(repairInput?.memoryContext).toContain(
        "Create a Chinese Wenzhou travel page",
    );
    expect(repairInput?.memoryContext).toContain("Wenzhou food");
  });
});
describe("POST /runs/:id/iterate", () => {
  it("rejects normal iteration while the run is waiting for human review", async () => {
    const runRepository = new RunRepository();
    const executeRun = vi.fn().mockResolvedValue({
      workspaceRoot: "",
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: false,
        checks: [
          {
            name: "matches requested change",
            passed: false,
          },
        ],
      },
      review: {
        accepted: false,
        reason: "Needs human feedback.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: false,
        },
      },
      attempts: [],
    });
    const app = buildApp(runRepository, undefined, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add another feature",
      },
    });

    expect(iterateResponse.statusCode).toBe(409);
    expect(iterateResponse.json()).toEqual({
      error: "Run is waiting for human review. Approve it or use request-repair.",
    });
  });

  it("iterates an existing run and stores a new version", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function NewApp() {}",
      );

      return {
        workspaceRoot: "",
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches goal",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Iteration request was applied.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add dark mode",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
        summary: "Iteration version 1",
        review: expect.objectContaining({
          accepted: true,
          reason: "Iteration request was applied.",
        }),
      }),
    ]);
    expect(executeRun).toHaveBeenCalledWith({
      goal: expect.stringContaining("Create a task application"),
      currentRequest: "Add dark mode",
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      resetWorkspace: true,
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    });
  });

  it("treats edit_file actions as workspace changes during iteration", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function App() { return <main id=\"home\"><button type=\"button\" onClick={() => document.getElementById(\"about\")?.scrollIntoView()}>About</button><h1 id=\"about\">About</h1><p>Updated page.</p></main>; }",
      );

      return {
        ...createSuccessfulAgentResult(input.workspaceRoot),
        agent: {
          finished: true,
          steps: [
            {
              action: {
                type: "edit_file" as const,
                path: "src/App.tsx",
                oldText: "<button>About</button>",
                newText:
                    "<button type=\"button\" onClick={() => document.getElementById(\"about\")?.scrollIntoView()}>About</button>",
              },
              execution: {
                ok: true,
                message: "Edited file: src/App.tsx",
              },
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Navigation buttons were connected.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
      };
    });

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a multi-page app",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Make nav buttons jump to matching sections",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run.status).toBe("succeeded");
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
        summary: "Iteration version 1",
      }),
    ]);
  });

  it("treats append_file actions as workspace changes during iteration", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/content.ts",
          "export const sections = ['Overview'];\n",
      );

      return {
        ...createSuccessfulAgentResult(input.workspaceRoot),
        agent: {
          finished: true,
          steps: [
            {
              action: {
                type: "append_file" as const,
                path: "src/content.ts",
                content: "export const moreSections = ['Research'];\n",
              },
              execution: {
                ok: true,
                message: "Appended file: src/content.ts",
              },
            },
          ],
        },
      };
    });

    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a complex homepage",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a research section",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run.status).toBe("succeeded");
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
        summary: "Iteration version 1",
      }),
    ]);
  });

  it("passes relevant memory to iteration execution", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const memoryRepository = new MemoryRepository();
    memoryRepository.save({
      id: "memory-task",
      runId: "old-task-run",
      goal: "Create a React task app with countdown",
      outcome: "succeeded",
      summary: "Use visible Chinese buttons for complete and delete actions.",
      createdAt: "2026-07-08T00:00:00.000Z",
    });

    const executeRun = vi.fn(async (input: {
      goal: string;
      workspaceRoot: string;
      memoryContext?: string;
    }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function App() { return null; }",
      );

      return createSuccessfulAgentResult(input.workspaceRoot);
    });

    const app = buildApp(
        undefined,
        workspaceManager,
        executeRun,
        undefined,
        memoryRepository,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task app",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add countdown and completion buttons",
      },
    });

    expect(iterateResponse.statusCode).toBe(200);
    const iterateInput = executeRun.mock.calls[0]?.[0];
    expect(iterateInput?.memoryContext).toContain(
        "Create a React task app with countdown",
    );
    expect(iterateInput?.memoryContext).toContain("complete and delete");
  });

  it("resets the workspace for explicit regeneration iteration prompts", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function NewApp() {}",
      );

      return createSuccessfulAgentResult(input.workspaceRoot);
    });
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a Tsinghua homepage",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "你重新给我生成清华的界面吧",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith({
      goal: expect.stringContaining("Create a Tsinghua homepage"),
      currentRequest: "你重新给我生成清华的界面吧",
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      resetWorkspace: true,
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    });
  });

  it("keeps the latest iteration prompt when review rejects the result", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn().mockResolvedValue({
      workspaceRoot: "",
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: false,
        checks: [
          {
            name: "matches requested change",
            passed: false,
          },
        ],
      },
      review: {
        accepted: false,
        reason: "The requested change was not visible.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: false,
        },
      },
      attempts: [],
    });
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Make the button red",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "failed",
      operationPrompt: "Make the button red",
      errorMessage:
          "Iteration did not change the workspace. The agent returned without writing files or assets for the requested update.",
    });
  });

  it("does not save a new version when an iteration makes no workspace changes", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn().mockResolvedValue({
      workspaceRoot: "",
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [
          {
            name: "matches goal",
            passed: true,
          },
        ],
      },
      review: {
        accepted: true,
        reason: "The app already satisfies the request.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    });
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a visible countdown",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      run: {
        ...createdRun,
        status: "failed",
        operationPrompt: "Add a visible countdown",
        errorMessage:
            "Iteration did not change the workspace. The agent returned without writing files or assets for the requested update.",
      },
      result: expect.objectContaining({
        review: expect.objectContaining({
          accepted: false,
          reason:
              "Iteration did not change the workspace. The agent returned without writing files or assets for the requested update.",
        }),
      }),
      versions: [],
    });
  });

  it("does not save a new version when generated files match the latest version", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function StableApp() {}",
      );

      return {
        workspaceRoot: "",
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches goal",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Iteration request was applied.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        "export function StableApp() {}",
    );
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Make the app visibly different",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      run: {
        ...createdRun,
        status: "failed",
        operationPrompt: "Make the app visibly different",
        errorMessage:
            "Iteration did not change the workspace compared with the latest saved version.",
      },
      result: expect.objectContaining({
        review: expect.objectContaining({
          accepted: false,
          reason:
              "Iteration did not change the workspace compared with the latest saved version.",
        }),
      }),
      versions: [
        expect.objectContaining({
          runId: createdRun.id,
          versionNumber: 1,
        }),
      ],
    });
  });

  it("does not save a new version when only unused assets change", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          'export function StableApp() { return <img src="/assets/hero.jpg" alt="Hero" />; }',
      );
      await writeWorkspaceFile(
          input.workspaceRoot,
          "public/assets/unused.jpg",
          "new unused image bytes",
      );

      return {
        workspaceRoot: input.workspaceRoot,
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches requested change",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Iteration request was applied.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create an image-based landing page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        'export function StableApp() { return <img src="/assets/hero.jpg" alt="Hero" />; }',
    );
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "public/assets/hero.jpg",
        "original hero image bytes",
    );
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Change the page visually",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "failed",
      operationPrompt: "Change the page visually",
      errorMessage:
          "Iteration did not change the workspace compared with the latest saved version.",
    });
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
      }),
    ]);
  });

  it("saves a new version when a referenced asset changes", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          'export function StableApp() { return <img src="/assets/hero.jpg" alt="Hero" />; }',
      );
      await writeWorkspaceFile(
          input.workspaceRoot,
          "public/assets/hero.jpg",
          "updated hero image bytes",
      );

      return {
        workspaceRoot: input.workspaceRoot,
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches requested change",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Iteration request was applied.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create an image-based landing page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        'export function StableApp() { return <img src="/assets/hero.jpg" alt="Hero" />; }',
    );
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "public/assets/hero.jpg",
        "original hero image bytes",
    );
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Replace the hero image",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run.status).toBe("succeeded");
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
      }),
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 2,
        goal: "Replace the hero image",
      }),
    ]);
  });

  it("marks a rejected iteration as failed when files still match the latest version", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function StableApp() {}",
      );

      return {
        workspaceRoot: input.workspaceRoot,
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches requested change",
              passed: true,
            },
          ],
        },
        review: {
          accepted: false,
          reason: "Reviewer did not find the requested change.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        "export function StableApp() {}",
    );
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Use Apex artwork",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual({
      ...createdRun,
      status: "failed",
      operationPrompt: "Use Apex artwork",
      errorMessage:
          "Iteration did not change the workspace compared with the latest saved version.",
    });
    expect(response.json().result.review).toEqual(
        expect.objectContaining({
          accepted: false,
          reason:
              "Iteration did not change the workspace compared with the latest saved version.",
        }),
    );
  });

  it("restores the accepted workspace when an iteration fails to build", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const stableSource = "export function App() { return <main>Stable version</main>; }";
    const brokenSource = "export function App() { return <main><section></main>; }";
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          brokenSource,
      );

      return {
        workspaceRoot: input.workspaceRoot,
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 1,
          stdout: "",
          stderr: "Expected \">\" but found \"<\"",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "has readable text",
              passed: true,
            },
          ],
        },
        review: {
          accepted: false,
          reason: "Rejected because npm build failed.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: false,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a university homepage",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await writeRunnableWorkspace(
        workspaceManager.resolve(createdRun.id),
        stableSource,
    );
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "version-1",
      goal: createdRun.goal,
      summary: "Stable version",
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
      snapshotId: "version-1",
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "左上角需要一个logo",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().run).toEqual(
      expect.objectContaining({
        ...createdRun,
        status: "failed",
        operationPrompt: "左上角需要一个logo",
        errorMessage: expect.stringContaining(
          "rolled back to the complete runnable baseline",
        ),
      }),
    );
    expect(response.json().result.review).toEqual(
        expect.objectContaining({
          accepted: false,
          reason: "Rejected because npm build failed.",
        }),
    );
    await expect(
        readWorkspaceFile(
            workspaceManager.resolve(createdRun.id),
            "src/App.tsx",
        ),
    ).resolves.toBe(stableSource);
  });

  it("preserves an existing generated result as v1 before iterating old runs", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function NewApp() {}",
      );

      return {
        workspaceRoot: "",
        coordination: TEST_COORDINATION,
        agent: {
          finished: true,
          steps: CHANGED_AGENT_STEPS,
        },
        install: {
          exitCode: 0,
          stdout: "install ok",
          stderr: "",
        },
        build: {
          exitCode: 0,
          stdout: "build ok",
          stderr: "",
        },
        eval: {
          passed: true,
          checks: [
            {
              name: "matches goal",
              passed: true,
            },
          ],
        },
        review: {
          accepted: true,
          reason: "Iteration request was applied.",
          checks: {
            agentFinished: true,
            installPassed: true,
            buildPassed: true,
            evalPassed: true,
          },
        },
        attempts: [],
      };
    });

    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        "export function OldApp() {}",
    );

    await runRepository.saveResult(createdRun.id, {
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "install ok",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "build ok",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [
          {
            name: "matches goal",
            passed: true,
          },
        ],
      },
      review: {
        accepted: true,
        reason: "Initial result existed before version history.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add dark mode",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().versions).toEqual([
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 1,
        summary: "Initial generated version",
      }),
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 2,
        summary: "Iteration version 2",
      }),
    ]);
  });

  it("rolls back the current draft and keeps the prompt when iteration fails", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    let callCount = 0;
    const executeRun = vi.fn(async (input: {
      workspaceRoot: string;
    }) => {
      callCount += 1;

      if (callCount === 1) {
        return createSuccessfulAgentResult(input.workspaceRoot);
      }

      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function BrokenApp() {}",
      );
      throw new Error("Model request timed out after 90000ms");
    });
    const app = buildApp(undefined, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    await writeRunnableWorkspace(
        workspaceManager.resolve(createdRun.id),
        "export function StableApp() {}",
    );

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });

    expect(executeResponse.statusCode).toBe(200);

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a timer",
      },
    });

    expect(iterateResponse.statusCode).toBe(500);
    await expect(
        readWorkspaceFile(
            workspaceManager.resolve(createdRun.id),
            "src/App.tsx",
        ),
    ).resolves.toBe("export function StableApp() {}");

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.json()).toEqual(
        expect.objectContaining({
          run: expect.objectContaining({
            status: "failed",
            operationPrompt: "Add a timer",
            errorMessage:
              "Model request timed out after 90000ms. No new draft was produced because the workspace still matches the latest saved version.",
          }),
          versions: [
            expect.objectContaining({
              versionNumber: 1,
            }),
          ],
        }),
    );
  });

  it("rolls back a timed-out iteration to the accepted workspace", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async (input: {
      workspaceRoot: string;
    }) => {
      await writeWorkspaceFile(
          input.workspaceRoot,
          "src/App.tsx",
          "export function BrokenDraft() {}",
      );
      throw new Error("Model request timed out after 90000ms");
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await writeRunnableWorkspace(
        workspaceManager.resolve(createdRun.id),
        "export function StableApp() {}",
    );
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });
    runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-12T00:00:00.000Z",
    });

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a logo",
      },
    });

    expect(iterateResponse.statusCode).toBe(500);

    await expect(
        readWorkspaceFile(
            workspaceManager.resolve(createdRun.id),
            "src/App.tsx",
        ),
    ).resolves.toBe("export function StableApp() {}");

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.json().run).toEqual(
        expect.objectContaining({
          status: "failed",
          operationPrompt: "Add a logo",
          errorMessage:
            "Model request timed out after 90000ms. No new draft was produced because the workspace still matches the latest saved version.",
        }),
    );
  });

  it("marks a timed-out iteration as failed when no new draft was produced", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const executeRun = vi.fn(async () => {
      throw new Error("Model request timed out after 90000ms");
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const stableSource = "export function StableApp() {}";

    await writeWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
        stableSource,
    );
    await saveRunVersionSnapshot({
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      versionNumber: 1,
    });
    runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: createdRun.goal,
      summary: "Initial generated version",
      createdAt: "2026-07-12T00:00:00.000Z",
    });

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "Add a logo",
      },
    });

    expect(iterateResponse.statusCode).toBe(500);
    await expect(
        readWorkspaceFile(
            workspaceManager.resolve(createdRun.id),
            "src/App.tsx",
        ),
    ).resolves.toBe(stableSource);

    const getResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });

    expect(getResponse.json().run).toEqual({
      ...createdRun,
      status: "failed",
      operationPrompt: "Add a logo",
      errorMessage:
          "Model request timed out after 90000ms. No new draft was produced because the workspace still matches the latest saved version.",
    });
  });

  it("rejects an empty iteration prompt", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: {
        prompt: "   ",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid iterate run input",
    });
  });
});

describe("validated result preservation when version publication fails", () => {
  function failNextSnapshotPublication(): void {
    vi.mocked(saveRunVersionSnapshot).mockRejectedValueOnce(
      Object.assign(
        new Error("EPERM: operation not permitted, rename snapshot"),
        { code: "EPERM" },
      ),
    );
  }

  function createChangedValidatedResult(workspaceRoot: string) {
    return {
      ...createSuccessfulAgentResult(workspaceRoot),
      agent: {
        finished: true,
        steps: CHANGED_AGENT_STEPS,
      },
    };
  }

  function expectValidatedResultWasPreserved(detail: {
    run: Record<string, unknown>;
    result: RunReactAppAgentResult;
    versions: unknown[];
  }): void {
    expect(detail.run).toEqual(
      expect.objectContaining({
        status: "waiting_for_human",
        errorMessage: expect.stringContaining(
          "Generation completed and passed validation, but the version could not be saved.",
        ),
      }),
    );
    expect(detail.run).not.toHaveProperty("operation");
    expect(detail.run).not.toHaveProperty("operationId");
    expect(detail.run).not.toHaveProperty("operationStage");
    expect(detail.run).not.toHaveProperty("operationStartedAt");
    expect(detail.run).not.toHaveProperty("operationUpdatedAt");
    expect(detail.versions).toEqual([]);
    expect(detail.result.agent.steps).toEqual(CHANGED_AGENT_STEPS);
    expect(detail.result.agent.stopReason).not.toBe("action_failed");
    expect(detail.result.build).toEqual(
      expect.objectContaining({
        exitCode: 0,
        stdout: "build ok",
      }),
    );
    expect(detail.result.browserEval).toEqual(
      expect.objectContaining({
        passed: true,
      }),
    );
    expect(detail.result.review).toEqual(
      expect.objectContaining({
        accepted: true,
      }),
    );
  }

  it("keeps the validated initial-generation result when its snapshot cannot be published", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-version-save-initial-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const generatedSource =
      "export function GeneratedPage() { return <main>Generated page</main>; }";
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        generatedSource,
      );
      return createChangedValidatedResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complete routed product page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    failNextSnapshotPublication();

    const executeResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
    });
    expect(executeResponse.statusCode).toBe(500);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expectValidatedResultWasPreserved(detailResponse.json());
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toBe(generatedSource);
  });

  it("keeps the validated repair result when its snapshot cannot be published", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-version-save-repair-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const repairedSource =
      "export function RepairedPage() { return <main>Repaired page</main>; }";
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        repairedSource,
      );
      return createChangedValidatedResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complex product page" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const workspaceRoot = workspaceManager.resolve(createdRun.id);
    await writeRunnableWorkspace(
      workspaceRoot,
      "export function RejectedDraft() { return <main>Draft</main>; }",
    );
    const waitingRun = await runRepository.findById(createdRun.id);
    expect(waitingRun).toBeDefined();
    waitingRun!.status = "waiting_for_human";
    waitingRun!.operationPrompt = "Keep the existing product structure";
    await runRepository.save(waitingRun!);
    await runRepository.saveResult(createdRun.id, {
      ...createSuccessfulAgentResult(workspaceRoot),
      review: {
        accepted: false,
        reason: "The draft still needs repair.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: false,
          browserPassed: true,
        },
      },
    });
    failNextSnapshotPublication();

    const repairResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/request-repair`,
      payload: { feedback: "Complete all routes and navigation states" },
    });
    expect(repairResponse.statusCode).toBe(500);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    const detail = detailResponse.json();
    expectValidatedResultWasPreserved(detail);
    expect(detail.run.operationPrompt).toBe(
      "Complete all routes and navigation states",
    );
    await expect(readWorkspaceFile(workspaceRoot, "src/App.tsx")).resolves.toBe(
      repairedSource,
    );
  });

  it("keeps the validated iteration result when its snapshot cannot be published", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-version-save-iteration-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const runRepository = new RunRepository();
    const iteratedSource =
      "export function IteratedPage() { return <main>All routes work</main>; }";
    const executeRun = vi.fn(async (input: { workspaceRoot: string }) => {
      await writeWorkspaceFile(
        input.workspaceRoot,
        "src/App.tsx",
        iteratedSource,
      );
      return createChangedValidatedResult(input.workspaceRoot);
    });
    const app = buildApp(runRepository, workspaceManager, executeRun);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a complete multi-page application" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    failNextSnapshotPublication();

    const iterateResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/iterate`,
      payload: { prompt: "Add working navigation for every page" },
    });
    expect(iterateResponse.statusCode).toBe(500);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}`,
    });
    const detail = detailResponse.json();
    expectValidatedResultWasPreserved(detail);
    expect(detail.run.operationPrompt).toBe(
      "Add working navigation for every page",
    );
    await expect(
      readWorkspaceFile(
        workspaceManager.resolve(createdRun.id),
        "src/App.tsx",
      ),
    ).resolves.toBe(iteratedSource);
  });
});

describe("POST /runs/:id/preview", () => {
  it("creates a preview session for an existing run", async () => {
    const previewManager = new PreviewManager(
      vi.fn(() => ({
        unref: vi.fn(),
      })),
      vi.fn(async () => true),
      vi.fn(async () => undefined),
    );
    const { app, workspaceManager } = await buildTestApp(previewManager);

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      preview: {
        runId: createdRun.id,
        workspaceRoot: workspaceManager.resolve(createdRun.id),
        port: 5174,
        url: "http://127.0.0.1:5174",
      },
      browserEval: {
        passed: true,
        checks: [],
      },
    });
  });

  it("evaluates the current workspace against the latest saved version goal", async () => {
    const previewManager = new PreviewManager(
      vi.fn(() => ({
        unref: vi.fn(),
      })),
      vi.fn(async () => true),
      vi.fn(async () => undefined),
    );
    const evaluate = vi.fn(async () => ({
      passed: true,
      checks: [],
    }));
    const { app, runRepository } = await buildTestApp(previewManager, {
      evaluate,
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a single landing page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Create a single landing page",
      summary: "Version 1",
      createdAt: new Date().toISOString(),
    });
    await runRepository.saveVersion({
      id: "version-2",
      runId: createdRun.id,
      versionNumber: 2,
      goal: "Add independent About and News pages with working navigation",
      summary: "Version 2",
      createdAt: new Date().toISOString(),
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(evaluate).toHaveBeenCalledWith({
      url: "http://127.0.0.1:5174",
      goal: expect.stringContaining(
        "Add independent About and News pages with working navigation",
      ),
    });
  });

  it("prefers a pending operation prompt for the current workspace preview", async () => {
    const previewManager = new PreviewManager(
      vi.fn(() => ({
        unref: vi.fn(),
      })),
      vi.fn(async () => true),
      vi.fn(async () => undefined),
    );
    const evaluate = vi.fn(async () => ({
      passed: true,
      checks: [],
    }));
    const { app, runRepository } = await buildTestApp(previewManager, {
      evaluate,
    });
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a single landing page",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      goal: "Add independent About and News pages",
      summary: "Version 1",
      createdAt: new Date().toISOString(),
    });
    createdRun.status = "waiting_for_human";
    createdRun.operationPrompt =
      "Make every News card navigate to its own detail page";
    await runRepository.save(createdRun);

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(evaluate).toHaveBeenCalledWith({
      url: "http://127.0.0.1:5174",
      goal: expect.stringContaining(
        "Make every News card navigate to its own detail page",
      ),
    });
  });

  it("creates a preview session for a version snapshot", async () => {
    const startPreview = vi.fn(() => ({
      unref: vi.fn(),
    }));
    const evaluate = vi.fn(async () => ({
      passed: true,
      checks: [],
    }));

    const previewManager = new PreviewManager(
        startPreview,
        vi.fn(async () => true),
        vi.fn(async () => undefined),
    );

    const { app, workspaceManager, runRepository } =
        await buildTestApp(previewManager, { evaluate });

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());
    const snapshotRoot = path.join(
      workspaceManager.resolve(createdRun.id),
      "versions",
      "snapshot-1",
    );
    await mkdir(snapshotRoot, { recursive: true });
    await runRepository.saveVersion({
      id: "version-1",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "snapshot-1",
      goal: "Version one has working independent page navigation",
      summary: "Version 1",
      createdAt: new Date().toISOString(),
    });
    await runRepository.saveVersion({
      id: "version-2",
      runId: createdRun.id,
      versionNumber: 2,
      snapshotId: "snapshot-2",
      goal: "Version two changes the navigation again",
      summary: "Version 2",
      createdAt: new Date().toISOString(),
    });
    createdRun.status = "waiting_for_human";
    createdRun.operationPrompt = "Pending unsaved navigation request";
    await runRepository.save(createdRun);

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
      payload: {
        versionNumber: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(startPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceRoot: path.join(
              workspaceManager.resolve(createdRun.id),
              "versions",
              "snapshot-1",
          ),
          port: expect.any(Number),
        }),
    );
    expect(evaluate).toHaveBeenCalledWith({
      url: "http://127.0.0.1:5174",
      goal: "Version one has working independent page navigation",
    });
  });

  it("rejects a stale version before spawning a preview process", async () => {
    const startPreview = vi.fn(() => ({
      unref: vi.fn(),
    }));
    const previewManager = new PreviewManager(
      startPreview,
      vi.fn(async () => true),
      vi.fn(async () => undefined),
    );
    const { app } = await buildTestApp(previewManager);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
      payload: {
        versionNumber: 99,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Version not found",
    });
    expect(startPreview).not.toHaveBeenCalled();
  });

  it("rejects a version whose snapshot directory is missing", async () => {
    const startPreview = vi.fn(() => ({
      unref: vi.fn(),
    }));
    const previewManager = new PreviewManager(
      startPreview,
      vi.fn(async () => true),
      vi.fn(async () => undefined),
    );
    const { app, runRepository } = await buildTestApp(previewManager);
    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    await runRepository.saveVersion({
      id: "missing-version",
      runId: createdRun.id,
      versionNumber: 1,
      snapshotId: "missing-snapshot",
      goal: createdRun.goal,
      summary: "Missing snapshot",
      createdAt: new Date().toISOString(),
    });

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
      payload: {
        versionNumber: 1,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Version snapshot not found",
    });
    expect(startPreview).not.toHaveBeenCalled();
  });

  it("returns preview browser eval without overwriting execution evidence", async () => {
    const previewManager = new PreviewManager(
        vi.fn(() => ({
          unref: vi.fn(),
        })),
        vi.fn(async () => true),
        vi.fn(async () => undefined),
    );
    const runRepository = new RunRepository();
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const browserEvaluator = new FakeBrowserEvaluator({
      passed: false,
      checks: [
        {
          name: "adds a task item",
          passed: false,
          message: "Task item was not rendered.",
        },
      ],
    });
    const app = buildApp(
        runRepository,
        workspaceManager,
        undefined,
        previewManager,
        undefined,
        browserEvaluator,
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const executionResult = {
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      operationId: "completed-execution",
      coordination: TEST_COORDINATION,
      agent: {
        finished: true,
        steps: [],
      },
      install: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      build: {
        exitCode: 0,
        stdout: "",
        stderr: "",
      },
      eval: {
        passed: true,
        checks: [],
      },
      browserEval: {
        passed: true,
        checks: [
          {
            name: "original execution browser check",
            passed: true,
          },
        ],
      },
      review: {
        accepted: true,
        reason: "ok",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
      trace: [
        {
          id: "execution-review",
          label: "Execution review",
          status: "succeeded" as const,
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      ],
    };
    await runRepository.saveResult(createdRun.id, executionResult);

    const response = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      preview: {
        runId: createdRun.id,
        workspaceRoot: workspaceManager.resolve(createdRun.id),
        port: 5174,
        url: "http://127.0.0.1:5174",
      },
      browserEval: {
        passed: false,
        checks: [
          {
            name: "adds a task item",
            passed: false,
            message: "Task item was not rendered.",
          },
        ],
      },
    });
    const storedResult = runRepository.findResultByRunId(createdRun.id);

    expect(storedResult).toEqual(executionResult);
  });
});
describe("GET /runs/:id/coordination", () => {
  it("returns agent assignments for an existing run", async () => {
    const { app } = await buildTestApp();

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: {
        goal: "Create a task application",
      },
    });

    const createdRun = RunSchema.parse(createResponse.json());

    const response = await app.inject({
      method: "GET",
      url: `/runs/${createdRun.id}/coordination`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      goal: "Create a task application",
      plan: [
        "Prepare the React/Vite workspace",
        "Implement the requested UI in src/App.tsx",
        "Install dependencies and build the app",
        "Evaluate the generated app against the goal",
        "Repair the app if evaluation or review fails",
      ],
      assignments: [
        {
          role: "planner",
          task: "Break down the product goal: Create a task application",
        },
        {
          role: "coder",
          task: "Implement the app for this goal: Create a task application",
        },
        {
          role: "reviewer",
          task: "Review whether the generated app satisfies this goal: Create a task application",
        },
      ],
    });
  });

  it("returns 404 when the run does not exist", async () => {
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/runs/missing-run/coordination",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Run not found",
    });
  });
});

describe("persisted live operation progress", () => {
  it("settles a manager-level timeout and clears live progress metadata", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-api-live-progress-"),
    );
    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
    const workspaceManager = new WorkspaceManager(temporaryRoot);
    const executeRun = vi.fn(async (input: {
      onProgress?: (stage: "coding") => void | Promise<void>;
    }) => {
      await input.onProgress?.("coding");
      return await new Promise<RunReactAppAgentResult>(() => undefined);
    });
    const app = buildApp(
      runRepository,
      workspaceManager,
      executeRun,
      undefined,
      undefined,
      undefined,
      {
        timeoutMs: 500,
        abortGraceMs: 20,
      },
    );

    const createResponse = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { goal: "Create a routed application" },
    });
    const createdRun = RunSchema.parse(createResponse.json());
    const startResponse = await app.inject({
      method: "POST",
      url: `/runs/${createdRun.id}/execute`,
      payload: { background: true },
    });

    expect(startResponse.statusCode).toBe(202);
    expect(startResponse.json().run).toEqual(
      expect.objectContaining({
        operationId: expect.any(String),
        operationStartedAt: expect.any(String),
        operationUpdatedAt: expect.any(String),
      }),
    );

    await vi.waitFor(async () => {
      const detailResponse = await app.inject({
        method: "GET",
        url: `/runs/${createdRun.id}`,
      });
      expect(detailResponse.json().run).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: expect.stringContaining("timed out"),
        }),
      );
    }, { timeout: 3_000 });

    const terminalRun = await runRepository.findById(createdRun.id);
    expect(terminalRun).not.toHaveProperty("operation");
    expect(terminalRun).not.toHaveProperty("operationId");
    expect(terminalRun).not.toHaveProperty("operationStage");
    expect(terminalRun).not.toHaveProperty("operationStartedAt");
    expect(terminalRun).not.toHaveProperty("operationUpdatedAt");

    expect(executeRun).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
