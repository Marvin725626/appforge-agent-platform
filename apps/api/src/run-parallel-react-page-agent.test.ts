import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
    PlannerOutput,
} from "@appforge/agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runParallelReactPageAgent } from "./run-parallel-react-page-agent.js";

type OwnedPath = "src/content.ts" | "src/App.css" | "src/App.tsx";

const OWNED_PATHS: readonly OwnedPath[] = [
    "src/content.ts",
    "src/App.css",
    "src/App.tsx",
];

const VALID_CONTENT = `export type SiteSection = {
    title: string;
    body: string;
};

export type SiteRoute = {
    id: string;
    path: string;
    label: string;
    eyebrow: string;
    title: string;
    description: string;
    sections: readonly SiteSection[];
};

export const siteContent = {
    brand: "温州印象",
    tagline: "山海相拥，古今相映",
    routes: [
        {
            id: "home",
            path: "/",
            label: "首页",
            eyebrow: "欢迎来到温州",
            title: "一座山水与烟火共同生长的城市",
            description: "从瓯江潮声到江心屿灯影，在真实城市故事中认识温州。",
            sections: [
                { title: "山水之城", body: "雁荡奇峰、楠溪清流与东海岛屿共同勾勒温州的自然轮廓。" },
                { title: "千年文脉", body: "永嘉学派、南戏故里与古村落延续着鲜明而开放的人文传统。" },
                { title: "温暖日常", body: "糯米饭、鱼丸和街巷茶馆，让旅程落到可感知的城市生活。" },
            ],
        },
        {
            id: "culture",
            path: "/culture",
            label: "文化",
            eyebrow: "瓯越文脉",
            title: "在戏曲与古村之间读懂温州",
            description: "循着南戏、瓯绣与书院的线索，理解城市长期形成的创造力。",
            sections: [
                { title: "南戏故里", body: "古老声腔在舞台与社区中持续焕发新的生命。" },
                { title: "手工艺", body: "瓯绣、瓯塑与细纹刻纸保留精巧的地方审美。" },
            ],
        },
        {
            id: "journey",
            path: "/journey",
            label: "行程",
            eyebrow: "慢游指南",
            title: "把山、江、海安排进三日旅程",
            description: "用清晰节奏连接城区人文、楠溪江古村与雁荡山景观。",
            sections: [
                { title: "第一日", body: "漫步五马街与江心屿，感受老城和瓯江夜色。" },
                { title: "第二日", body: "沿楠溪江探访古村，在山水之间放慢脚步。" },
                { title: "第三日", body: "登临雁荡山，以奇峰飞瀑结束旅程。" },
            ],
        },
    ],
    footer: "温州印象 · 为每一次真实抵达提供灵感",
} as const;
`;

const VALID_STYLES = `:root {
    --ink: #10233f;
    --muted: #52647b;
    --paper: #f7f3ea;
    --surface: #ffffff;
    --accent: #b83b2f;
    --line: rgba(16, 35, 63, 0.16);
    --radius: 1.25rem;
    font-family: Inter, "Noto Sans SC", system-ui, sans-serif;
    color: var(--ink);
    background: var(--paper);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 320px; overflow-x: hidden; background: var(--paper); }
a { color: inherit; }
.app-shell { min-height: 100vh; display: flex; flex-direction: column; }
.site-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 2rem; padding: 1rem clamp(1rem, 4vw, 4rem); background: rgba(247, 243, 234, 0.96); border-bottom: 1px solid var(--line); }
.brand-link { font-size: 1.25rem; font-weight: 800; text-decoration: none; letter-spacing: 0.08em; }
.site-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.nav-link { min-height: 44px; display: inline-flex; align-items: center; padding: 0.65rem 1rem; border-radius: 999px; color: var(--muted); text-decoration: none; }
.nav-link--active { color: white; background: var(--accent); }
.route-main { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; flex: 1; }
.hero { padding: clamp(4rem, 10vw, 8rem) 0 3rem; max-width: 850px; }
.eyebrow { color: var(--accent); font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
.hero h1 { margin: 0.6rem 0 1rem; font-size: clamp(2.5rem, 7vw, 5.6rem); line-height: 0.98; }
.hero p { color: var(--muted); font-size: clamp(1rem, 2vw, 1.25rem); line-height: 1.8; }
.route-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; padding-bottom: 5rem; }
.content-card { min-height: 220px; padding: 1.5rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: 0 16px 50px rgba(16, 35, 63, 0.08); }
.content-card h2 { margin-top: 0; }
.content-card p { color: var(--muted); line-height: 1.75; }
.site-footer { padding: 2rem clamp(1rem, 4vw, 4rem); color: var(--muted); border-top: 1px solid var(--line); }
.brand-link:focus-visible, .nav-link:focus-visible { outline: 3px solid #176b87; outline-offset: 3px; }

@media (max-width: 760px) {
    .site-header { align-items: flex-start; flex-direction: column; gap: 0.75rem; }
    .route-grid { grid-template-columns: 1fr; }
    .hero { padding-top: 3rem; }
}

@media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

const VALID_SHELL = `import React, { useEffect, useMemo, useState } from "react";
import { siteContent } from "./content.js";
import "./App.css";

