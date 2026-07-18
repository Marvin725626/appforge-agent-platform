import {
    ActionExecutor,
    ParallelFileAgent,
    type ModelProvider,
    type ParallelFileArtifact,
    type PlannerOutput,
    type RunCodingAgentLoopResult,
} from "@appforge/agent-core";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_WORKSTREAM_TIMEOUT_MS = 240_000;
const MIN_WORKSTREAM_TIMEOUT_MS = 100;
const MAX_WORKSTREAM_TIMEOUT_MS = 600_000;

export type ParallelReactPageWorkstreamRole =
    | "content"
    | "styles"
    | "shell";

export type ParallelReactPageWorkstreamState =
    | "pending"
    | "running"
    | "succeeded"
    | "failed";

export type ParallelReactPageWorkstreamStatus = {
    id: ParallelReactPageWorkstreamRole;
    role: ParallelReactPageWorkstreamRole;
    path: "src/content.ts" | "src/App.css" | "src/App.tsx";
    status: ParallelReactPageWorkstreamState;
    generationAttempts: number;
    summary: string;
    errorMessage?: string;
};

/** Public integration name used by the run result and trace layers. */
export type ParallelCodingWorkstreamResult =
    ParallelReactPageWorkstreamStatus;

export type RunParallelReactPageAgentOptions = {
    goal: string;
    plannerOutput: PlannerOutput;
    model: ModelProvider;
    workspaceRoot: string;
    routeRequest: boolean;
    maxConcurrency?: number;
    workstreamTimeoutMs?: number;
    signal?: AbortSignal;
};

export type RunParallelReactPageAgentResult = {
    agent: RunCodingAgentLoopResult;
    workstreams: ParallelReactPageWorkstreamStatus[];
};

type WorkstreamSpec = {
    id: ParallelReactPageWorkstreamRole;
    roleLabel: string;
    path: ParallelReactPageWorkstreamStatus["path"];
    instructions: string;
};

export const PARALLEL_REACT_PAGE_SHARED_CONTRACT = [
    "Shared three-file contract:",
    "1. src/content.ts exports siteContent. siteContent has brand, tagline, routes, and footer fields.",
    "2. siteContent.routes is an array. Every route has id, path, label, eyebrow, title, description, and sections. Every section has title and body. Route paths start with /.",
    '3. src/App.tsx imports a default React runtime binding (for example `import React, { useEffect, useState } from "react";`), uses the exact named import `import { siteContent } from "./content.js";`, imports ./App.css, and exports a named App component.',
    "4. The React shell renders the shared class names app-shell, site-header, brand-link, site-nav, nav-link, nav-link--active, route-main, hero, eyebrow, route-grid, content-card, and site-footer.",
    "5. For routed work, src/App.tsx derives the current path from window.location.hash, selects the active record with siteContent.routes.find(...route.path...), renders that selected route's title, description, and sections, and creates each navigation href directly from the route path.",
    "6. src/App.css owns all visual styling for those class names, including design tokens, responsive layout, visible focus, and reduced-motion behavior.",
    "7. Do not reference any component, data module, stylesheet, image, or dependency outside these three files and the existing React runtime.",
].join("\n");

const WORKSTREAM_SPECS: readonly WorkstreamSpec[] = [
    {
        id: "content",
        roleLabel: "Content",
        path: "src/content.ts",
        instructions: [
            "Create the complete subject-specific content model defined by the shared contract.",
            "Keep this complete file concise and under 4200 characters.",
            "Export siteContent and its useful TypeScript types. Do not write JSX or CSS.",
            "Use real, concise, user-language copy rather than placeholders or generic feature cards.",
            "For routed work, provide at least three distinct substantive route records, including the home route /. For a non-routed page, provide one / route with at least three meaningful sections.",
        ].join(" "),
    },
    {
        id: "styles",
        roleLabel: "Styles",
        path: "src/App.css",
        instructions: [
            "Create the complete responsive visual system defined by the shared class contract.",
            "Apply the frontend-design template pack: three-tier CSS tokens, semantic component tokens, product-type layout blueprint, mobile-first responsive behavior, visible focus states, and WCAG-style readable foreground/background pairs.",
            "Do not make the visual system a stack of same-looking rounded cards. Use product-type structures and varied section silhouettes.",
            "Keep this complete stylesheet concise and under 4500 characters.",
            "Include :root design tokens, polished desktop and mobile layouts, 44px navigation targets, :focus-visible treatment, and a prefers-reduced-motion media query.",
            "Keep branding and text high-contrast and prevent horizontal overflow.",
            "Keep typography at normal product scale: hero h1 max about 3.8rem, game hero max about 4rem, h2 about 1.25-1.75rem, body about .92-1rem, and metrics about 1.55-2.6rem. Avoid huge headings, giant statistic cards, vertical one-letter labels, and oversized media panels.",
            "Keep hero/media panels balanced with adjacent text; images should not dominate text blocks or create tall empty columns.",
            "Use explicit readable foreground/background pairs for every text-bearing component: #071018 with #f8fbff, #7cf7ff with #071018, #ffd166 with #061018, or #ffffff/#fffaf0 with #111827. Do not use pale/white text on cyan, yellow, beige, white, light photos, or light gradients.",
            "Style eyebrow/kicker/badge/pill/tag/stat/metric/table/nav/CTA text with both color and background. Tiny labels and table cells must never rely on inherited color.",
        ].join(" "),
    },
    {
        id: "shell",
        roleLabel: "Shell",
        path: "src/App.tsx",
        instructions: [
            "Create the compact accessible React shell defined by the shared contract.",
            "Keep this complete shell concise and under 4000 characters.",
            "Render the header, navigation, active route hero, route sections, and footer from siteContent rather than duplicating subject copy.",
            "Use semantic header, nav, main, section, article, link, and footer elements where appropriate.",
        ].join(" "),
    },
] as const;

