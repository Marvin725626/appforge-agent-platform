import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    containsChinese,
    containsLikelyMojibake,
    createBrowserRuntimeChecks,
    createDashboardAboveFoldChecks,
    evaluateChecks,
    evaluateReactApp,
    isAdvisoryVisualBrowserCheckName,
    isIndependentPageNavigationGoal,
    isNavigationBrowserGoal,
    isVisualPageQualityGoal,
    PlaywrightBrowserEvaluator,
    summarizeBrowserEval,
} from "./index.js";

function createDataPage(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const testServers: Server[] = [];

afterEach(async () => {
    await Promise.all(
        testServers.splice(0).map(
            (server) =>
                new Promise<void>((resolve, reject) => {
                    server.close((error) => {
                        if (error) {
                            reject(error);
                            return;
                        }

                        resolve();
                    });
                }),
        ),
    );
});

async function createHttpPage(html: string): Promise<string> {
    const server = createServer((_request, response) => {
        response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    testServers.push(server);

    const address = server.address() as AddressInfo;

    return `http://127.0.0.1:${address.port}`;
}


describe("visual page quality goal detection", () => {
    it.each([
        "创建一个服务器运行监控后台",
        "创建一个运维工作台",
        "生成管理控制台",
        "Build an operations workspace",
        "Build a back-office console",
    ])("enables multi-viewport quality for %s", (goal) => {
        expect(isVisualPageQualityGoal(goal)).toBe(true);
    });

    it("does not enable page visual quality for a non-UI coding task", () => {
        expect(isVisualPageQualityGoal("编写一个排序算法")).toBe(false);
    });
});

describe("dashboard above-fold visual contract", () => {
    it("passes a data-first operational overview", () => {
        const checks = createDashboardAboveFoldChecks(
            "创建一个服务器运行监控后台",
            {
                overviewVisible: true,
                metricVisibility: {
                    cpu: true,
                    memory: true,
                    latency: true,
                },
                dominantMediaRatio: 0,
            },
        );

        expect(checks).toHaveLength(3);
        expect(checks.every((check) => check.passed)).toBe(true);
        expect(
            checks.every((check) =>
                isAdvisoryVisualBrowserCheckName(check.name),
            ),
        ).toBe(true);
    });

    it("rejects a dashboard whose first viewport is a marketing hero", () => {
        const checks = createDashboardAboveFoldChecks(
            "创建一个服务器运行监控后台",
            {
                overviewVisible: false,
                metricVisibility: {
                    cpu: false,
                    memory: false,
                    latency: false,
                },
                dominantMediaRatio: 0.46,
            },
        );

        expect(checks.every((check) => !check.passed)).toBe(true);
        expect(checks[1]?.message).toContain("CPU=below fold or missing");
        expect(checks[2]?.message).toContain("46.0%");
    });

    it("does not apply dashboard contracts to product pages", () => {
        expect(
            createDashboardAboveFoldChecks("创建一个 AI 产品官网", {
                overviewVisible: false,
                metricVisibility: {
                    cpu: false,
                    memory: false,
                    latency: false,
                },
                dominantMediaRatio: 0.6,
            }),
        ).toEqual([]);
    });
});

describe("PlaywrightBrowserEvaluator browser lifecycle", () => {
    it("bounds a launch that never settles with a hard deadline", async () => {
        vi.useFakeTimers();

        try {
            const evaluator = new PlaywrightBrowserEvaluator(
                () => new Promise<Browser>(() => undefined),
            );
            const evaluation = evaluator.evaluate({
                url: createDataPage('<div id="root">unreachable</div>'),
                timeoutMs: 30,
            });
            const rejection = expect(evaluation).rejects.toMatchObject({
                name: "TimeoutError",
                message: "Browser launch timed out after 5000ms.",
            });

            await vi.advanceTimersByTimeAsync(5_000);
            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });

    it("immediately rejects an in-flight launch with the original abort reason", async () => {
        const controller = new AbortController();
        const abortReason = new Error("user cancelled browser evaluation");
        const evaluator = new PlaywrightBrowserEvaluator(
            () => new Promise<Browser>(() => undefined),
        );
        const evaluation = evaluator.evaluate({
            url: createDataPage('<div id="root">unreachable</div>'),
            timeoutMs: 5_000,
            signal: controller.signal,
        });

        controller.abort(abortReason);

        await expect(evaluation).rejects.toBe(abortReason);
    });

    it("closes a browser that resolves after launch already timed out", async () => {
        vi.useFakeTimers();

        try {
            let resolveLaunch: ((browser: Browser) => void) | undefined;
            const launch = new Promise<Browser>((resolve) => {
                resolveLaunch = resolve;
            });
            const close = vi.fn(async () => undefined);
            const lateBrowser = {
                close,
            } as unknown as Browser;
            const evaluator = new PlaywrightBrowserEvaluator(() => launch);
            const evaluation = evaluator.evaluate({
                url: createDataPage('<div id="root">unreachable</div>'),
                timeoutMs: 30,
            });
            const rejection = expect(evaluation).rejects.toMatchObject({
                name: "TimeoutError",
            });

            await vi.advanceTimersByTimeAsync(5_000);
            await rejection;
            resolveLaunch?.(lateBrowser);
            await vi.advanceTimersByTimeAsync(0);

            expect(close).toHaveBeenCalledOnce();
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not let a hanging browser close mask the evaluation failure", async () => {
        const pageFailure = new Error("new page failed");
        const close = vi.fn(() => new Promise<void>(() => undefined));
        const browser = {
            newPage: vi.fn(async () => {
                throw pageFailure;
            }),
            close,
        } as unknown as Browser;
        const evaluator = new PlaywrightBrowserEvaluator(async () => browser);
        const startedAt = Date.now();

        const result = await evaluator.evaluate({
            url: createDataPage('<div id="root">unreachable</div>'),
            timeoutMs: 30,
        });

        expect(Date.now() - startedAt).toBeLessThan(500);
        expect(close).toHaveBeenCalledOnce();
        expect(result.passed).toBe(false);
        expect(result.checks).toContainEqual({
            name: "browser evaluation completed",
            passed: false,
            message: pageFailure.message,
        });
    });
});

describe("PlaywrightBrowserEvaluator runtime gate", () => {
    it("accepts a populated React root without runtime errors", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(
                '<div id="root"><main><h1>Working page</h1></main></div>',
            ),
            goal: "Verify that the React root renders content",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "application root renders",
            passed: true,
        });
        expect(result.checks).toContainEqual({
            name: "has no runtime errors",
            passed: true,
        });
        expect(result.checks).toContainEqual({
            name: "has visible main content",
            passed: true,
        });
    }, 15_000);


    it("uses the first visible selector match for browser probes", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <style>
                    .probe-target:first-of-type { display: none; }
                    .probe-target:last-of-type { display: block; }
                </style>
                <div id="root">
                    <main>
                        <div class="probe-target">hidden</div>
                        <div class="probe-target">visible</div>
                    </main>
                </div>

<script data-v94228-root-main-fixture>
  (() => {
    const root = document.querySelector("#root");
    if (!root || root.querySelector("[data-v94228-root-main-fixture]")) {
      return;
    }

    const main = document.createElement("main");
    main.setAttribute("data-v94228-root-main-fixture", "");
    main.style.minWidth = "24px";
    main.style.minHeight = "24px";
    main.textContent = "Runtime probe fixture";
    root.append(main);
  })();
</script>
`),
            goal: "Verify a visible probe target",
            probes: [
                {
                    requirementId: "REQ-1",
                    selector: ".probe-target",
                    viewport: { width: 390, height: 844 },
                    measurement: "visibility",
                    expected: true,
                },
            ],
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual(
            expect.objectContaining({
                name: "browser probe REQ-1: .probe-target visibility",
                passed: true,
            }),
        );
    }, 15_000);

    it("rejects logo text that blends into its background", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <style>
                    body { background: white; }
                    .brand-logo { color: white; background: white; font-size: 28px; }
                </style>
                <div id="root">
                    <header><a class="brand-logo" href="#/home">Tsinghua</a></header>
                    <main><h1>University home page</h1><p>Campus introduction.</p></main>
                </div>
            `),
            goal: "Build a polished university homepage",
            timeoutMs: 2_000,
        });
        const brandCheck = result.checks.find(
            (check) => check.name === "brand mark remains visible",
        );

        expect(result.passed).toBe(false);
        expect(brandCheck?.passed).toBe(false);
        expect(brandCheck?.message).toContain("contrast");
    }, 15_000);

    it("rejects complex pages that overflow a mobile viewport", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <main style="width: 900px"><h1>Dashboard</h1><p>Wide fixed layout.</p></main>
                </div>
            `),
            goal: "Build a complex dashboard page",
            timeoutMs: 2_000,
        });
        const mobileCheck = result.checks.find(
            (check) => check.name === "fits a mobile viewport",
        );

        expect(result.passed).toBe(false);
        expect(mobileCheck?.passed).toBe(false);
        expect(mobileCheck?.message).toContain("390px");
    }, 15_000);

    it("rejects an unstyled sparse site whose child routes are placeholders", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <style>
                    :root { color: #172033; background: #f4f7fb; font-family: Inter, system-ui, sans-serif; }
                    body { margin: 0; }
                    /* These are valid authored styles, but their component
                       selectors belong to the starter and match nothing in
                       the newly generated DOM below. */
                    .app-shell { display: grid; min-height: 100vh; place-items: center; padding: 32px; }
                    .hero-card { max-width: 720px; border: 1px solid #dbe4f0; border-radius: 24px; background: white; padding: 48px; }
                    .eyebrow { color: #2563eb; font-weight: 700; }
                    h1 { margin: 0 0 16px; font-size: clamp(2.2rem, 6vw, 4.5rem); line-height: 1; }
                    p { font-size: 1.1rem; line-height: 1.7; }
                </style>
                <div id="root">
                    <div class="app">
                        <header class="nav">
                            <a class="brand" href="#/home">温州 Wenzhou</a>
                            <nav>
                                <ul class="nav-list">
                                    <li><a class="nav-link" href="#/home">首页</a></li>
                                    <li><a class="nav-link" href="#/culture">文化底蕴</a></li>
                                    <li><a class="nav-link" href="#/food">瓯越美食</a></li>
                                    <li><a class="nav-link" href="#/travel">风景名胜</a></li>
                                    <li><a class="nav-link" href="#/contact">联系我们</a></li>
                                </ul>
                            </nav>
                        </header>
                        <main></main>
                        <footer class="foot">© 温州介绍 · 欢迎您</footer>
                    </div>
                </div>
                <script>
                    const pages = {
                        '#/home': '<section class="hero"><h1>温州 · 东瓯名镇</h1><p>山水斗城，百工之乡，民营经济之都。</p><a class="btn" href="#/travel">探索风景名胜</a></section><section class="cards"><a class="card" href="#/culture"><h3>文化</h3><p>永嘉学派、南戏故里、江心屿诗岛。</p></a><a class="card" href="#/food"><h3>美食</h3><p>鱼圆、糯米饭、灯盏糕，瓯味十足。</p></a><a class="card" href="#/travel"><h3>风光</h3><p>雁荡山、楠溪江、洞头列岛。</p></a></section>',
                        '#/culture': '<section><h2>文化底蕴</h2><p>永嘉学派、南戏故里、瓯绣工艺和江心屿诗路构成温州文化的主轴，这里本应展开独立叙事与路线说明。</p><p>内容建设中……</p></section>',
                        '#/food': '<h2>瓯越美食</h2><p>内容建设中……</p>',
                        '#/travel': '<h2>风景名胜</h2><p>内容建设中……</p>',
                        '#/contact': '<h2>联系我们</h2><p>内容建设中……</p>'
                    };
                    const renderRoute = () => {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || pages['#/home'];
                    };
                    window.addEventListener('hashchange', renderRoute);
                    if (!window.location.hash.startsWith('#/')) {
                        history.replaceState(null, '', '#/home');
                    }
                    renderRoute();
                </script>
            `),
            goal: "我想要一个介绍城市的完整网站，并且可以在多个独立页面之间跳转",
            timeoutMs: 2_000,
        });
        const routeContentCheck = result.checks.find(
            (check) =>
                check.name ===
                "independent routes have substantive unique content",
        );
        const stylingCheck = result.checks.find(
            (check) => check.name === "visual page has authored styling",
        );
        const completenessCheck = result.checks.find(
            (check) =>
                check.name === "visual page has sufficient content structure",
        );

        expect(result.passed).toBe(false);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 4 distinct independent route target(s): 文化底蕴, 瓯越美食, 风景名胜, 联系我们.",
        });
        expect(routeContentCheck?.passed).toBe(false);
        expect(routeContentCheck?.message).toContain(
            "文化底蕴 contains placeholder",
        );
        expect(routeContentCheck?.message).toContain("内容建设中");
        expect(completenessCheck?.passed).toBe(false);
        expect(completenessCheck?.message).toContain("2 substantive regions");
        expect(stylingCheck?.passed).toBe(false);
        expect(stylingCheck?.message).toContain("default blue underlined");
    }, 15_000);

    it("rejects obvious placeholder copy on an otherwise styled visual page", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <style>
                    body { margin: 0; font-family: system-ui; background: #eef4ff; }
                    main { max-width: 900px; margin: auto; padding: 48px; }
                    section { margin-top: 20px; padding: 24px; border-radius: 18px; background: white; }
                </style>
                <div id="root">
                    <main>
                        <section><h1>Studio journal</h1><p>A considered collection of product stories, field research, and practical design notes for creative teams.</p></section>
                        <section><h2>Latest release</h2><p>Coming soon</p></section>
                        <section><h2>Archive</h2><p>Browse long-form interviews and detailed process reports from previous seasons.</p></section>
                    </main>
                </div>
            `),
            goal: "Build a polished studio homepage",
            timeoutMs: 2_000,
        });
        const placeholderCheck = result.checks.find(
            (check) => check.name === "contains no placeholder page content",
        );

        expect(result.passed).toBe(false);
        expect(placeholderCheck?.passed).toBe(false);
        expect(placeholderCheck?.message).toContain("coming soon");
    }, 15_000);

    it("allows an explicitly minimal single-screen page to stay intentionally sparse", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <main><h1>Field notes</h1><p>A quiet introduction for a focused reading experience.</p></main>
                </div>
            `),
            goal: "Create a minimal single-screen introduction page",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(
            result.checks.some(
                (check) =>
                    check.name ===
                    "visual page has sufficient content structure",
            ),
        ).toBe(false);
        expect(
            result.checks.some(
                (check) => check.name === "visual page has authored styling",
            ),
        ).toBe(false);
        expect(result.checks).toContainEqual({
            name: "contains no placeholder page content",
            passed: true,
        });
    }, 15_000);

    it("accepts a compact editor page with real matched layout styles", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <style>
                    * { box-sizing: border-box; }
                    body { margin: 0; font-family: system-ui, sans-serif; background: #eef2f7; }
                    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
                    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #172033; }
                    .brand { color: white; font-weight: 800; }
                    .editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 14px; }
                    .panel { min-width: 0; padding: 18px; border: 1px solid #cbd5e1; border-radius: 14px; background: white; }
                    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
                    textarea { width: 100%; min-height: 120px; }
                    @media (max-width: 600px) { .editor { grid-template-columns: 1fr; } }
                </style>
                <div id="root">
                    <div class="shell">
                        <header><span class="brand">Forge Editor</span><button type="button">Run preview</button></header>
                        <main class="editor">
                            <section class="panel"><h2>Project files</h2><p>Browse components, routes, styles, and reusable assets in the current workspace.</p><button type="button">Create file</button></section>
                            <section class="panel"><h2>Source editor</h2><p>Edit the selected module with syntax-aware controls and a focused writing surface.</p><textarea aria-label="Source code">export function App() { return null; }</textarea></section>
                            <section class="panel"><h2>Live preview</h2><p>Review the responsive result and inspect the active route before publishing changes.</p><div class="toolbar"><button type="button">Mobile</button><button type="button">Desktop</button></div></section>
                            <section class="panel"><h2>Quality results</h2><p>Track build, accessibility, navigation, and browser checks for the latest revision.</p><button type="button">Run checks</button></section>
                        </main>
                    </div>
                </div>
            
<style data-v94227-control-targets>
  button,
  [role="button"],
  input[type="button"],
  input[type="submit"] {
    min-width: 32px;
    min-height: 32px;
  }
</style>
`),
            goal: "Build a compact browser code editor page",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "visual page has sufficient content structure",
            passed: true,
        });
        expect(result.checks).toContainEqual({
            name: "visual page has authored styling",
            passed: true,
        });
    }, 15_000);

    it("rejects console errors and uncaught page exceptions", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root"><main><h1>Broken page</h1></main></div>
                <script>
                    console.error("Objects are not valid as a React child ({title,date})");
                    setTimeout(() => { throw new Error("uncaught render failure"); }, 0);
                    Promise.reject(new Error("unhandled promise rejection"));
                </script>
            `),
            goal: "Create an introduction page",
            timeoutMs: 2_000,
        });
        const runtimeCheck = result.checks.find(
            (check) => check.name === "has no runtime errors",
        );

        expect(result.passed).toBe(false);
        expect(runtimeCheck?.passed).toBe(false);
        expect(runtimeCheck?.message).toContain(
            "Objects are not valid as a React child",
        );
        expect(runtimeCheck?.message).toContain("uncaught render failure");
        expect(runtimeCheck?.message).toContain("unhandled promise rejection");
    }, 15_000);

    it("rejects a page whose application root stays empty", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(
                '<div id="root"></div><aside>Development overlay text outside the app root</aside>',
            ),
            goal: "Create an introduction page",
            timeoutMs: 300,
        });

        expect(result.passed).toBe(false);
        expect(result.checks).toContainEqual({
            name: "application root renders",
            passed: false,
            message: "The #root element remained empty after the page loaded.",
        });
    }, 15_000);

    it("rejects a populated root without visible main content", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(
                '<div id="root"><main style="display:none"><h1>Hidden page</h1></main></div>',
            ),
            goal: "Verify visible main page content",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(false);
        expect(result.checks).toContainEqual({
            name: "has visible main content",
            passed: false,
            message:
                "The application root did not contain a visible main, section, article, h1, or substantial root child with a usable bounding box.",
        });
    }, 15_000);

    it("follows a real non-placeholder internal hash link for navigation goals", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav>
                        <a href="#">Placeholder</a>
                        <a href="#about">About</a>
                    </nav>
                    <main>
                        <h1>Home</h1>
                        <section id="about">About the university</section>
                    </main>
                </div>
            `),
            goal: "让导航可以跳转到同页对应区域",
            timeoutMs: 2_000,
        });

        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message: 'Activated "About" and observed a path or hash change.',
        });
        expect(result.passed).toBe(true);
    }, 15_000);

    it("rejects href hash placeholders for navigation goals", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <nav><a href="#">About</a></nav>
                    <main><h1>Home</h1><p>Homepage content stays here.</p></main>
                </div>
            `),
            goal: "Make the navigation link open the About page",
            timeoutMs: 1_000,
        });
        const navigationCheck = result.checks.find(
            (check) => check.name === "internal navigation works",
        );

        expect(result.passed).toBe(false);
        expect(navigationCheck?.passed).toBe(false);
        expect(navigationCheck?.message).toContain('href="#"');
    }, 15_000);

    it("does not accept a hash change when the fragment target is missing", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav><a href="#missing">Missing section</a></nav>
                    <main><h1>Home</h1><p>Unchanged homepage content.</p></main>
                </div>
            `),
            goal: "Make the navigation jump to the matching page section",
            timeoutMs: 1_500,
        });
        const navigationCheck = result.checks.find(
            (check) => check.name === "internal navigation works",
        );

        expect(result.passed).toBe(false);
        expect(navigationCheck?.passed).toBe(false);
        expect(navigationCheck?.message).toContain("none changed");
    }, 15_000);

    it("rejects a fake hash route that changes only the URL", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav><a href="#/about">About</a></nav>
                    <main><h1>Home</h1><p>The same static homepage remains visible.</p></main>
                </div>
            `),
            goal: "Use routes to navigate between pages",
            timeoutMs: 2_000,
        });
        const navigationCheck = result.checks.find(
            (check) => check.name === "internal navigation works",
        );

        expect(result.passed).toBe(false);
        expect(navigationCheck?.passed).toBe(false);
        expect(navigationCheck?.message).toContain(
            "must change both the URL path/hash and the main page content",
        );
    }, 15_000);

    it("rejects routes that only change the heading above repeated body copy", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav>
                        <a href="#/about">About</a>
                        <a href="#/services">Services</a>
                    </nav>
                    <main></main>
                </div>
                <script>
                    const pages = {
                        '#/home': '<h1>Home</h1><p>Read our original research, recent work, and practical guides for product teams.</p>',
                        '#/about': '<h1>About</h1><p>Explore thoughtful stories and useful information prepared for every visitor.</p>',
                        '#/services': '<h1>Services</h1><p>Explore thoughtful stories and useful information prepared for every visitor.</p>'
                    };
                    const renderRoute = () => {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || pages['#/home'];
                    };
                    window.addEventListener('hashchange', renderRoute);
                    if (!window.location.hash.startsWith('#/')) {
                        history.replaceState(null, '', '#/home');
                    }
                    renderRoute();
                </script>
            `),
            goal: "Use routes to navigate between pages",
            timeoutMs: 2_000,
        });
        const contentCheck = result.checks.find(
            (check) =>
                check.name ===
                "independent routes have substantive unique content",
        );

        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 2 distinct independent route target(s): About, Services.",
        });
        expect(result.passed).toBe(false);
        expect(contentCheck?.passed).toBe(false);
        expect(contentCheck?.message).toContain(
            "Services reuses essentially the same main content as About",
        );
    }, 15_000);

    it("accepts a real hash route that changes URL and page content", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav><a href="#/about">About</a></nav>
                    <main><h1>Home</h1><p>Homepage content.</p></main>
                </div>
                <script>
                    const pages = {
                        '#/about': '<h1>About</h1><p>Independent About page content and university history.</p>'
                    };
                    const home = '<h1>Home</h1><p>Homepage content.</p>';
                    const renderRoute = () => {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || home;
                    };
                    window.addEventListener('hashchange', renderRoute);
                    renderRoute();
                </script>
            `),
            goal: "Use routes to navigate between pages",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message: "Verified 1 distinct independent route target(s): About.",
        });
        expect(result.checks).toContainEqual({
            name: "browser Back/Forward works",
            passed: true,
            message:
                'Back restored the starting route and Forward restored "About".',
        });
        expect(result.checks).toContainEqual({
            name: "direct deep-link reload works",
            passed: true,
            message:
                'Directly reloaded "About" and retained its route content.',
        });
    }, 15_000);

    it("rejects independent navigation when some declared routes are dead", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav>
                        <a href="#/home">首页</a>
                        <a href="#/scenery">风景名胜</a>
                        <a href="#/food">特色美食</a>
                        <a href="#/culture">历史文化</a>
                    </nav>
                    <main></main>
                </div>
                <script>
                    const pages = {
                        '#/home': '<h1>欢迎来到温州</h1><p>山水诗画，温润之州。</p>',
                        '#/scenery': '<h1>风景名胜</h1><p>雁荡山、楠溪江和百丈漈构成温州山水画卷。</p>'
                    };
                    const renderRoute = () => {
                        const page = pages[window.location.hash];
                        if (page) document.querySelector('main').innerHTML = page;
                    };
                    window.addEventListener('hashchange', renderRoute);
                    if (!window.location.hash) {
                        history.replaceState(null, '', '#/home');
                    }
                    renderRoute();
                </script>
            `),
            goal: "温州网站使用独立页面路由，并且所有导航都可以跳转",
            timeoutMs: 2_000,
        });
        const navigationCheck = result.checks.find(
            (check) => check.name === "internal navigation works",
        );

        expect(result.passed).toBe(false);
        expect(navigationCheck?.passed).toBe(false);
        expect(navigationCheck?.message).toContain("特色美食");
        expect(navigationCheck?.message).toContain("历史文化");
        expect(navigationCheck?.message).toContain("Verified 1 of 3");
    }, 15_000);

    it("accepts all independent routes with history and direct deep links", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav>
                        <a href="#/home">首页</a>
                        <a href="#/scenery">风景名胜</a>
                        <a href="#/food">特色美食</a>
                        <a href="#/culture">历史文化</a>
                    </nav>
                    <main></main>
                </div>
                <script>
                    const pages = {
                        '#/home': '<h1>欢迎来到温州</h1><p>山水诗画，温润之州。</p>',
                        '#/scenery': '<h1>风景名胜</h1><p>雁荡山、楠溪江和百丈漈构成温州山水画卷。</p>',
                        '#/food': '<h1>特色美食</h1><p>温州鱼丸、糯米饭和灯盏糕体现瓯越风味。</p>',
                        '#/culture': '<h1>历史文化</h1><p>永嘉学派、南戏与瓯越文化延续千年文脉。</p>'
                    };
                    const renderRoute = () => {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || pages['#/home'];
                    };
                    window.addEventListener('hashchange', renderRoute);
                    if (!window.location.hash) {
                        history.replaceState(null, '', '#/home');
                    }
                    renderRoute();
                </script>
            `),
            goal: "使用多个独立路由，支持跳转和浏览器历史",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 3 distinct independent route target(s): 风景名胜, 特色美食, 历史文化.",
        });
        expect(
            result.checks.find(
                (check) => check.name === "browser Back/Forward works",
            )?.passed,
        ).toBe(true);
        expect(
            result.checks.find(
                (check) => check.name === "direct deep-link reload works",
            )?.passed,
        ).toBe(true);
    }, 15_000);

    it("observes a hash route after the click action itself times out", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <style>
                    * { box-sizing: border-box; }
                    body { margin: 0; font-family: system-ui, sans-serif; color: #17324d; background: #f4f8fb; }
                    header { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px 7vw; background: #123c57; }
                    .brand { color: white; font-size: 24px; font-weight: 800; text-decoration: none; }
                    nav { display: flex; flex-wrap: wrap; gap: 10px; }
                    nav a { color: #eaf8ff; padding: 10px 14px; border-radius: 999px; text-decoration: none; }
                    main { width: min(1100px, 100%); margin: 0 auto; padding: 56px 7vw; }
                    .hero { padding: 32px; border-radius: 24px; background: white; box-shadow: 0 16px 45px rgba(18, 60, 87, .12); }
                    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px; margin-top: 24px; }
                    article { padding: 22px; border: 1px solid #d7e6ef; border-radius: 18px; background: white; }
                </style>
                <div id="root">
                    <header>
                        <a class="brand" href="#/home">瓯越温州</a>
                        <nav>
                            <a href="#/home" onclick="blockRouteClick()">首页</a>
                            <a href="#/scenery" onclick="blockRouteClick()">风景名胜</a>
                            <a href="#/food" onclick="blockRouteClick()">特色美食</a>
                            <a href="#/culture" onclick="blockRouteClick()">历史文化</a>
                        </nav>
                    </header>
                    <main></main>
                </div>
                <script>
                    const pages = {
                        '#/home': '<section class="hero"><h1>欢迎来到温州</h1><p>从瓯江潮声到雁荡奇峰，这座东南沿海城市把山水、商贸与生活温度写进日常。</p></section><section class="grid"><article><h2>山海相逢</h2><p>江心屿、楠溪江和洞头海岛串联起多层次的旅行风景。</p></article><article><h2>千年文脉</h2><p>瓯越文化、南戏故里与永嘉学派共同构成城市精神底色。</p></article><article><h2>当代活力</h2><p>开放的民营经济与精细制造，让古城持续焕发新的创造力。</p></article></section>',
                        '#/scenery': '<section class="hero"><h1>风景名胜</h1><p>循着山、江、海三条线索，读懂温州变化丰富又彼此连通的自然画卷。</p></section><section class="grid"><article><h2>雁荡山</h2><p>灵峰夜景、飞瀑与奇岩展现火山地貌塑造的壮阔景观。</p></article><article><h2>楠溪江</h2><p>清溪、滩林与古村落相互映照，适合慢行和人文探访。</p></article><article><h2>洞头海岛</h2><p>海岸步道、渔村和日出把海洋气息带入周末旅程。</p></article></section>',
                        '#/food': '<section class="hero"><h1>特色美食</h1><p>温州味道讲究鲜、细与本真，从清晨糯米饭一直延续到夜晚海鲜排档。</p></section><section class="grid"><article><h2>温州鱼丸</h2><p>弹韧鱼肉与清鲜汤底，是街巷里最有辨识度的一碗热食。</p></article><article><h2>糯米饭</h2><p>肉末汤汁、油条碎和糯米组合成当地人的经典早餐。</p></article><article><h2>灯盏糕</h2><p>酥脆外壳包裹萝卜丝与肉馅，呈现朴实浓郁的瓯越风味。</p></article></section>',
                        '#/culture': '<section class="hero"><h1>历史文化</h1><p>从东瓯古城到近代开埠，温州在交流与创造中延续独立开放的文化性格。</p></section><section class="grid"><article><h2>南戏故里</h2><p>古老戏曲传统在舞台、曲调与民间节庆中持续流传。</p></article><article><h2>永嘉学派</h2><p>经世致用的思想传统影响了地方教育、商业与公共生活。</p></article><article><h2>古村街巷</h2><p>传统民居、宗祠和水系保存着山水聚落的生活记忆。</p></article></section>'
                    };

                    function renderRoute() {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || pages['#/home'];
                    }

                    function blockRouteClick() {
                        // Model a route shell that re-renders while Playwright
                        // is still settling the click. The native anchor action
                        // and hashchange still complete after this handler.
                        const startedAt = performance.now();
                        while (performance.now() - startedAt < 1200) {}
                    }

                    window.addEventListener('hashchange', renderRoute);
                    if (!window.location.hash.startsWith('#/')) {
                        history.replaceState(null, '', '#/home');
                    }
                    renderRoute();
                </script>
            `),
            goal: "我想要一个介绍温州的界面，并且可以在多个独立页面之间跳转",
            timeoutMs: 1_500,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 3 distinct independent route target(s): 风景名胜, 特色美食, 历史文化.",
        });
        expect(result.checks).toContainEqual({
            name: "independent routes have substantive unique content",
            passed: true,
            message:
                "Verified substantive, distinct main content for the starting page and 3 independent route target(s).",
        });
        expect(result.checks).toContainEqual({
            name: "contains no placeholder page content",
            passed: true,
        });
        expect(result.checks).toContainEqual({
            name: "visual page has sufficient content structure",
            passed: true,
        });
        expect(result.checks).toContainEqual({
            name: "visual page has authored styling",
            passed: true,
        });
    }, 15_000);

    it("checks a real detail route before many same-page section links", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <nav>
                        <a href="#home">Home</a>
                        <a href="#features">Features</a>
                        <a href="#legends">Legends</a>
                        <a href="#maps">Maps</a>
                        <a href="#modes">Modes</a>
                        <a href="#news">News</a>
                        <a href="#footer">Footer</a>
                        <a href="#legal">Legal</a>
                    </nav>
                    <main>
                        <h1 id="home">Home</h1>
                        <section id="features">Features</section>
                        <section id="legends">Legends</section>
                        <section id="maps">Maps</section>
                        <section id="modes">Modes</section>
                        <section id="news">
                            <a href="#/news/season-update">Read season news</a>
                        </section>
                        <section id="footer">Footer</section>
                        <section id="legal">Legal</section>
                    </main>
                </div>
                <script>
                    const homeContent = document.querySelector('main').innerHTML;
                    const renderRoute = () => {
                        if (window.location.hash === '#/news/season-update') {
                            document.querySelector('main').innerHTML = '<h1>Season update</h1><p>A complete independent article with detailed patch notes and event information.</p>';
                        } else {
                            document.querySelector('main').innerHTML = homeContent;
                        }
                    };
                    window.addEventListener('hashchange', renderRoute);
                    renderRoute();
                </script>
            `),
            goal: "最新资讯导航可以打开独立详情路由",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 1 distinct independent route target(s): Read season news.",
        });
    }, 15_000);

    it("prefers semantic navigation over an earlier working utility link", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: await createHttpPage(`
                <div id="root">
                    <div class="utility"><a href="#/english">English</a></div>
                    <nav><a href="#/about">About</a></nav>
                    <main><h1>Home</h1><p>Homepage content.</p></main>
                </div>
                <script>
                    const pages = {
                        '#/english': '<h1>English</h1><p>English utility page content.</p>',
                        '#/about': '<h1>About</h1><p>Independent About page content and university history.</p>'
                    };
                    const home = '<h1>Home</h1><p>Homepage content.</p>';
                    const renderRoute = () => {
                        document.querySelector('main').innerHTML =
                            pages[window.location.hash] || home;
                    };
                    window.addEventListener('hashchange', renderRoute);
                    renderRoute();
                </script>
            `),
            goal: "Use routes to navigate between pages",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                "Verified 2 distinct independent route target(s): About, English.",
        });
    }, 15_000);

    it("accepts a safe navigation button that changes main content", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <nav>
                        <button type="button" onclick="
                            document.querySelector('main').innerHTML = '<h1>About</h1><p>Detailed university introduction and history.</p>';
                            console.warn('non-fatal navigation warning');
                        ">About</button>
                    </nav>
                    <main><h1>Home</h1><p>Welcome to the homepage.</p></main>
                </div>
            `),
            goal: "Switch the visible section with navigation tabs",
            timeoutMs: 2_000,
        });

        expect(result.passed).toBe(true);
        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                'Activated "About" and observed a meaningful main-content change.',
        });
        expect(result.checks).toContainEqual({
            name: "has no runtime errors",
            passed: true,
        });
    }, 15_000);

    it("does not click external links or form submit buttons as navigation", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <nav>
                        <a href="https://example.com/about">External About</a>
                        <form><button>Submit</button></form>
                    </nav>
                    <main><h1>Home</h1><p>No internal destination exists.</p></main>
                </div>
            `),
            goal: "Add internal page navigation",
            timeoutMs: 1_000,
        });
        const navigationCheck = result.checks.find(
            (check) => check.name === "internal navigation works",
        );

        expect(result.passed).toBe(false);
        expect(navigationCheck?.message).toContain(
            "External links, submit buttons",
        );
    }, 15_000);

    it("keeps runtime errors fatal when navigation itself changes content", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const result = await evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <nav>
                        <button type="button" onclick="
                            document.querySelector('main').innerHTML = '<h1>About</h1><p>Changed content.</p>';
                            console.error('navigation render failed');
                        ">About</button>
                    </nav>
                    <main><h1>Home</h1><p>Homepage content.</p></main>
                </div>
            `),
            goal: "Switch to the About section with a navigation tab",
            timeoutMs: 2_000,
        });

        expect(result.checks).toContainEqual({
            name: "internal navigation works",
            passed: true,
            message:
                'Activated "About" and observed a meaningful main-content change.',
        });
        expect(result.passed).toBe(false);
        expect(
            result.checks.find(
                (check) => check.name === "has no runtime errors",
            )?.message,
        ).toContain("navigation render failed");
    }, 15_000);

    it("honors AbortSignal while checking navigation", async () => {
        const evaluator = new PlaywrightBrowserEvaluator();
        const controller = new AbortController();
        const evaluation = evaluator.evaluate({
            url: createDataPage(`
                <div id="root">
                    <nav><button type="button">Inert navigation</button></nav>
                    <main><h1>Home</h1><p>Unchanged content.</p></main>
                </div>
            `),
            goal: "Make the navigation buttons switch pages",
            timeoutMs: 5_000,
            signal: controller.signal,
        });

        setTimeout(() => controller.abort(), 50);

        await expect(evaluation).rejects.toMatchObject({
            name: "AbortError",
        });
    }, 15_000);
});

describe("isNavigationBrowserGoal", () => {
    it.each([
        "让首页导航可以跳转到对应介绍页面",
        "实现学校概况和招生信息的页面切换",
        "Add internal page navigation",
        "Route between the home and about screens",
        "Make the links jump to matching sections",
        "Make the buttons open the corresponding pages",
    ])("enables navigation checks for an explicit navigation goal: %s", (goal) => {
        expect(isNavigationBrowserGoal(goal)).toBe(true);
    });

    it.each([
        "Create an introduction page about Wenzhou",
        "Build a polished university homepage",
        "做一个好看的清华大学首页",
    ])("does not require navigation for a content-only page goal: %s", (goal) => {
        expect(isNavigationBrowserGoal(goal)).toBe(false);
    });
});

describe("isIndependentPageNavigationGoal", () => {
    it.each([
        "实现学校概况和招生信息的独立页面跳转",
        "使用路由切换多个页面",
        "Use routes to navigate between pages",
        "Build a multi-page site",
        "Open the About page",
        "我想要一个介绍温州的界面 并且可以跳转",
    ])("classifies an independent-page navigation goal: %s", (goal) => {
        expect(isIndependentPageNavigationGoal(goal)).toBe(true);
    });

    it.each([
        "让导航跳转到同页对应区域",
        "Jump to matching page sections",
        "Switch the visible same-page section with tabs",
        "Create an introduction page",
    ])("does not classify a same-page or content-only goal: %s", (goal) => {
        expect(isIndependentPageNavigationGoal(goal)).toBe(false);
    });
});

describe("createBrowserRuntimeChecks", () => {
    it("passes a populated root without browser runtime errors", () => {
        expect(
            createBrowserRuntimeChecks({
                rootExists: true,
                rootHasContent: true,
                rootHasVisibleMainContent: true,
                runtimeErrors: [],
            }),
        ).toEqual([
            {
                name: "application root renders",
                passed: true,
            },
            {
                name: "has no runtime errors",
                passed: true,
            },
            {
                name: "has visible main content",
                passed: true,
            },
        ]);
    });

    it("rejects an empty React root", () => {
        expect(
            createBrowserRuntimeChecks({
                rootExists: true,
                rootHasContent: false,
                rootHasVisibleMainContent: false,
                runtimeErrors: [],
            }),
        ).toContainEqual({
            name: "application root renders",
            passed: false,
            message: "The #root element remained empty after the page loaded.",
        });
    });

    it("rejects console errors and uncaught page exceptions", () => {
        const checks = createBrowserRuntimeChecks({
            rootExists: true,
            rootHasContent: true,
            rootHasVisibleMainContent: true,
            runtimeErrors: [
                "console.error: Objects are not valid as a React child ({title,date})",
                "Uncaught page error: Objects are not valid as a React child",
            ],
        });

        expect(checks).toContainEqual({
            name: "has no runtime errors",
            passed: false,
            message:
                "console.error: Objects are not valid as a React child ({title,date}) | Uncaught page error: Objects are not valid as a React child",
        });
    });

    it("deduplicates and bounds runtime error evidence", () => {
        const repeatedError = `console.error: ${"x".repeat(1_000)}`;
        const runtimeCheck = createBrowserRuntimeChecks({
            rootExists: true,
            rootHasContent: true,
            rootHasVisibleMainContent: true,
            runtimeErrors: [
                repeatedError,
                repeatedError,
                "error 2",
                "error 3",
                "error 4",
                "error 5",
                "error 6",
            ],
        }).find((check) => check.name === "has no runtime errors");

        expect(runtimeCheck?.passed).toBe(false);
        expect(runtimeCheck?.message?.length).toBeLessThan(600);
        expect(runtimeCheck?.message).not.toContain("error 6");
    });
});

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

describe("summarizeBrowserEval", () => {
    it("summarizes passed browser checks", () => {
        const result = summarizeBrowserEval({
            passed: false,
            checks: [
                {
                    name: "page loads",
                    passed: true,
                },
                {
                    name: "has input",
                    passed: true,
                },
                {
                    name: "adds task",
                    passed: false,
                    message: "Task item was not rendered after clicking Add.",
                },
            ],
        });

        expect(result).toBe("2/3 browser checks passed");
    });
});
