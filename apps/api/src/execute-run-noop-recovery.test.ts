import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
    createNoopRecoveryRequest,
    executeRunWithNoopRecovery,
    fingerprintUserVisibleWorkspace,
} from "./execute-run-noop-recovery.js";

const roots: string[] = [];

async function createWorkspace(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "appforge-noop-recovery-"));
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
        path.join(root, "src", "App.tsx"),
        "export function App() { return <main>Initial</main>; }\n",
        "utf8",
    );
    await writeFile(path.join(root, "src", "App.css"), "main { color: black; }\n", "utf8");
    return root;
}

afterEach(async () => {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
});

describe("V9.4.2.3 bounded continuation no-op recovery", () => {
    it("does not wrap initial generation without currentRequest", async () => {
        const workspaceRoot = await createWorkspace();
        const calls: unknown[] = [];

        const result = await executeRunWithNoopRecovery(
            async (input) => {
                calls.push(input);
                return "initial";
            },
            { goal: "Initial generation", workspaceRoot },
        );

        expect(result).toBe("initial");
        expect(calls).toHaveLength(1);
    });

    it("returns after one focused attempt when the workspace changed", async () => {
        const workspaceRoot = await createWorkspace();
        const calls: Array<{ currentRequest?: string | undefined }> = [];

        const result = await executeRunWithNoopRecovery(
            async (input) => {
                calls.push(input);
                await writeFile(
                    path.join(workspaceRoot, "src", "App.css"),
                    "main { color: blue; }\n",
                    "utf8",
                );
                return "changed";
            },
            {
                goal: "Focused iteration",
                workspaceRoot,
                currentRequest: "把标题颜色改成蓝色",
            },
        );

        expect(result).toBe("changed");
        expect(calls).toHaveLength(1);
    });

    it("performs exactly one final recovery when the first attempt is a no-op", async () => {
        const workspaceRoot = await createWorkspace();
        const calls = [] as unknown as Array<{
            currentRequest?: string | undefined;
            maxRepairAttempts?: number | undefined;
            resetWorkspace?: boolean | undefined;
        }> & {
            1: {
                currentRequest?: string | undefined;
                maxRepairAttempts?: number | undefined;
                resetWorkspace?: boolean | undefined;
            };
        };

        const result = await executeRunWithNoopRecovery(
            async (input) => {
                calls.push(input);
                if (calls.length === 2) {
                    await writeFile(
                        path.join(workspaceRoot, "src", "App.css"),
                        "main { color: blue; white-space: nowrap; }\n",
                        "utf8",
                    );
                }
                return calls.length;
            },
            {
                goal: "Focused iteration",
                workspaceRoot,
                currentRequest:
                    "只修改 src/App.tsx 和 src/App.css，让桌面导航保持单行。",
                maxRepairAttempts: 0,
                resetWorkspace: true,
            },
        );

        expect(result).toBe(2);
        expect(calls).toHaveLength(2);
        expect(calls[1].currentRequest).toContain(
            "[NO-OP RECOVERY: SECOND AND FINAL ATTEMPT]",
        );
        expect(calls[1].currentRequest).toContain("src/App.tsx");
        expect(calls[1].currentRequest).toContain("src/App.css");
        expect(calls[1].currentRequest).toContain("桌面导航保持单行");
        expect(calls[1].maxRepairAttempts).toBeGreaterThanOrEqual(1);
        expect(calls[1].resetWorkspace).toBe(false);
    });

    it("recovers once when the first focused execution throws without changing source", async () => {
        const workspaceRoot = await createWorkspace();
        let callCount = 0;

        const result = await executeRunWithNoopRecovery(
            async (input) => {
                callCount += 1;
                if (callCount === 1) {
                    throw new Error("edit_file oldText was not found");
                }

                expect(input.currentRequest).toContain("[NO-OP RECOVERY");
                await writeFile(
                    path.join(workspaceRoot, "src", "App.tsx"),
                    "export function App() { return <main>Recovered</main>; }\n",
                    "utf8",
                );
                return "recovered";
            },
            {
                goal: "Focused iteration",
                workspaceRoot,
                currentRequest: "修改 src/App.tsx 中的标题",
            },
        );

        expect(result).toBe("recovered");
        expect(callCount).toBe(2);
    });

    it("never loops beyond two executions when the recovery is also a no-op", async () => {
        const workspaceRoot = await createWorkspace();
        let callCount = 0;

        const result = await executeRunWithNoopRecovery(
            async () => {
                callCount += 1;
                return callCount;
            },
            {
                goal: "Focused iteration",
                workspaceRoot,
                currentRequest: "缩短导航文案",
            },
        );

        expect(result).toBe(2);
        expect(callCount).toBe(2);
    });

    it("fingerprints user-visible source changes but ignores dist output", async () => {
        const workspaceRoot = await createWorkspace();
        const before = await fingerprintUserVisibleWorkspace(workspaceRoot);

        await mkdir(path.join(workspaceRoot, "dist"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "dist", "index.html"),
            "generated",
            "utf8",
        );
        expect(await fingerprintUserVisibleWorkspace(workspaceRoot)).toBe(before);

        await writeFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "export function App() { return <main>Changed</main>; }\n",
            "utf8",
        );
        expect(await fingerprintUserVisibleWorkspace(workspaceRoot)).not.toBe(
            before,
        );
    });

    it("keeps the original newest request intact in the recovery prompt", () => {
        const prompt = createNoopRecoveryRequest(
            "修复顶部导航；保持现有编辑专题视觉不变。",
        );

        expect(prompt).toContain("修复顶部导航；保持现有编辑专题视觉不变。");
        expect(prompt).toContain("Re-read the exact current file contents");
    });
});
