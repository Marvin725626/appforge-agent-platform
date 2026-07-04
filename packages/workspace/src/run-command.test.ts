import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runWorkspaceCommand } from "./run-command.js";

describe("runWorkspaceCommand", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, {
                    recursive: true,
                    force: true,
                    maxRetries: 5,
                    retryDelay: 100,
                }),
            ),
        );

        temporaryDirectories.length = 0;
    });

    it("runs an approved command inside the workspace", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-"),
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

        const result = await runWorkspaceCommand(workspaceRoot, {
            command: "npm",
            args: ["run", "build"],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("build succeeded");
    });

    it("strips ANSI color codes from command output", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('\\x1b[32mbuild succeeded\\x1b[39m')\"",
                },
            }),
            "utf8",
        );

        const result = await runWorkspaceCommand(workspaceRoot, {
            command: "npm",
            args: ["run", "build"],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("build succeeded");
        expect(result.stdout).not.toContain("\u001b[32m");
        expect(result.stdout).not.toContain("\u001b[39m");
    });

    it("rejects a command that is not approved", async () => {
        await expect(
            runWorkspaceCommand(".", {
                command: "powershell",
                args: [],
            }),
        ).rejects.toThrow("Command is not allowed");
    });

    it("terminates a command that exceeds the timeout", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"setTimeout(() => {}, 500)\"",
                },
            }),
            "utf8",
        );

        await expect(
            runWorkspaceCommand(
                workspaceRoot,
                {
                    command: "npm",
                    args: ["run", "build"],
                },
                {
                    timeoutMs: 100,
                },
            ),
        ).rejects.toThrow("Command timed out after 100ms");
    });

    it("terminates a command that exceeds the output limit", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"console.log('x'.repeat(1000))\"",
                },
            }),
            "utf8",
        );

        await expect(
            runWorkspaceCommand(
                workspaceRoot,
                {
                    command: "npm",
                    args: ["run", "build"],
                },
                {
                    maxOutputBytes: 100,
                },
            ),
        ).rejects.toThrow("Command output exceeded 100 bytes");
    });
});
