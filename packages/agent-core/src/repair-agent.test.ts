import { describe, expect, it } from "vitest";

import { FakeModelProvider } from "./fake-model-provider.js";
import { RepairAgent } from "./repair-agent.js";

describe("RepairAgent", () => {
    it("does not advertise image actions when image tools are disabled", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });
        const agent = new RepairAgent({ model: provider });

        await agent.decideNextAction(
            "Fix the TypeScript error",
            "Typecheck diagnostics:\nsrc/App.tsx(3,10): error TS2339",
        );

        const systemPrompt = provider.requests[0]?.messages[0]?.content ?? "";
        expect(systemPrompt).not.toContain('For get_image, use:');
    });

    it("advertises image actions only when image tools are enabled", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });
        const agent = new RepairAgent({
            model: provider,
            imageToolsEnabled: true,
            imageToolModes: ["generate"],
        });

        await agent.decideNextAction("Restore a missing local hero image");

        const systemPrompt = provider.requests[0]?.messages[0]?.content ?? "";
        expect(systemPrompt).toContain('For get_image, use:');
        expect(systemPrompt).toContain("Available image modes: generate.");
    });

    it("forces App.tsx first for entrypoint integration repair", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export function App(){return <main><h1>行动简报</h1></main>}",
            }),
        });
        const agent = new RepairAgent({
            model: provider,
            entrypointFirst: true,
        });

        await agent.decideNextAction(
            "连接生成内容到页面入口",
            "src/content.ts exists but src/App.tsx is still the starter.",
        );

        const systemPrompt = provider.requests[0]?.messages[0]?.content ?? "";
        expect(systemPrompt).toContain(
            "This is an entrypoint integration repair.",
        );
        expect(systemPrompt).toContain(
            "first workspace-changing action must write_file or edit_file src/App.tsx",
        );
        expect(systemPrompt).toContain(
            "Do not start with content.ts, App.css, images, commands, or optional polish.",
        );
    });

});
