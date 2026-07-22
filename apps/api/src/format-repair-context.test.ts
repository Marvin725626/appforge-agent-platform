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
                "You must revise the current workspace to satisfy every reviewer issue below.",
                "Do not replace the app with an unrelated starter. Keep existing working features and make the smallest coherent fix.",
                "Build exit code: 0",
                "Eval passed: no",
                "Eval checks:",
                "- has input: passed",
                "- has button: failed",
                "Reviewer issues to fix:",
                "- Rejected because eval failed.",
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

    it("adds strict patch guidance when the coding agent made no workspace change", () => {
        const context = formatRepairContext({
            build: {
                exitCode: 1,
                stdout: "",
                stderr:
                    "Skipped because the Coding Agent produced no workspace changes.",
            },
            eval: {
                passed: false,
                checks: [
                    {
                        name: "Coding Agent produced a new draft",
                        passed: false,
                    },
                ],
            },
            review: {
                accepted: false,
                reason:
                    "No new draft was produced because the Coding Agent did not change the workspace. The Coding Agent completed without a file or image change.",
                checks: {
                    agentFinished: false,
                    installPassed: false,
                    buildPassed: false,
                    evalPassed: false,
                },
            },
        });

        expect(context).toContain("No-change recovery constraints");
        expect(context).toContain("perform at least one real edit_file");
        expect(context).toContain("Do not repeat a plan");
    });

    it("includes a source excerpt when available", () => {
        const context = formatRepairContext({
            build: {
                exitCode: 1,
                stdout: "",
                stderr: "src/App.tsx:10:4: Expected closing tag",
            },
            eval: {
                passed: true,
                checks: [
                    {
                        name: "has readable text",
                        passed: true,
                    },
                ],
            },
            review: {
                accepted: false,
                reason: "Rejected because npm build failed.",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: false,
                    evalPassed: true,
                },
            },
            sourceExcerpt: ">   10 | </footer>",
        });

        expect(context).toContain("Relevant source near compiler error:");
        expect(context).toContain(">   10 | </footer>");
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
        expect(context).toContain("Reviewer issues to fix:");
        expect(context).toContain("- Rejected because browser eval failed.");
    });
    it("includes exact typecheck diagnostics and compiler repair constraints", () => {
        const context = formatRepairContext({
            build: {
                exitCode: 0,
                stdout: "build ok",
                stderr: "",
            },
            typecheck: {
                exitCode: 2,
                stdout:
                    "src/App.tsx(59,186): error TS2339: Property 'loadout' does not exist.",
                stderr: "",
            },
            eval: {
                passed: false,
                checks: [
                    {
                        name: "TypeScript typecheck passes",
                        passed: false,
                    },
                ],
            },
            review: {
                accepted: false,
                reason: "Rejected because typecheck failed.",
                checks: {
                    agentFinished: true,
                    installPassed: true,
                    buildPassed: true,
                    evalPassed: false,
                    typecheckPassed: false,
                },
            },
            sourceExcerpt: ">   59 | <strong>{op.loadout}</strong>",
        });

        expect(context).toContain("Typecheck exit code: 2");
        expect(context).toContain("Typecheck repair constraints:");
        expect(context).toContain("Typecheck diagnostics:");
        expect(context).toContain("TS2339");
        expect(context).toContain("Relevant source near compiler error:");
    });

});
