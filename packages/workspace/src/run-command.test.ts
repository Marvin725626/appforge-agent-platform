import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    __testOnlyTerminateProcessTree,
    runWorkspaceCommand,
} from "./run-command.js";

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

    it("launches local TypeScript CLI with Node instead of npx or a shell", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-winpath-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await mkdir(
            path.join(workspaceRoot, "node_modules", "typescript", "bin"),
            { recursive: true },
        );
        await writeFile(
            path.join(workspaceRoot, "node_modules", "typescript", "bin", "tsc"),
            "console.log('tsc ok');",
            "utf8",
        );

        const spawnProcess = vi.fn((executable, args, options) => {
            const stdout = new EventEmitter();
            const stderr = new EventEmitter();
            const child = Object.assign(new EventEmitter(), {
                stdout,
                stderr,
                pid: 1234,
                exitCode: null,
                kill: vi.fn(),
                unref: vi.fn(),
            }) as unknown as ChildProcess;

            process.nextTick(() => {
                stdout.emit("data", Buffer.from("tsc ok"));
                child.emit("close", 0);
            });

            return child;
        }) as unknown as typeof spawn;

        const result = await runWorkspaceCommand(
            workspaceRoot,
            {
                command: "node",
                args: ["node_modules/typescript/bin/tsc", "--noEmit"],
            },
            {
                spawnProcess,
            },
        );

        const [executable, args, options] = vi.mocked(spawnProcess).mock
            .calls[0] as Parameters<typeof spawn>;

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("tsc ok");
        expect(executable).toBe(process.execPath);
        expect(executable.toLowerCase()).not.toContain("npx");
        expect(args[0]).toBe(
            path.join(workspaceRoot, "node_modules", "typescript", "bin", "tsc"),
        );
        expect(args).toContain("--noEmit");
        expect(options?.shell).toBe(false);
    });

    it("returns a clear error when a requested local Node CLI is missing", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-missing-cli-"),
        );

        temporaryDirectories.push(workspaceRoot);

        await expect(
            runWorkspaceCommand(workspaceRoot, {
                command: "node",
                args: ["node_modules/typescript/bin/tsc", "--noEmit"],
            }),
        ).rejects.toThrow(
            "Node CLI was not found at node_modules/typescript/bin/tsc.",
        );
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

    it("bounds Windows cleanup when taskkill and child close never finish", async () => {
        vi.useFakeTimers();

        try {
            const childKill = vi.fn(() => true);
            const childUnref = vi.fn();
            const child = Object.assign(new EventEmitter(), {
                pid: 1234,
                exitCode: null,
                kill: childKill,
                unref: childUnref,
            }) as unknown as ChildProcess;
            const killerKill = vi.fn(() => true);
            const killerUnref = vi.fn();
            const killer = Object.assign(new EventEmitter(), {
                pid: 5678,
                exitCode: null,
                kill: killerKill,
                unref: killerUnref,
            }) as unknown as ChildProcess;
            const spawnProcess = vi.fn(() => killer) as unknown as typeof spawn;
            let settled = false;

            const cleanup = __testOnlyTerminateProcessTree(child, {
                platform: "win32",
                cleanupTimeoutMs: 5_000,
                spawnProcess,
            }).then(() => {
                settled = true;
            });

            await Promise.resolve();
            expect(spawnProcess).toHaveBeenCalledWith(
                "taskkill",
                ["/pid", "1234", "/T", "/F"],
                {
                    shell: false,
                    stdio: "ignore",
                },
            );

            await vi.advanceTimersByTimeAsync(4_999);
            expect(settled).toBe(false);

            await vi.advanceTimersByTimeAsync(1);
            await cleanup;

            expect(settled).toBe(true);
            expect(childKill).toHaveBeenCalledTimes(1);
            expect(childUnref).toHaveBeenCalledTimes(1);
            expect(killerKill).toHaveBeenCalledTimes(1);
            expect(killerUnref).toHaveBeenCalledTimes(1);

            killer.emit("error", new Error("late taskkill error"));
            killer.emit("close", 1);
            child.emit("close", null);
            expect(childKill).toHaveBeenCalledTimes(1);
            expect(killerKill).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("terminates a running command when its caller cancels", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-command-cancel-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await writeFile(
            path.join(workspaceRoot, "package.json"),
            JSON.stringify({
                scripts: {
                    build: "node -e \"setTimeout(() => {}, 5000)\"",
                },
            }),
            "utf8",
        );
        const controller = new AbortController();
        const reason = new Error("run cancelled");
        const command = runWorkspaceCommand(
            workspaceRoot,
            {
                command: "npm",
                args: ["run", "build"],
            },
            {
                signal: controller.signal,
                timeoutMs: 10_000,
            },
        );

        setTimeout(() => controller.abort(reason), 50);

        await expect(command).rejects.toBe(reason);
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