class WorkstreamTimeoutError extends Error {
    constructor(role: ParallelReactPageWorkstreamRole, timeoutMs: number) {
        super(
            `${role} workstream exhausted its ${timeoutMs}ms total generation deadline`,
        );
        this.name = "WorkstreamTimeoutError";
    }
}

function clampInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    return message.length > 1_000
        ? `${message.slice(0, 1_000)}...`
        : message;
}

function isAbortError(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "ABORT_ERR")
    );
}

function assertNoScaffolding(content: string, path: string): void {
    if (/```/u.test(content)) {
        throw new Error(`${path} contains a markdown code fence`);
    }

    if (/\b(?:TODO|FIXME|lorem ipsum|coming soon)\b/iu.test(content)) {
        throw new Error(`${path} contains placeholder or unfinished content`);
    }
}

function assertContentArtifact(
    content: string,
    routeRequest: boolean,
): void {
    assertNoScaffolding(content, "src/content.ts");

    const requiredPatterns: Array<[RegExp, string]> = [
        [
            /export\s+(?:const|let)\s+siteContent\b/u,
            "an exported siteContent value",
        ],
        [/(?:\broutes\b|["']routes["'])\s*:/u, "a routes field"],
        [/(?:\bbrand\b|["']brand["'])\s*:/u, "a brand field"],
        [/(?:\bsections\b|["']sections["'])\s*:/u, "route sections"],
    ];

    if (content.length < 300) {
        throw new Error("src/content.ts is too small to contain complete page content");
    }

    for (const [pattern, description] of requiredPatterns) {
        if (!pattern.test(content)) {
            throw new Error(`src/content.ts is missing ${description}`);
        }
    }

    const literalRoutePaths = [
        ...content.matchAll(
            /(?:\bpath\b|["']path["'])\s*:\s*["'](\/[^"']*)["']/gu,
        ),
    ]
        .map((match) => match[1] ?? "")
        .filter((path) => path.length > 0);
    const distinctRoutePaths = new Set(literalRoutePaths);
    const requiredRouteCount = routeRequest ? 3 : 1;

    if (distinctRoutePaths.size < requiredRouteCount) {
        throw new Error(
            `src/content.ts needs at least ${requiredRouteCount} distinct literal route path(s)`,
        );
    }

    if (!distinctRoutePaths.has("/")) {
        throw new Error("src/content.ts must include the home route /");
    }
}

function assertStylesArtifact(content: string): void {
    assertNoScaffolding(content, "src/App.css");

    if (content.length < 500) {
        throw new Error("src/App.css is too small to define the complete visual system");
    }

    const requiredPatterns: Array<[RegExp, string]> = [
        [/:root\b/u, "design tokens"],
        [/\.app-shell\b/u, ".app-shell"],
        [/\.site-header\b/u, ".site-header"],
        [/\.brand-link\b/u, ".brand-link"],
        [/\.site-nav\b/u, ".site-nav"],
        [/\.nav-link\b/u, ".nav-link"],
        [/\.nav-link--active\b/u, ".nav-link--active"],
        [/\.route-main\b/u, ".route-main"],
        [/\.hero\b/u, ".hero"],
        [/\.eyebrow\b/u, ".eyebrow"],
        [/\.route-grid\b/u, ".route-grid"],
        [/\.content-card\b/u, ".content-card"],
        [/\.site-footer\b/u, ".site-footer"],
        [/:focus-visible\b/u, "visible keyboard focus styles"],
        [/@media\b/u, "a responsive media query"],
        [/prefers-reduced-motion/u, "reduced-motion behavior"],
    ];

    for (const [pattern, description] of requiredPatterns) {
        if (!pattern.test(content)) {
            throw new Error(`src/App.css is missing ${description}`);
        }
    }
}

function assertShellArtifact(content: string, routeRequest: boolean): void {
    assertNoScaffolding(content, "src/App.tsx");

    if (content.length < 500) {
        throw new Error("src/App.tsx is too small to define the complete page shell");
    }

    const requiredPatterns: Array<[RegExp, string]> = [
        [
            /import\s*\{\s*siteContent\s*\}\s*from\s*["']\.\/content(?:\.js)?["']/u,
            "the exact named siteContent import",
        ],
        [/import\s+["']\.\/App\.css["']/u, "the shared stylesheet import"],
        [
            /export\s+(?:function|const)\s+App\b/u,
            "a named App export",
        ],
        [/siteContent\.routes\b/u, "route data rendering"],
        [/app-shell/u, "the app-shell class"],
        [/site-header/u, "the site-header class"],
        [/site-nav/u, "the site-nav class"],
        [/content-card/u, "the content-card class"],
        [/site-footer/u, "the site-footer class"],
        [/<nav\b/u, "semantic navigation"],
        [/<main\b/u, "semantic main content"],
        [/<footer\b/u, "a finished footer"],
    ];

    for (const [pattern, description] of requiredPatterns) {
        if (!pattern.test(content)) {
            throw new Error(`src/App.tsx is missing ${description}`);
        }
    }

    if (!routeRequest) {
        return;
    }

    const routePatterns: Array<[RegExp, string]> = [
        [/window\.location\.hash/u, "window.location.hash routing"],
        [/hashchange/u, "a hashchange listener"],
        [/addEventListener\s*\(/u, "route event registration"],
        [/useEffect\s*\(/u, "route listener lifecycle handling"],
        [/useState\s*(?:<[^>]+>)?\s*\(/u, "URL-derived route state"],
        [/href\s*=/u, "real navigation links"],
        [/nav-link--active/u, "visible active navigation state"],
        [/["'`]#\//u, "a default #/ route"],
        [
            /siteContent\.routes\.find\s*\([\s\S]{0,240}\bpath\b[\s\S]{0,240}\)/u,
            "active route selection by route path",
        ],
        [/\{[A-Za-z_$][\w$]*\.title\}/u, "the selected route title"],
        [
            /\{[A-Za-z_$][\w$]*\.description\}/u,
            "the selected route description",
        ],
        [
            /[A-Za-z_$][\w$]*\.sections\.map\s*\(/u,
            "the selected route sections",
        ],
        [
            /href\s*=\s*\{\s*(?:["']#["']\s*\+\s*[A-Za-z_$][\w$]*\.path|`#\$\{\s*[A-Za-z_$][\w$]*\.path\s*\}`)\s*\}/u,
            "navigation hrefs derived directly from route paths",
        ],
    ];

    for (const [pattern, description] of routePatterns) {
        if (!pattern.test(content)) {
            throw new Error(`src/App.tsx is missing ${description}`);
        }
    }
}

function assertArtifact(
    spec: WorkstreamSpec,
    artifact: ParallelFileArtifact,
    routeRequest: boolean,
): void {
    if (spec.id === "content") {
        assertContentArtifact(artifact.content, routeRequest);
        return;
    }

    if (spec.id === "styles") {
        assertStylesArtifact(artifact.content);
        return;
    }

    assertShellArtifact(artifact.content, routeRequest);
}

function formatPlannerContext(
    plannerOutput: PlannerOutput,
    role: ParallelReactPageWorkstreamRole,
): string {
    const matchingWorkstream = plannerOutput.workstreams?.find(
        (workstream) => workstream.role === role,
    );
    const planSteps = plannerOutput.steps
        .slice(0, 6)
        .map(
            (step, index) =>
                `${index + 1}. ${step.title}: ${step.description} Acceptance: ${step.acceptanceCriteria.join("; ")}`,
        );

    return [
        `Planner summary: ${plannerOutput.summary}`,
        matchingWorkstream
            ? [
                  `Assigned ${role} workstream: ${matchingWorkstream.task}`,
                  `Workstream acceptance: ${matchingWorkstream.acceptanceCriteria.join("; ")}`,
              ].join("\n")
            : "",
        "Planner steps:",
        ...planSteps,
    ]
        .filter((part) => part.length > 0)
        .join("\n")
        .slice(0, 5_000);
}

function createAbortRace(signal: AbortSignal): {
    promise: Promise<never>;
    cleanup: () => void;
} {
    let cleanup = (): void => undefined;
    const promise = new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }

        const onAbort = (): void => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        cleanup = () => signal.removeEventListener("abort", onAbort);
    });

    return { promise, cleanup };
}

