import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeImageAssetProvider } from "./fake-image-asset-provider.js";
import { ImageAssetTool } from "./image-asset-tool.js";
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

  it("executes an edit_file action inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "App.tsx"),
      '<a href="#">About</a>',
      "utf8",
    );

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "edit_file",
      path: "App.tsx",
      oldText: 'href="#"',
      newText: 'href="#about"',
    });

    await expect(
      readFile(path.join(workspaceRoot, "App.tsx"), "utf8"),
    ).resolves.toBe('<a href="#about">About</a>');
    expect(result).toEqual({
      ok: true,
      message: "Edited file: App.tsx",
    });
  });

  it("executes an append_file action inside the workspace", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "content.ts"),
      "export const sections = [\n",
      "utf8",
    );

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "append_file",
      path: "content.ts",
      content: "  'About',\n];\n",
    });

    await expect(
      readFile(path.join(workspaceRoot, "content.ts"), "utf8"),
    ).resolves.toBe("export const sections = [\n  'About',\n];\n");
    expect(result).toEqual({
      ok: true,
      message: "Appended file: content.ts",
    });
  });

  it("does not append the same generated chunk twice", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-append-idempotent-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "content.ts"),
      "export const sections = [\n",
      "utf8",
    );

    const executor = new ActionExecutor({ workspaceRoot });
    const action = {
      type: "append_file" as const,
      path: "content.ts",
      content: "  'About',\n];\n",
    };

    await executor.execute(action);
    const repeatedResult = await executor.execute(action);

    await expect(
      readFile(path.join(workspaceRoot, "content.ts"), "utf8"),
    ).resolves.toBe("export const sections = [\n  'About',\n];\n");
    expect(repeatedResult).toEqual({
      ok: true,
      changed: false,
      message: "Skipped duplicate append: content.ts",
    });
  });

  it("reports identical writes and edits as successful no-ops", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-idempotent-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "App.tsx"),
      '<a href="#about">About</a>',
      "utf8",
    );

    const executor = new ActionExecutor({ workspaceRoot });
    const writeResult = await executor.execute({
      type: "write_file",
      path: "App.tsx",
      content: '<a href="#about">About</a>',
    });
    const editResult = await executor.execute({
      type: "edit_file",
      path: "App.tsx",
      oldText: 'href="#about"',
      newText: 'href="#about"',
    });

    expect(writeResult).toEqual({
      ok: true,
      changed: false,
      message: "Skipped unchanged file: App.tsx",
    });
    expect(editResult).toEqual({
      ok: true,
      changed: false,
      message: "Skipped unchanged edit: App.tsx",
    });
  });

  it("returns a failed edit_file result when the target text is missing", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "appforge-action-"),
    );

    temporaryDirectories.push(workspaceRoot);

    await writeFile(
      path.join(workspaceRoot, "App.tsx"),
      '<a href="#home">Home</a>',
      "utf8",
    );

    const executor = new ActionExecutor({
      workspaceRoot,
    });

    const result = await executor.execute({
      type: "edit_file",
      path: "App.tsx",
      oldText: 'href="#"',
      newText: 'href="#about"',
    });

    expect(result).toEqual({
      ok: false,
      message: "Edit target not found in file: App.tsx",
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
  it("executes a get_image action", async () => {
    const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "appforge-action-image-"),
    );

    temporaryDirectories.push(workspaceRoot);

    const imageData = Uint8Array.from([
      137, 80, 78, 71,
    ]);

    const provider = new FakeImageAssetProvider({
      data: imageData,
      mediaType: "image/png",
      source: "fake://wenzhou",
    });

    const imageAssetTool = new ImageAssetTool({
      workspaceRoot,
      provider,
    });

    const executor = new ActionExecutor({
      workspaceRoot,
      imageAssetTool,
    });

    const result = await executor.execute({
      type: "get_image",
      query: "温州江心屿",
      mode: "search",
      altText: "温州江心屿风景",
      outputPath:
          "public/assets/wenzhou.png",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain(
        "Saved image: public/assets/wenzhou.png",
    );

    expect(provider.requests).toEqual([
      {
        query: "温州江心屿",
        mode: "search",
        altText: "温州江心屿风景",
      },
    ]);

    const savedData = await readFile(
        path.join(
            workspaceRoot,
            "public",
            "assets",
            "wenzhou.png",
        ),
    );

    expect([...savedData]).toEqual([...imageData]);
  });
});
