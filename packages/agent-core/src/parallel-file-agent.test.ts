import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import { ParallelFileAgent } from "./parallel-file-agent.js";

describe("ParallelFileAgent", () => {
    it("generates exactly the file owned by its workstream", async () => {
        const model = new FakeModelProvider({
            content: JSON.stringify({
                path: "src/content.ts",
                content: "export const siteContent = { brand: '温州' };",
                summary: "Prepared the content model",
            }),
        });
        const agent = new ParallelFileAgent({ model });

        const artifact = await agent.generate({
            goal: "创建一个介绍温州的多页面网站",
            role: "Content",
            path: "src/content.ts",
            instructions: "Export the shared siteContent contract.",
            planContext: "Use distinct route content.",
        });

        expect(artifact.path).toBe("src/content.ts");
        expect(artifact.content).toContain("siteContent");
        expect(model.requests).toHaveLength(1);
        expect(model.requests[0]?.messages[0]?.content).toContain(
            "You own exactly one file: src/content.ts",
        );
        expect(model.requests[0]?.messages[1]?.content).toContain(
            "创建一个介绍温州的多页面网站",
        );
    });

    it("rejects a foreign path and accepts a corrected owned file", async () => {
        const model = new FakeModelProvider([
            {
                content: JSON.stringify({
                    path: "src/App.tsx",
                    content: "export function App() { return null; }",
                    summary: "Wrong file",
                }),
            },
            {
                content: JSON.stringify({
                    path: "src/App.css",
                    content: ".app-shell { min-height: 100vh; }",
                    summary: "Prepared responsive styles",
                }),
            },
        ]);
        const agent = new ParallelFileAgent({ model });

        await expect(
            agent.generate({
                goal: "Create a polished page",
                role: "Visual",
                path: "src/App.css",
                instructions: "Style the shared class contract.",
            }),
        ).resolves.toMatchObject({
            path: "src/App.css",
            summary: "Prepared responsive styles",
        });

        expect(model.requests).toHaveLength(2);
        expect(model.requests[1]?.messages.at(-1)?.content).toContain(
            "must return src/App.css",
        );
    });
});
