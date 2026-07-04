import { describe, expect, it } from "vitest";

import {
    containsChinese,
    containsLikelyMojibake,
    evaluateChecks,
    evaluateReactApp,
} from "./index.js";

describe("evaluateChecks", () => {
    it("passes when all checks pass", () => {
        const result = evaluateChecks([
            {
                name: "build passed",
                passed: true,
            },
            {
                name: "language matched",
                passed: true,
            },
        ]);

        expect(result).toEqual({
            passed: true,
            checks: [
                {
                    name: "build passed",
                    passed: true,
                },
                {
                    name: "language matched",
                    passed: true,
                },
            ],
        });
    });

    it("fails when any check fails", () => {
        const result = evaluateChecks([
            {
                name: "build passed",
                passed: true,
            },
            {
                name: "language matched",
                passed: false,
            },
        ]);

        expect(result.passed).toBe(false);
    });
});

describe("containsChinese", () => {
    it("returns true when text contains Chinese characters", () => {
        expect(containsChinese("我想要一个介绍温州的页面")).toBe(true);
    });

    it("returns false when text does not contain Chinese characters", () => {
        expect(containsChinese("Create an introduction page about Wenzhou")).toBe(
            false,
        );
    });

    it("returns false for undefined", () => {
        expect(containsChinese(undefined)).toBe(false);
    });
});

describe("containsLikelyMojibake", () => {
    it("detects common mojibake text", () => {
        expect(
            containsLikelyMojibake(
                "\u95b9\u5b58\u57b6\u934f\u509c\u61b0\u6d63\u98ce\ue071\u5a11\u64c3\u4e99\u7eee\u6b11\u7d12\u5ba5\u55d5\u520a\u7039\u54e5\u505f\u5a08\u6226\u60be\u5b80\u52ec\u6868",
            ),
        ).toBe(true);
    });

    it("does not flag normal Chinese text", () => {
        expect(
            containsLikelyMojibake(
                "\u6211\u60f3\u8981\u4e00\u4e2a\u4ecb\u7ecd\u6e29\u5dde\u7684\u754c\u9762",
            ),
        ).toBe(false);
    });
});

describe("evaluateReactApp", () => {
    it("passes when the source has input, button, and task rendering", () => {
        const result = evaluateReactApp({
            source: `
                export function App() {
                    const tasks = ["Learn TypeScript"];

                    return (
                        <div>
                            <input />
                            <button>Add Task</button>
                            <ul>
                                {tasks.map((task) => (
                                    <li>{task}</li>
                                ))}
                            </ul>
                        </div>
                    );
                }
            `,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toEqual([
            {
                name: "has readable text",
                passed: true,
            },
            {
                name: "has input",
                passed: true,
            },
            {
                name: "has button",
                passed: true,
            },
            {
                name: "has task rendering",
                passed: true,
            },
        ]);
    });

    it("fails when required task app elements are missing", () => {
        const result = evaluateReactApp({
            source: `
                export function App() {
                    return <h1>Hello</h1>;
                }
            `,
        });

        expect(result.passed).toBe(false);
        expect(result.checks).toEqual([
            {
                name: "has readable text",
                passed: true,
            },
            {
                name: "has input",
                passed: false,
            },
            {
                name: "has button",
                passed: false,
            },
            {
                name: "has task rendering",
                passed: false,
            },
        ]);
    });

    it("passes an introduction page without task rendering", () => {
        const result = evaluateReactApp({
            goal: "Create an introduction page about Wenzhou",
            source: `
                export function App() {
                    return (
                        <main>
                            <h1>Welcome to Wenzhou</h1>
                            <p>Wenzhou is a coastal city known for commerce, culture, and mountain scenery.</p>
                            <p>The page introduces local history, food, landmarks, and travel highlights.</p>
                        </main>
                    );
                }
            `,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toEqual([
            {
                name: "has readable text",
                passed: true,
            },
            {
                name: "has heading",
                passed: true,
            },
            {
                name: "has descriptive paragraphs",
                passed: true,
            },
            {
                name: "has enough page content",
                passed: true,
            },
        ]);
    });

    it("passes a Chinese introduction page when the generated UI is Chinese", () => {
        const result = evaluateReactApp({
            goal: "我想要一个介绍温州的页面",
            source: `
                export function App() {
                    return (
                        <main>
                            <h1>温州介绍</h1>
                            <p>温州是一座位于浙江东南沿海的城市，以商业活力、山水风光和地方美食闻名。</p>
                            <p>这个页面介绍温州的历史文化、江心屿、雁荡山、鱼丸、糯米饭和出行建议。</p>
                        </main>
                    );
                }
            `,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toEqual([
            {
                name: "has readable text",
                passed: true,
            },
            {
                name: "matches requested language",
                passed: true,
            },
            {
                name: "has heading",
                passed: true,
            },
            {
                name: "has descriptive paragraphs",
                passed: true,
            },
            {
                name: "has enough page content",
                passed: true,
            },
        ]);
    });

    it("fails a Chinese goal when the generated UI is English only", () => {
        const result = evaluateReactApp({
            goal: "我想要一个介绍温州的页面",
            source: `
                export function App() {
                    return (
                        <main>
                            <h1>Welcome to Wenzhou</h1>
                            <p>Wenzhou is a coastal city known for business, food, and mountain scenery.</p>
                            <p>This page introduces landmarks, local culture, travel ideas, and useful transport tips.</p>
                        </main>
                    );
                }
            `,
        });

        expect(result.passed).toBe(false);
        expect(result.checks).toContainEqual({
            name: "matches requested language",
            passed: false,
        });
    });

    it("fails an introduction page when it lacks content", () => {
        const result = evaluateReactApp({
            goal: "Create an introduction page about Wenzhou",
            source: `
                export function App() {
                    return <h1>Wenzhou</h1>;
                }
            `,
        });

        expect(result.passed).toBe(false);
        expect(result.checks).toEqual([
            {
                name: "has readable text",
                passed: true,
            },
            {
                name: "has heading",
                passed: true,
            },
            {
                name: "has descriptive paragraphs",
                passed: false,
            },
            {
                name: "has enough page content",
                passed: false,
            },
        ]);
    });

    it("fails when generated text appears garbled", () => {
        const result = evaluateReactApp({
            goal: "Create an introduction page about Wenzhou",
            source: `
                export function App() {
                    return (
                        <main>
                            <h1>娓╁窞浠嬬粛</h1>
                            <p>鎴戞兂瑕佷竴涓粙缁嶆俯宸炵殑鐣岄潰</p>
                        </main>
                    );
                }
            `,
        });

        expect(result.passed).toBe(false);
        expect(result.checks[0]).toEqual({
            name: "has readable text",
            passed: false,
        });
    });
});
