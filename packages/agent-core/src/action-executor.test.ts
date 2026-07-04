import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ActionExecutor } from "./action-executor.js";

describe("ActionExecutor", () => {
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

  it("executes a write_file action inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "write_file",
      path: "src/App.tsx",
      content: "export default function App() {}",
    });

    const writtenContent = await readFile(
      path.join(workspaceRoot, "src", "App.tsx"),
      "utf8",
    );

    expect(result).toEqual({
      ok: true,
      message: "Wrote file: src/App.tsx",
    });
    expect(writtenContent).toBe("export default function App() {}");
  });

  it("returns the finish summary", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "finish",
      summary: "Created the task app.",
    });

    expect(result).toEqual({
      ok: true,
      message: "Created the task app.",
    });
  });

  it("executes a run_command action inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({
        scripts: {
          build: "node -e \"console.log('build succeeded')\"",
        },
      }),
      "utf8",
    );

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "run_command",
      command: "npm",
      args: ["run", "build"],
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Command exited with code 0");
    expect(result.message).toContain("build succeeded");
  });
});
