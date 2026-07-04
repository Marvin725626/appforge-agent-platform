import { describe, expect, it } from "vitest";

import { CodingAgent } from "./coding-agent.js";
import { FakeModelProvider } from "./fake-model-provider.js";

describe("CodingAgent", () => {
    it("returns a parsed action from the model response", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export default function App() {}",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        const action = await agent.decideNextAction(
            "Create a React task application",
        );

        expect(action).toEqual({
            type: "write_file",
            path: "src/App.tsx",
            content: "export default function App() {}",
        });
    });

    it("sends coding-agent instructions and the user goal", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction("Create a React task application");

        expect(provider.requests).toHaveLength(1);
        expect(provider.requests[0]?.messages[0]?.role).toBe("system");
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Return exactly one JSON object and no markdown.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            'For write_file, use: {"type":"write_file","path":"README.md","content":"..."}',
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "Preserve the user's language exactly.",
        );
        expect(provider.requests[0]?.messages[0]?.content).toContain(
            "If the user writes Chinese, generate readable UTF-8 Chinese text",
        );
        expect(provider.requests[0]?.messages[1]).toEqual({
            role: "user",
            content: "Create a React task application",
        });
    });
    it("includes previous execution context when provided", async () => {
        const provider = new FakeModelProvider({
            content: JSON.stringify({
                type: "finish",
                summary: "Done",
            }),
        });

        const agent = new CodingAgent({
            model: provider,
        });

        await agent.decideNextAction(
            "Create a React task application",
            "Step 1: Wrote file src/App.tsx",
        );

        expect(provider.requests[0]?.messages[1]?.content).toBe(
            "Create a React task application\n\nPrevious execution context:\nStep 1: Wrote file src/App.tsx",
        );
    });
});
