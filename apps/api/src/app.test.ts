import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RunSchema } from "@appforge/protocol";
import { WorkspaceManager, writeWorkspaceFile } from "@appforge/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import { MemoryRepository } from "./memory-repository.js";
import { PreviewManager } from "./preview-manager.js";
import { RunRepository } from "./run-repository.js";

const temporaryDirectories: string[] = [];

const TEST_COORDINATION = {
  goal: "Create a task application",
  plan: [],
  assignments: [],
};

async function buildTestApp(previewManager?: PreviewManager) {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "appforge-api-"),
  );

  temporaryDirectories.push(temporaryRoot);

  const workspaceManager = new WorkspaceManager(temporaryRoot);

  return {
    app: buildApp(undefined, workspaceManager, undefined, previewManager),
    workspaceManager,
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
        goal: "鎴戞兂瑕佷竴涓粙缁嶆俯宸炵殑鐣岄潰",
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
      result: expectedResult,
      versions: [
        expect.objectContaining({
          runId: createdRun.id,
          versionNumber: 1,
          summary: "Initial generated version",
        }),
      ],
    });
  });

  it("marks the run as waiting_for_human when review rejects the result", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const workspaceManager = new WorkspaceManager(temporaryRoot);

    const rejectedResult = {
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
    }) => ({
      ...rejectedResult,
      workspaceRoot: input.workspaceRoot,
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

    const waitingRun = {
      ...createdRun,
      status: "waiting_for_human",
    };

    expect(executeResponse.statusCode).toBe(200);
    expect(executeResponse.json()).toEqual({
      run: waitingRun,
      result: {
        ...rejectedResult,
        workspaceRoot: workspaceManager.resolve(createdRun.id),
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

    expect(getResponse.json()).toEqual({
      run: {
      ...createdRun,
      status: "failed",
      },
      versions: [],
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
      },
    });

    expect(executeResponse.statusCode).toBe(200);
    expect(executeRun).toHaveBeenCalledWith({
      goal: createdRun.goal,
      workspaceRoot: workspaceManager.resolve(createdRun.id),
      maxRepairAttempts: 2,
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
        .mockResolvedValueOnce({
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
        })
        .mockResolvedValueOnce({
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
        summary: "Initial generated version",
      }),
      expect.objectContaining({
        runId: createdRun.id,
        versionNumber: 2,
        summary: "Repair version 2",
      }),
    ]);
    expect(repairResponse.json().run).toEqual({
      ...createdRun,
      status: "succeeded",
    });
    expect(executeRun).toHaveBeenCalledTimes(2);
    expect(executeRun).toHaveBeenLastCalledWith({
      goal:
          "我想要一个介绍温州的页面\n\nHuman feedback:\n请改成中文，并增加温州美食、景点和交通信息。",
      workspaceRoot: workspaceManager.resolve(createdRun.id),
    });
  });
});
describe("POST /runs/:id/iterate", () => {
  it("iterates an existing run and stores a new version", async () => {
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
        reason: "Iteration request was applied.",
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
      }),
    ]);
    expect(executeRun).toHaveBeenCalledWith({
      goal: "Create a task application\n\nIteration request:\nAdd dark mode",
      workspaceRoot: workspaceManager.resolve(createdRun.id),
    });
  });

  it("preserves an existing generated result as v1 before iterating old runs", async () => {
    const temporaryRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-api-"),
    );

    temporaryDirectories.push(temporaryRoot);

    const runRepository = new RunRepository();
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
        reason: "Iteration request was applied.",
        checks: {
          agentFinished: true,
          installPassed: true,
          buildPassed: true,
          evalPassed: true,
        },
      },
      attempts: [],
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
describe("POST /runs/:id/preview", () => {
  it("creates a preview session for an existing run", async () => {
    const previewManager = new PreviewManager(
      vi.fn(() => ({
        unref: vi.fn(),
      })),
      vi.fn(async () => true),
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
    });
  });
  it("creates a preview session for a version snapshot", async () => {
    const startPreview = vi.fn(() => ({
      unref: vi.fn(),
    }));

    const previewManager = new PreviewManager(
        startPreview,
        vi.fn(async () => true),
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
              "v1",
          ),
          port: expect.any(Number),
        }),
    );
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