async function generateArtifactWithDeadline(input: {
    options: RunParallelReactPageAgentOptions;
    spec: WorkstreamSpec;
    remainingMs: number;
    totalTimeoutMs: number;
    retryReason?: string;
}): Promise<ParallelFileArtifact> {
    input.options.signal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(input.remainingMs);
    const combinedSignal = input.options.signal
        ? AbortSignal.any([input.options.signal, timeoutSignal])
        : timeoutSignal;
    const scopedModel: ModelProvider = {
        complete: (request) => {
            const requestSignal = request.signal
                ? AbortSignal.any([combinedSignal, request.signal])
                : combinedSignal;

            return input.options.model.complete({
                ...request,
                signal: requestSignal,
            });
        },
    };
    const agent = new ParallelFileAgent({ model: scopedModel });
    const routeInstructions = input.options.routeRequest
        ? input.spec.id === "shell"
            ? "This is routed work. Use a URL-aware #/ hash router. Read window.location.hash, subscribe to hashchange, initialize #/ when needed, render a distinct active route, and expose real href values for Back/Forward and direct loading."
            : input.spec.id === "content"
              ? "This is routed work. Supply at least three substantive routes with unique paths, headings, descriptions, and section content."
              : "This is routed work. Style active navigation and distinct route content states."
        : "This is a single-view page. Keep the shared route array to the home route / and render a complete single experience.";
    const generation = agent
        .generate({
            goal: input.options.goal,
            role: input.spec.roleLabel,
            path: input.spec.path,
            instructions: [
                PARALLEL_REACT_PAGE_SHARED_CONTRACT,
                input.spec.instructions,
                routeInstructions,
                input.retryReason
                    ? `Retry correction: the previous proposal was rejected because ${input.retryReason}`
                    : "",
            ]
                .filter((part) => part.length > 0)
                .join("\n\n"),
            planContext: formatPlannerContext(
                input.options.plannerOutput,
                input.spec.id,
            ),
        })
        .then((artifact) => {
            assertArtifact(
                input.spec,
                artifact,
                input.options.routeRequest,
            );
            return artifact;
        });
    const abortRace = createAbortRace(combinedSignal);

    try {
        return await Promise.race([generation, abortRace.promise]);
    } catch (error) {
        if (input.options.signal?.aborted) {
            input.options.signal.throwIfAborted();
        }

        if (timeoutSignal.aborted) {
            throw new WorkstreamTimeoutError(
                input.spec.id,
                input.totalTimeoutMs,
            );
        }

        throw error;
    } finally {
        abortRace.cleanup();
    }
}

