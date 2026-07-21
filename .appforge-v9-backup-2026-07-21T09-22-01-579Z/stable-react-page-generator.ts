import {
    type ImageAssetMode,
    type ImageAssetTool,
    type ModelProvider,
    type RunCodingAgentLoopResult,
} from "@appforge/agent-core";
import type { DesignPlan } from "@appforge/protocol";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    generateStablePageContent,
    type StablePageContent,
} from "./stable-page-content.js";
import { shouldGenerateStableHeroImage } from "./application-visual-policy.js";
import {
    createStableAppSource,
    createStableCssSource,
    createStableMainSource,
} from "./stable-page-renderer.js";

export type StableReactPageGeneratorInput = {
    workspaceRoot: string;
    goal: string;
    designPlan?: DesignPlan;
    contentModel?: ModelProvider;
    imageAssetTool?: ImageAssetTool;
    imageModes?: ImageAssetMode[];
    signal?: AbortSignal;
};

export type StableReactPageGeneratorResult = {
    agent: RunCodingAgentLoopResult;
    generatedFiles: string[];
    content: StablePageContent;
    contentSource: "ai" | "fallback";
    warnings: string[];
};

const GENERIC_REPAIR_REQUEST = /^(?:修复|修一下|继续修复|自动修复|重新修复|重试|再试一次|fix|repair|retry)(?:[。.!！\s]*)$/iu;

export function extractStableProductGoal(goal: string): string {
    const contractMatch = goal.match(
        /(?:^|\n)Initial requirement:\s*\n([\s\S]*?)(?=\n\n(?:Accepted requirement from v\d+|Pending request from the current draft|Current request \(highest priority\)|Continuation repair request):|$)/u,
    );
    const extracted = contractMatch?.[1]?.trim();

    return extracted && extracted.length > 0 ? extracted : goal.trim();
}

export function isGenericRepairRequest(request: string | undefined): boolean {
    return GENERIC_REPAIR_REQUEST.test(request?.trim() ?? "");
}

function publicAssetUrl(savedPath: string): string {
    const normalized = savedPath.replace(/\\/gu, "/");
    const publicPrefix = "public/";
    return normalized.startsWith(publicPrefix)
        ? `/${normalized.slice(publicPrefix.length)}`
        : `/${normalized.replace(/^\/+/, "")}`;
}

async function tryGenerateHeroImage(input: {
    content: StablePageContent;
    imageAssetTool?: ImageAssetTool;
    imageModes?: ImageAssetMode[];
    signal?: AbortSignal;
}): Promise<{
    heroPath?: string;
    warnings: string[];
    step?: RunCodingAgentLoopResult["steps"][number];
}> {
    if (!shouldGenerateStableHeroImage(input.content.applicationType)) {
        return { warnings: [] };
    }

    if (
        !input.imageAssetTool ||
        !(input.imageModes ?? []).includes("generate")
    ) {
        return { warnings: [] };
    }

    try {
        const saved = await input.imageAssetTool.save({
            request: {
                query: input.content.hero.imagePrompt,
                mode: "generate",
                altText: input.content.hero.imageAlt,
            },
            outputPath: "public/assets/generated-hero.webp",
            ...(input.signal ? { signal: input.signal } : {}),
        });

        return {
            heroPath: publicAssetUrl(saved.path),
            warnings: [],
            step: {
                action: {
                    type: "get_image",
                    query: input.content.hero.imagePrompt,
                    mode: "generate",
                    altText: input.content.hero.imageAlt,
                    outputPath: saved.path,
                },
                execution: {
                    ok: true,
                    changed: true,
                    message: `Generated optional hero asset: ${saved.path}`,
                },
            },
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            warnings: [
                `Hero image generation failed; CSS fallback retained: ${detail}`,
            ],
        };
    }
}

export async function generateStableReactPage(
    input: StableReactPageGeneratorInput,
): Promise<StableReactPageGeneratorResult> {
    input.signal?.throwIfAborted();
    const productGoal = extractStableProductGoal(input.goal);
    const contentResult = await generateStablePageContent({
        goal: productGoal,
        ...(input.designPlan ? { designPlan: input.designPlan } : {}),
        ...(input.contentModel ? { model: input.contentModel } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
    });
    input.signal?.throwIfAborted();

    const mediaResult = await tryGenerateHeroImage({
        content: contentResult.content,
        ...(input.imageAssetTool
            ? { imageAssetTool: input.imageAssetTool }
            : {}),
        ...(input.imageModes ? { imageModes: input.imageModes } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
    });
    input.signal?.throwIfAborted();

    const srcRoot = path.join(input.workspaceRoot, "src");
    const appSource = createStableAppSource(contentResult.content, {
        ...(mediaResult.heroPath ? { heroPath: mediaResult.heroPath } : {}),
        heroAlt: contentResult.content.hero.imageAlt,
    });
    const cssSource = createStableCssSource(
        contentResult.content,
        input.designPlan,
    );
    const mainSource = createStableMainSource();

    // Stable generation owns the source tree. Removing stale generated modules
    // prevents unused but syntactically broken files from failing typecheck.
    await rm(srcRoot, { recursive: true, force: true });
    await mkdir(srcRoot, { recursive: true });
    input.signal?.throwIfAborted();

    await Promise.all([
        writeFile(path.join(srcRoot, "App.tsx"), appSource, "utf8"),
        writeFile(path.join(srcRoot, "App.css"), cssSource, "utf8"),
        writeFile(path.join(srcRoot, "main.tsx"), mainSource, "utf8"),
    ]);
    input.signal?.throwIfAborted();

    const steps: RunCodingAgentLoopResult["steps"] = [
        ...(mediaResult.step ? [mediaResult.step] : []),
        {
            action: {
                type: "write_file",
                path: "src/App.tsx",
                content: appSource,
            },
            execution: {
                ok: true,
                changed: true,
                message: `Generated schema-driven ${contentResult.content.applicationType} entrypoint with ${contentResult.content.templateVariant}.`,
            },
        },
        {
            action: {
                type: "write_file",
                path: "src/App.css",
                content: cssSource,
            },
            execution: {
                ok: true,
                changed: true,
                message: `Generated tokenized responsive styles using ${contentResult.content.theme.palette} and ${contentResult.content.theme.fontPair}.`,
            },
        },
        {
            action: {
                type: "write_file",
                path: "src/main.tsx",
                content: mainSource,
            },
            execution: {
                ok: true,
                changed: true,
                message: "Restored deterministic React entry bootstrap: src/main.tsx",
            },
        },
        {
            action: {
                type: "finish",
                summary: [
                    "Schema-driven stable page generation completed.",
                    `contentSource=${contentResult.source}`,
                    `applicationType=${contentResult.content.applicationType}`,
                    `templateVariant=${contentResult.content.templateVariant}`,
                    `heroImage=${shouldGenerateStableHeroImage(contentResult.content.applicationType) ? (mediaResult.heroPath ? "generated" : "fallback") : "disabled_by_policy"}`,
                ].join(" "),
            },
            execution: {
                ok: true,
                changed: false,
                message: "Schema-driven stable page generation completed.",
            },
        },
    ];

    return {
        agent: {
            steps,
            finished: true,
            stopReason: "finish",
        },
        generatedFiles: [
            "src/App.tsx",
            "src/App.css",
            "src/main.tsx",
            ...(mediaResult.heroPath
                ? [mediaResult.heroPath.replace(/^\//u, "public/")]
                : []),
        ],
        content: contentResult.content,
        contentSource: contentResult.source,
        warnings: [...contentResult.warnings, ...mediaResult.warnings],
    };
}
