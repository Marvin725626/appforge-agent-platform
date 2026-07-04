import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWorkspacePath } from "./path-policy.js";

describe("resolveWorkspacePath", () => {
    const workspaceRoot = path.resolve("test-workspace");

    it("allows a path inside the workspace", () => {
        const result = resolveWorkspacePath(workspaceRoot, "src/App.tsx");

        expect(result).toBe(
            path.join(workspaceRoot, "src", "App.tsx"),
        );
    });

    it("rejects parent-directory traversal", () => {
        expect(() =>
            resolveWorkspacePath(workspaceRoot, "../secret.txt"),
        ).toThrow("Path escapes workspace root");
    });

    it("rejects an absolute path outside the workspace", () => {
        const outsidePath = path.resolve("outside", "secret.txt");

        expect(() =>
            resolveWorkspacePath(workspaceRoot, outsidePath),
        ).toThrow("Path escapes workspace root");
    });
});