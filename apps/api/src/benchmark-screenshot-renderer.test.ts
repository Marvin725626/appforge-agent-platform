import { describe, expect, it } from "vitest";

import {
    COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION,
    WAIT_FOR_BENCHMARK_FONTS_EXPRESSION,
} from "./benchmark-screenshot-renderer.js";

function compileExpression(expression: string): void {
    // Compile only. Browser globals are intentionally not executed in Node.
    new Function(`return (${expression});`);
}

describe("benchmark screenshot browser expressions", () => {
    it("uses self-contained string expressions instead of serialized functions", () => {
        expect(typeof WAIT_FOR_BENCHMARK_FONTS_EXPRESSION).toBe("string");
        expect(typeof COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION).toBe(
            "string",
        );
        expect(WAIT_FOR_BENCHMARK_FONTS_EXPRESSION).not.toContain("__name");
        expect(COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION).not.toContain(
            "__name",
        );
    });

    it("keeps both browser expressions valid JavaScript after tsx/esbuild loading", () => {
        expect(() =>
            compileExpression(WAIT_FOR_BENCHMARK_FONTS_EXPRESSION),
        ).not.toThrow();
        expect(() =>
            compileExpression(
                COLLECT_BENCHMARK_RUNTIME_FINGERPRINT_EXPRESSION,
            ),
        ).not.toThrow();
    });
});
