import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import { runCodingAgentStep } from "./run-coding-agent-step.js";

describe("runCodingAgentStep", () => {
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

    it("asks the model for an action and executes it", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-step-"),
        );

        temporaryDirectories.push(workspaceRoot);

        const model = new FakeModelProvider({
            content: JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export default function App() {}",
            }),
        });

        const result = await runCodingAgentStep({
            goal: "Create a React app",
            model,
            workspaceRoot,
        });

        const writtenContent = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );

        expect(result.action).toEqual({
            type: "write_file",
            path: "src/App.tsx",
            content: "export default function App() {}",
        });

        expect(result.execution).toEqual({
            ok: true,
            message: "Wrote file: src/App.tsx",
        });

        expect(writtenContent).toBe("export default function App() {}");
    });
});