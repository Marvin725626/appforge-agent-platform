import { describe, expect, it } from "vitest";

import { parseAgentAction } from "./parse-agent-action.js";

describe("parseAgentAction", () => {
    it("parses a valid write_file action", () => {
        const action = parseAgentAction(
            JSON.stringify({
                type: "write_file",
                path: "src/App.tsx",
                content: "export default function App() {}",
            }),
        );

        expect(action.type).toBe("write_file");
    });

    it("accepts legacy action and args output", () => {
        expect(
            parseAgentAction(
                JSON.stringify({
                    action: "write_file",
                    args: {
                        path: "src/App.tsx",
                        content: "export function App() {}",
                    },
                }),
            ),
        ).toEqual({
            type: "write_file",
            path: "src/App.tsx",
            content: "export function App() {}",
        });
    });

    it("extracts JSON from a fenced response", () => {
        expect(
            parseAgentAction(
                [
                    "```json",
                    JSON.stringify({
                        type: "finish",
                        summary: "Done",
                    }),
                    "```",
                ].join("\n"),
            ),
        ).toEqual({
            type: "finish",
            summary: "Done",
        });
    });

    it("parses a valid run_command action", () => {
        const action = parseAgentAction(
            JSON.stringify({
                type: "run_command",
                command: "npm",
                args: ["run", "build"],
            }),
        );

        expect(action.type).toBe("run_command");
    });

    it("rejects invalid json", () => {
        expect(() => parseAgentAction("not json")).toThrow(
            "Model did not return valid JSON",
        );
    });

    it("rejects an unknown action type", () => {
        expect(() =>
            parseAgentAction(
                JSON.stringify({
                    type: "delete_everything",
                }),
            ),
        ).toThrow("Model JSON did not match AgentAction schema");
    });

    it("includes a preview when the action schema is invalid", () => {
        expect(() =>
            parseAgentAction(
                JSON.stringify({
                    action: "write_file",
                }),
            ),
        ).toThrow('"action":"write_file"');
    });
});