async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    operation: (item: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            const item = items[index];

            if (item !== undefined) {
                await operation(item);
            }
        }
    }

    await Promise.all(
        Array.from({ length: workerCount }, async () => await worker()),
    );
}

function createFailureResult(
    statuses: ParallelReactPageWorkstreamStatus[],
    errorMessage: string,
): RunParallelReactPageAgentResult {
    for (const status of statuses) {
        if (status.status === "pending" || status.status === "running") {
            status.status = "failed";
            status.errorMessage = errorMessage;
        }
    }

    return {
        agent: {
            steps: [],
            finished: false,
            stopReason: "model_error",
            errorMessage,
        },
        workstreams: statuses,
    };
}

export async function runParallelReactPageAgent(
    options: RunParallelReactPageAgentOptions,
): Promise<RunParallelReactPageAgentResult> {
    const maxConcurrency = clampInteger(
        options.maxConcurrency,
        DEFAULT_MAX_CONCURRENCY,
        1,
        3,
    );
    const workstreamTimeoutMs = clampInteger(
        options.workstreamTimeoutMs,
        DEFAULT_WORKSTREAM_TIMEOUT_MS,
        MIN_WORKSTREAM_TIMEOUT_MS,
        MAX_WORKSTREAM_TIMEOUT_MS,
    );
    const statuses: ParallelReactPageWorkstreamStatus[] = WORKSTREAM_SPECS.map(
        (spec) => ({
            id: spec.id,
            role: spec.id,
            path: spec.path,
            status: "pending",
            generationAttempts: 0,
            summary: "No valid artifact generated yet.",
        }),
    );
    const artifacts = new Map<
        ParallelReactPageWorkstreamRole,
        ParallelFileArtifact
    >();
    // A deadline starts only when a workstream first obtains a concurrency
    // slot. Structured-output correction and the coordinator's one outer
    // retry share that same absolute deadline.
    const deadlineByRole = new Map<
        ParallelReactPageWorkstreamRole,
        number
    >();

    const generateWorkstream = async (spec: WorkstreamSpec): Promise<void> => {
        options.signal?.throwIfAborted();
        const status = statuses.find((candidate) => candidate.id === spec.id);

        if (!status) {
            throw new Error(`Missing status for ${spec.id} workstream`);
        }

        const retryReason = status.errorMessage;
        const existingDeadline = deadlineByRole.get(spec.id);
        const deadlineAt =
            existingDeadline ?? Date.now() + workstreamTimeoutMs;
        deadlineByRole.set(spec.id, deadlineAt);
        const remainingMs = deadlineAt - Date.now();

        if (remainingMs <= 0) {
            artifacts.delete(spec.id);
            status.status = "failed";
            status.errorMessage = new WorkstreamTimeoutError(
                spec.id,
                workstreamTimeoutMs,
            ).message;
            return;
        }

        status.status = "running";
        status.generationAttempts += 1;
        delete status.errorMessage;

        try {
            const artifact = await generateArtifactWithDeadline({
                options,
                spec,
                remainingMs,
                totalTimeoutMs: workstreamTimeoutMs,
                ...(retryReason ? { retryReason } : {}),
            });
            options.signal?.throwIfAborted();
            artifacts.set(spec.id, artifact);
            status.status = "succeeded";
            status.summary = artifact.summary;
        } catch (error) {
            if (options.signal?.aborted) {
                options.signal.throwIfAborted();
            }

            if (isAbortError(error)) {
                throw error;
            }

            artifacts.delete(spec.id);
            status.status = "failed";
            status.errorMessage = describeError(error);
        }
    };

    try {
        options.signal?.throwIfAborted();
        await runWithConcurrency(
            WORKSTREAM_SPECS,
            maxConcurrency,
            generateWorkstream,
        );

        for (const spec of WORKSTREAM_SPECS) {
            const status = statuses.find(
                (candidate) => candidate.id === spec.id,
            );

            if (status?.status === "failed") {
                await generateWorkstream(spec);
            }
        }

        options.signal?.throwIfAborted();
        const failedStatuses = statuses.filter(
            (status) => status.status !== "succeeded",
        );

        if (failedStatuses.length > 0 || artifacts.size !== WORKSTREAM_SPECS.length) {
            const errorMessage = [
                "Parallel page proposal failed before workspace merge.",
                ...failedStatuses.map(
                    (status) =>
                        `${status.role}: ${status.errorMessage ?? "no valid artifact was produced"}`,
                ),
            ].join(" ");

            return createFailureResult(statuses, errorMessage);
        }

        const executor = new ActionExecutor({
            workspaceRoot: options.workspaceRoot,
            ...(options.signal ? { signal: options.signal } : {}),
        });
        const steps: RunCodingAgentLoopResult["steps"] = [];

        for (const spec of WORKSTREAM_SPECS) {
            options.signal?.throwIfAborted();
            const artifact = artifacts.get(spec.id);
            const status = statuses.find(
                (candidate) => candidate.id === spec.id,
            );

            if (!artifact || !status) {
                throw new Error(
                    `Validated ${spec.id} artifact disappeared before merge`,
                );
            }

            const action = {
                type: "write_file" as const,
                path: artifact.path,
                content: artifact.content,
            };
            const execution = await executor.execute(action);

            if (!execution.ok) {
                status.status = "failed";
                status.errorMessage = execution.message;
                throw new Error(execution.message);
            }

            steps.push({ action, execution });
            status.status = "succeeded";
        }

        const finishAction = {
            type: "finish" as const,
            summary:
                "Generated and merged validated content, styles, and React shell workstreams.",
        };
        const finishExecution = await executor.execute(finishAction);
        steps.push({
            action: finishAction,
            execution: finishExecution,
        });

        return {
            agent: {
                steps,
                finished: true,
                stopReason: "finish",
            },
            workstreams: statuses,
        };
    } catch (error) {
        if (options.signal?.aborted) {
            options.signal.throwIfAborted();
        }

        if (isAbortError(error)) {
            throw error;
        }

        return createFailureResult(
            statuses,
            `Parallel page generation failed: ${describeError(error)}`,
        );
    }
}
