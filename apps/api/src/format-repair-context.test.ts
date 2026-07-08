import { describe, expect, it } from "vitest";

import { formatRepairContext } from "./format-repair-context.js";

describe("formatRepairContext", () => {
    it("formats eval failures without build stderr", () => {
        const context = formatRepairContext({
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
                        passed: true,
                    },
                    {
                        name: "has button",
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
        });

        expect(context).toBe(
            [
                "Repair request:",
                "Reviewer rejected the result.",
                "Build exit code: 0",
                "Eval passed: no",
                "Eval checks:",
                "- has input: passed",
                "- has button: failed",
                "Reason: Rejected because eval failed.",
            ].join("\n"),
        );
    });

    it("includes build stderr when build output has errors", () => {
        const context = formatRepairContext({
            build: {
                exitCode: 1,
                stdout: "",
                stderr: "TypeScript error",
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
                reason: "Rejected because npm build failed, eval failed.",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: false,
                    evalPassed: false,
                },
            },
        });

        expect(context).toContain("Build stderr:\nTypeScript error");
    });

    it("includes browser eval failures", () => {
        const context = formatRepairContext({
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
                ],
            },
            browserEval: {
                passed: false,
                checks: [
                    {
                        name: "adds a task item",
                        passed: false,
                        message: "The task text was not rendered.",
                    },
                ],
            },
            review: {
                accepted: false,
                reason: "Rejected because browser eval failed.",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: true,
                    evalPassed: true,
                    browserPassed: false,
                },
            },
        });

        expect(context).toContain("Browser eval checks:");
        expect(context).toContain(
            "- adds a task item: failed (The task text was not rendered.)",
        );
        expect(context).toContain("Reason: Rejected because browser eval failed.");
    });
});
