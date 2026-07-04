import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import { runCodingAgentLoop } from "./run-coding-agent-loop.js";

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
        expect(secondRequestUserMessage).toContain("Wrote file: src/App.tsx");
    });
});