function readRoutePath(): string {
    const path = window.location.hash.replace(/^#/, "");
    return path.startsWith("/") ? path : "/";
}

export function App() {
    const [routePath, setRoutePath] = useState<string>(readRoutePath);

    useEffect(() => {
        if (!window.location.hash) {
            window.location.hash = "#/";
        }
        const handleHashChange = () => setRoutePath(readRoutePath());
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    const route = useMemo(
        () => siteContent.routes.find((item) => item.path === routePath) ?? siteContent.routes[0],
        [routePath],
    );

    return (
        <div className="app-shell">
            <header className="site-header">
                <a className="brand-link" href="#/" aria-label={siteContent.tagline}>{siteContent.brand}</a>
                <nav className="site-nav" aria-label="主要导航">
                    {siteContent.routes.map((item) => (
                        <a
                            className={item.path === route.path ? "nav-link nav-link--active" : "nav-link"}
                            href={\`#\${item.path}\`}
                            aria-current={item.path === route.path ? "page" : undefined}
                            key={item.id}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>
            </header>
            <main className="route-main">
                <section className="hero">
                    <span className="eyebrow">{route.eyebrow}</span>
                    <h1>{route.title}</h1>
                    <p>{route.description}</p>
                </section>
                <section className="route-grid" aria-label={route.title}>
                    {route.sections.map((section) => (
                        <article className="content-card" key={section.title}>
                            <h2>{section.title}</h2>
                            <p>{section.body}</p>
                        </article>
                    ))}
                </section>
            </main>
            <footer className="site-footer">{siteContent.footer}</footer>
        </div>
    );
}
`;

const VALID_ARTIFACT_CONTENT: Record<OwnedPath, string> = {
    "src/content.ts": VALID_CONTENT,
    "src/App.css": VALID_STYLES,
    "src/App.tsx": VALID_SHELL,
};

const PLANNER_OUTPUT: PlannerOutput = {
    summary: "并行构建温州内容、视觉系统和路由外壳",
    steps: [
        {
            id: "step-1",
            title: "生成三个互相独立的页面文件",
            description: "分别完成内容、样式与路由渲染。",
            acceptanceCriteria: ["三个文件符合共享契约"],
        },
    ],
    workstreams: [
        {
            id: "content",
            role: "content",
            task: "编写真实温州内容和三条路线",
            acceptanceCriteria: ["包含首页、文化和行程路线"],
        },
        {
            id: "styles",
            role: "styles",
            task: "编写完整响应式视觉系统",
            acceptanceCriteria: ["桌面和移动端均清晰可用"],
        },
        {
            id: "shell",
            role: "shell",
            task: "编写可深链的 URL 路由外壳",
            acceptanceCriteria: ["支持 hashchange 和活动导航状态"],
        },
    ],
};

function findOwnedPath(request: ModelRequest): OwnedPath {
    const prompt = request.messages.map((message) => message.content).join("\n");
    const match = /Owned file:\s*(src\/(?:content\.ts|App\.css|App\.tsx))/u.exec(
        prompt,
    );
    const ownedPath = match?.[1];

    if (!OWNED_PATHS.includes(ownedPath as OwnedPath)) {
        throw new Error(`Request did not identify a known owned file: ${prompt}`);
    }

    return ownedPath as OwnedPath;
}

function artifactResponse(
    path: OwnedPath,
    options: {
        actualPath?: string;
        content?: string;
        summary?: string;
    } = {},
): ModelResponse {
    return {
        content: JSON.stringify({
            path: options.actualPath ?? path,
            content: options.content ?? VALID_ARTIFACT_CONTENT[path],
            summary: options.summary ?? `完成 ${path}`,
        }),
    };
}

type ProviderCall = {
    path: OwnedPath;
    attempt: number;
    request: ModelRequest;
};

class OwnedFileModelProvider implements ModelProvider {
    readonly calls = new Map<OwnedPath, number>();
    readonly observedSignals: AbortSignal[] = [];
    activeCalls = 0;
    maxActiveCalls = 0;

    constructor(
        private readonly respond: (
            call: ProviderCall,
        ) => Promise<ModelResponse> | ModelResponse,
    ) {}

    async complete(request: ModelRequest): Promise<ModelResponse> {
        const ownedPath = findOwnedPath(request);
        const attempt = (this.calls.get(ownedPath) ?? 0) + 1;
        this.calls.set(ownedPath, attempt);

        if (request.signal) {
            this.observedSignals.push(request.signal);
        }

        this.activeCalls += 1;
        this.maxActiveCalls = Math.max(
            this.maxActiveCalls,
            this.activeCalls,
        );

        try {
            return await this.respond({
                path: ownedPath,
                attempt,
                request,
            });
        } finally {
            this.activeCalls -= 1;
        }
    }

    count(path: OwnedPath): number {
        return this.calls.get(path) ?? 0;
    }
}

function createGate(): {
    promise: Promise<void>;
    release: () => void;
} {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });

    return { promise, release };
}

describe("runParallelReactPageAgent", () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.map((directory) =>
                rm(directory, { recursive: true, force: true }),
            ),
        );
        temporaryDirectories.length = 0;
    });

    async function createWorkspace(): Promise<string> {
        const workspaceRoot = await mkdtemp(
            path.join(os.tmpdir(), "appforge-parallel-page-test-"),
        );
        temporaryDirectories.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
        return workspaceRoot;
    }

    async function writeStarterFiles(workspaceRoot: string): Promise<void> {
        await Promise.all([
            writeFile(
                path.join(workspaceRoot, "src", "content.ts"),
                "starter content",
                "utf8",
            ),
            writeFile(
                path.join(workspaceRoot, "src", "App.css"),
                "starter styles",
                "utf8",
            ),
            writeFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                "starter shell",
                "utf8",
            ),
        ]);
    }

    async function readGeneratedFiles(
        workspaceRoot: string,
    ): Promise<Record<OwnedPath, string>> {
        const entries = await Promise.all(
            OWNED_PATHS.map(async (filePath) => [
                filePath,
                await readFile(path.join(workspaceRoot, filePath), "utf8"),
            ] as const),
        );

        return Object.fromEntries(entries) as Record<OwnedPath, string>;
    }

    it("runs at most two model calls concurrently and starts the third while another is active", async () => {
        const workspaceRoot = await createWorkspace();
        const gates = new Map(
            OWNED_PATHS.map((filePath) => [filePath, createGate()] as const),
        );
        const provider = new OwnedFileModelProvider(async ({ path: filePath }) => {
            await gates.get(filePath)?.promise;
            return artifactResponse(filePath);
        });
        const execution = runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        try {
            await vi.waitFor(() => {
                expect(provider.activeCalls).toBe(2);
                expect(provider.maxActiveCalls).toBe(2);
                expect(provider.count("src/App.tsx")).toBe(0);
            });

            gates.get("src/content.ts")?.release();

            await vi.waitFor(() => {
                expect(provider.count("src/App.tsx")).toBe(1);
                expect(provider.activeCalls).toBe(2);
            });

            expect(provider.maxActiveCalls).toBe(2);
        } finally {
            for (const gate of gates.values()) {
                gate.release();
            }
        }

        const result = await execution;
        expect(result.agent.finished).toBe(true);
        expect(provider.maxActiveCalls).toBe(2);
    });

    it("does not mutate the canonical workspace before all artifacts pass and returns no steps when one keeps failing", async () => {
        const workspaceRoot = await createWorkspace();
        await writeStarterFiles(workspaceRoot);
        const baseline = await readGeneratedFiles(workspaceRoot);
        const finalShellAttempt = createGate();
        const provider = new OwnedFileModelProvider(
            async ({ path: filePath, attempt }) => {
                if (filePath !== "src/App.tsx") {
                    return artifactResponse(filePath);
                }

                if (attempt === 2) {
                    await finalShellAttempt.promise;
                }

                return artifactResponse(filePath, {
                    content: "export function App() { return null; }",
                    summary: "不完整的外壳",
                });
            },
        );
        const execution = runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        await vi.waitFor(() => {
            expect(provider.count("src/App.tsx")).toBe(2);
        });
        expect(await readGeneratedFiles(workspaceRoot)).toEqual(baseline);

        finalShellAttempt.release();
        const result = await execution;

        expect(result.agent).toMatchObject({
            steps: [],
            finished: false,
            stopReason: "model_error",
        });
        expect(await readGeneratedFiles(workspaceRoot)).toEqual(baseline);
        expect(provider.count("src/content.ts")).toBe(1);
        expect(provider.count("src/App.css")).toBe(1);
        expect(provider.count("src/App.tsx")).toBe(2);
    });

    it("writes exactly the validated content, styles, and shell before finishing", async () => {
        const workspaceRoot = await createWorkspace();
        await writeStarterFiles(workspaceRoot);
        const provider = new OwnedFileModelProvider(({ path: filePath }) =>
            artifactResponse(filePath),
        );

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(await readGeneratedFiles(workspaceRoot)).toEqual(
            VALID_ARTIFACT_CONTENT,
        );
        expect(result.agent).toMatchObject({
            finished: true,
            stopReason: "finish",
        });
        expect(result.agent.steps.map((step) => step.action.type)).toEqual([
            "write_file",
            "write_file",
            "write_file",
            "finish",
        ]);
        expect(
            result.agent.steps
                .flatMap((step) =>
                    step.action.type === "write_file"
                        ? [step.action.path]
                        : [],
                ),
        ).toEqual(OWNED_PATHS);
        expect(result.workstreams).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "content", status: "succeeded" }),
                expect.objectContaining({ id: "styles", status: "succeeded" }),
                expect.objectContaining({ id: "shell", status: "succeeded" }),
            ]),
        );
    });

    it("corrects a wrong artifact path without retrying successful workers", async () => {
        const workspaceRoot = await createWorkspace();
        const provider = new OwnedFileModelProvider(
            ({ path: filePath, attempt }) => {
                if (filePath === "src/content.ts" && attempt === 1) {
                    return artifactResponse(filePath, {
                        actualPath: "src/App.tsx",
                    });
                }

                return artifactResponse(filePath);
            },
        );

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("src/content.ts")).toBe(2);
        expect(provider.count("src/App.css")).toBe(1);
        expect(provider.count("src/App.tsx")).toBe(1);
    });

    it("retries only the worker whose artifact fails semantic validation", async () => {
        const workspaceRoot = await createWorkspace();
        const provider = new OwnedFileModelProvider(
            ({ path: filePath, attempt }) => {
                if (filePath === "src/App.css" && attempt === 1) {
                    return artifactResponse(filePath, {
                        content: ".app-shell { display: block; }",
                        summary: "过小的样式文件",
                    });
                }

                return artifactResponse(filePath);
            },
        );

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("src/content.ts")).toBe(1);
        expect(provider.count("src/App.css")).toBe(2);
        expect(provider.count("src/App.tsx")).toBe(1);
        expect(
            result.workstreams.find((stream) => stream.id === "styles"),
        ).toMatchObject({
            generationAttempts: 2,
            status: "succeeded",
        });
    });

    it("retries only the shell when it initially uses a default content import", async () => {
        const workspaceRoot = await createWorkspace();
        const shellWithDefaultImport = VALID_SHELL.replace(
            'import { siteContent } from "./content.js";',
            'import siteContent from "./content.js";',
        );
        const provider = new OwnedFileModelProvider(
            ({ path: filePath, attempt }) => {
                if (filePath === "src/App.tsx" && attempt === 1) {
                    return artifactResponse(filePath, {
                        content: shellWithDefaultImport,
                        summary: "外壳错误地使用了默认导入",
                    });
                }

                return artifactResponse(filePath);
            },
        );

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("src/content.ts")).toBe(1);
        expect(provider.count("src/App.css")).toBe(1);
        expect(provider.count("src/App.tsx")).toBe(2);
        expect(
            result.workstreams.find((stream) => stream.id === "shell"),
        ).toMatchObject({
            generationAttempts: 2,
            status: "succeeded",
        });

        const writtenShell = await readFile(
            path.join(workspaceRoot, "src", "App.tsx"),
            "utf8",
        );
        expect(writtenShell).toBe(VALID_SHELL);
        expect(writtenShell).toContain(
            'import { siteContent } from "./content.js";',
        );
        expect(writtenShell).not.toContain(
            'import siteContent from "./content.js";',
        );
    });

    it("retries only the shell when hash changes do not select a route", async () => {
        const workspaceRoot = await createWorkspace();
        const shellWithoutRouteSelection = VALID_SHELL.replace(
            "siteContent.routes.find((item) => item.path === routePath) ?? siteContent.routes[0]",
            "siteContent.routes[0]",
        );
        const provider = new OwnedFileModelProvider(
            ({ path: filePath, attempt }) => {
                if (filePath === "src/App.tsx" && attempt === 1) {
                    return artifactResponse(filePath, {
                        content: shellWithoutRouteSelection,
                        summary: "监听了 URL，但始终渲染首页",
                    });
                }

                return artifactResponse(filePath);
            },
        );

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
        });

        expect(result.agent.finished).toBe(true);
        expect(provider.count("src/content.ts")).toBe(1);
        expect(provider.count("src/App.css")).toBe(1);
        expect(provider.count("src/App.tsx")).toBe(2);
        expect(
            await readFile(
                path.join(workspaceRoot, "src", "App.tsx"),
                "utf8",
            ),
        ).toBe(VALID_SHELL);
    });

    it("enforces one absolute deadline across structured repair and retry", async () => {
        const workspaceRoot = await createWorkspace();
        await writeStarterFiles(workspaceRoot);
        const before = await readGeneratedFiles(workspaceRoot);
        const provider = new OwnedFileModelProvider(
            () => new Promise<ModelResponse>(() => undefined),
        );
        const startedAt = Date.now();

        const result = await runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
            workstreamTimeoutMs: 100,
        });

        expect(Date.now() - startedAt).toBeLessThan(700);
        expect(result.agent).toMatchObject({
            steps: [],
            finished: false,
            stopReason: "model_error",
        });
        expect(provider.count("src/content.ts")).toBe(1);
        expect(provider.count("src/App.css")).toBe(1);
        expect(provider.count("src/App.tsx")).toBe(1);
        expect(await readGeneratedFiles(workspaceRoot)).toEqual(before);
    });

    it("propagates an external abort signal to active model requests", async () => {
        const workspaceRoot = await createWorkspace();
        const controller = new AbortController();
        const provider = new OwnedFileModelProvider(
            ({ request }) =>
                new Promise<ModelResponse>((_resolve, reject) => {
                    const signal = request.signal;

                    if (!signal) {
                        reject(new Error("Expected a workstream signal"));
                        return;
                    }

                    const rejectWithSignalReason = () => reject(signal.reason);

                    if (signal.aborted) {
                        rejectWithSignalReason();
                        return;
                    }

                    signal.addEventListener(
                        "abort",
                        rejectWithSignalReason,
                        { once: true },
                    );
                }),
        );
        const execution = runParallelReactPageAgent({
            goal: "创建可跳转的完整温州介绍页面",
            plannerOutput: PLANNER_OUTPUT,
            model: provider,
            workspaceRoot,
            routeRequest: true,
            maxConcurrency: 2,
            signal: controller.signal,
        });

        await vi.waitFor(() => {
            expect(provider.activeCalls).toBe(2);
        });

        const reason = new DOMException("cancelled by test", "AbortError");
        controller.abort(reason);

        await expect(execution).rejects.toBe(reason);
        expect(provider.observedSignals).toHaveLength(2);
        expect(
            provider.observedSignals.every(
                (signal) => signal.aborted && signal.reason === reason,
            ),
        ).toBe(true);
        expect(provider.count("src/App.tsx")).toBe(0);
    });
});
