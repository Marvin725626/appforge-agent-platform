import { describe, expect, it } from "vitest";

import { assertCommandAllowed } from "./command-policy.js";

describe("assertCommandAllowed", () => {
    it("allows an approved npm build command", () => {
        expect(() =>
            assertCommandAllowed({
                command: "npm",
                args: ["run", "build"],
            }),
        ).not.toThrow();
    });

    it("allows approved typecheck commands", () => {
        expect(() =>
            assertCommandAllowed({
                command: "npm",
                args: ["run", "typecheck"],
            }),
        ).not.toThrow();

        expect(() =>
            assertCommandAllowed({
                command: "node",
                args: ["node_modules/typescript/bin/tsc", "--noEmit"],
            }),
        ).not.toThrow();
    });

    it("rejects a command that is not approved", () => {
        expect(() =>
            assertCommandAllowed({
                command: "powershell",
                args: [],
            }),
        ).toThrow("Command is not allowed");
    });

    it("rejects unapproved arguments for an approved command", () => {
        expect(() =>
            assertCommandAllowed({
                command: "npm",
                args: ["publish"],
            }),
        ).toThrow("Command is not allowed");
    });

    it("rejects extra arguments", () => {
        expect(() =>
            assertCommandAllowed({
                command: "npm",
                args: ["run", "build", "--unsafe"],
            }),
        ).toThrow("Command is not allowed");
    });
});
