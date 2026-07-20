import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateRepairSourceAction } from "./validate-repair-source-action.js";

describe("validateRepairSourceAction", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    it("rejects a repair edit that introduces an unterminated string", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-repair-guard-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "content.ts"),
            'export const roster = { kicker: "SQUAD LOADOUT MATRIX" };\n',
            "utf8",
        );

        const result = await validateRepairSourceAction(workspaceRoot, {
            type: "edit_file",
            path: "src/content.ts",
            oldText: 'kicker: "SQUAD LOADOUT MATRIX"',
            newText: 'kicker: "SQUAD LOADOUT MATRIX",UT"',
        });

        expect(result).toMatchObject({
            ok: false,
            changed: false,
            retryable: true,
        });
        expect(result?.message).toContain("source syntax errors");
        expect(result?.message).toContain("Unterminated string literal");
    });

    it("allows a syntactically valid focused repair", async () => {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-repair-guard-valid-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, "src", "content.ts"),
            "export const mapSites = [];\n",
            "utf8",
        );

        const result = await validateRepairSourceAction(workspaceRoot, {
            type: "append_file",
            path: "src/content.ts",
            content: "export const sectors = mapSites;\n",
        });

        expect(result).toBeUndefined();
    });
});
