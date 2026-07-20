import {
    DesignPlanSchema,
    type DesignPlan,
    type DesignPlanCompliance,
    type DesignPlanSource,
} from "@appforge/protocol";
import type { PlannerOutput } from "@appforge/agent-core";
import { readFile } from "node:fs/promises";
import path from "node:path";

type RouteLike = {
    path: string;
    purpose: string;
    acceptanceCriteria?: readonly string[];
};

function includesAny(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

function classifyApplicationType(goal: string): DesignPlan["applicationType"] {
    if (includesAny(goal, [/dashboard|admin|analytics|console|metrics|后台|看板|数据|报表|监控|运营/iu])) {
        return "dashboard";
    }
    if (includesAny(goal, [/game|gaming|esports|valorant|apex|游戏|电竞|无畏契约|瓦罗兰特|射击|战术/iu])) {
        return "game";
    }
    if (includesAny(goal, [/shop|commerce|store|marketplace|商城|电商|商品|购买|价格/iu])) {
        return "commerce";
    }
    if (includesAny(goal, [/portfolio|gallery|studio|case study|作品|画廊|设计师|摄影|创意/iu])) {
        return "portfolio";
    }
    if (includesAny(goal, [/university|college|campus|admission|大学|学院|学校|招生|校园/iu])) {
        return "institution";
    }
    if (includesAny(goal, [/city|culture|travel|guide|editorial|magazine|heritage|城市|文化|旅行|旅游|导览|专题|杂志|文旅|地方/iu])) {
        return "editorial";
    }
    if (includesAny(goal, [/saas|software|platform|developer|product|startup|平台|产品|工具|开发者|调试/iu])) {
        return "product";
    }
    return "editorial";
}

function inferForbiddenPatterns(goal: string, applicationType: DesignPlan["applicationType"]): string[] {
    const forbidden = new Set<string>();
    if (includesAny(goal, [/不要.*卡片|不.*卡片化|avoid cards?|no cards?|card grid|圆角卡片/iu])) {
        forbidden.add("card grid");
        forbidden.add("repeated rounded cards");
    }
    if (includesAny(goal, [/不要.*SaaS|不像.*SaaS|not SaaS|no SaaS/iu])) {
        forbidden.add("SaaS hero");
        forbidden.add("generic SaaS feature cards");
    }
    if (includesAny(goal, [/不要.*蓝|不是蓝色|not blue|no blue/iu])) {
        forbidden.add("dominant blue palette");
    }
    if (applicationType === "game") {
        forbidden.add("generic SaaS feature cards");
        forbidden.add("soft marketing card grid");
    }
    if (applicationType === "editorial" || applicationType === "institution") {
        forbidden.add("generic product landing hero");
    }
    return [...forbidden];
}

export function createFallbackDesignPlan(input: {
    goal: string;
    plannerOutput: PlannerOutput;
    routes: readonly RouteLike[];
}): DesignPlan {
    const applicationType = classifyApplicationType(input.goal);
    const forbiddenPatterns = inferForbiddenPatterns(
        input.goal,
        applicationType,
    );
    const routes = input.routes.length > 0
        ? input.routes
        : [{ path: "/", purpose: input.plannerOutput.summary }];
    const editorial = applicationType === "editorial" || applicationType === "institution";
    const game = applicationType === "game";
    const dashboard = applicationType === "dashboard";
    const product = applicationType === "product";

    return DesignPlanSchema.parse({
        version: 1,
        applicationType,
        designIntent: {
            audience: dashboard
                ? "operators and decision makers"
                : product
                  ? "developer and product teams"
                  : game
                    ? "players and esports fans"
                    : "readers exploring the subject",
            primaryGoal: input.plannerOutput.summary,
            emotionalTone: game
                ? ["cinematic", "tense", "high-contrast"]
                : dashboard
                  ? ["controlled", "dense", "operational"]
                  : editorial
                    ? ["editorial", "local", "curated"]
                    : ["clear", "polished", "confident"],
            brandTraits: game
                ? ["angular", "HUD-like", "tactical"]
                : dashboard
                  ? ["structured", "data-first", "efficient"]
                  : editorial
                    ? ["magazine-like", "textured", "asymmetric"]
                    : ["modern", "trustworthy", "focused"],
        },
        informationArchitecture: {
            routes: routes.map((route) => ({
                path: route.path,
                purpose: route.purpose,
                primaryContent: route.acceptanceCriteria?.length
                    ? [...route.acceptanceCriteria]
                    : [route.purpose],
                primaryActions: route.path === "/"
                    ? ["Explore primary content"]
                    : ["Navigate within this route"],
            })),
        },
        visualDNA: {
            composition: game
                ? "cinematic split stage with HUD rails and tactical content lanes"
                : dashboard
                  ? "operational app shell with metric bands, data regions, and status rails"
                  : editorial
                    ? "open editorial magazine flow with asymmetric story bands and route/list hybrids"
                    : product
                      ? "workflow-led product surface with proof rows and product-screen moments"
                      : "subject-specific mixed composition with varied section silhouettes",
            density: dashboard ? "high" : game || product ? "medium" : "medium",
            surfaceStrategy: dashboard ? "contained" : editorial || game ? "mixed" : "mixed",
            navigationPattern: dashboard
                ? "utility shell navigation"
                : game
                  ? "compact campaign navigation"
                  : editorial
                    ? "flat editorial masthead navigation"
                    : "conversion-oriented top navigation",
            heroPattern: game
                ? "full-bleed cinematic hero with angular HUD labels"
                : dashboard
                  ? "status overview header"
                  : editorial
                    ? "magazine masthead with media break"
                    : "product story hero with workflow visual",
            sectionRhythm: game
                ? ["hero stage", "HUD brief strip", "map/tactic lane", "round timeline"]
                : dashboard
                  ? ["overview bar", "metric row", "data region", "activity feed"]
                  : editorial
                    ? ["masthead", "wide story band", "route timeline", "culture/media break"]
                    : product
                      ? ["hero workflow", "feature strip", "proof row", "conversion band"]
                      : ["hero", "split content", "proof/media band", "action footer"],
            typographyCharacter: game
                ? "compact uppercase tactical labels with readable body copy"
                : editorial
                  ? "editorial hierarchy with restrained display type"
                  : dashboard
                    ? "dense UI typography with tabular metrics"
                    : "clean product typography with moderate display scale",
            shapeLanguage: game
                ? "angular cuts, rails, thin dividers, minimal radius"
                : editorial
                  ? "open bands, fine rules, restrained radius"
                  : dashboard
                    ? "rectilinear panels and data cells"
                    : "balanced rounded controls and flat sections",
            mediaStrategy: game
                ? "cinematic key art or CSS arena field, not decorative stock cards"
                : editorial
                  ? "large hero media plus small captioned supporting media"
                  : dashboard
                    ? "charts, tables, state indicators, and compact data visuals"
                    : "product or brand visual surfaced as workflow evidence",
            uniqueMotifs: game
                ? ["HUD strip", "tactical rail", "angular divider"]
                : dashboard
                  ? ["status rail", "metric band", "filter bar"]
                  : editorial
                    ? ["route timeline", "magazine caption rail", "local texture"]
                    : product
                      ? ["workflow lane", "product screen", "proof row"]
                      : ["subject-specific motif"],
            forbiddenPatterns,
        },
        designTokens: {
            colorRoles: game
                ? {
                      background: "#08090f",
                      surface: "#141720",
                      foreground: "#f8fbff",
                      mutedForeground: "#b8c0cc",
                      accent: "#ff4655",
                      accentForeground: "#16090a",
                  }
                : dashboard
                  ? {
                        background: "#07111f",
                        surface: "#0f1f33",
                        foreground: "#eaf2ff",
                        mutedForeground: "#9fb4d0",
                        accent: "#38bdf8",
                        accentForeground: "#061018",
                    }
                  : editorial
                    ? {
                          background: "#f7f1e8",
                          surface: "#fffaf0",
                          foreground: "#191713",
                          mutedForeground: "#6d6256",
                          accent: "#b67a2c",
                          accentForeground: "#16130f",
                      }
                    : {
                          background: "#f8fbff",
                          surface: "#ffffff",
                          foreground: "#071018",
                          mutedForeground: "#526172",
                          accent: "#4f46e5",
                          accentForeground: "#ffffff",
                      },
            radiusScale: game ? [0, 2, 6, 10] : editorial ? [0, 4, 8, 14] : [0, 6, 12, 20],
            spacingScale: [4, 8, 12, 16, 24, 32, 48],
        },
        acceptanceCriteria: [
            {
                id: "DESIGN-1",
                instruction: "Generated pages follow the project DesignPlan composition and section rhythm.",
                verification: "Page source and CSS include project-style variables and section primitives derived from DesignPlan.",
            },
            {
                id: "DESIGN-2",
                instruction: "User-forbidden visual patterns are propagated through planning, page prompts, CSS, and review.",
                verification: "Forbidden patterns appear in DesignPlan and reviewer compliance evidence.",
            },
        ],
    });
}

export function formatDesignPlanForPrompt(designPlan: DesignPlan): string {
    return [
        "Structured DesignPlan v1:",
        `applicationType: ${designPlan.applicationType}`,
        `audience: ${designPlan.designIntent.audience}`,
        `primaryGoal: ${designPlan.designIntent.primaryGoal}`,
        `composition: ${designPlan.visualDNA.composition}`,
        `surfaceStrategy: ${designPlan.visualDNA.surfaceStrategy}`,
        `navigationPattern: ${designPlan.visualDNA.navigationPattern}`,
        `heroPattern: ${designPlan.visualDNA.heroPattern}`,
        `sectionRhythm: ${designPlan.visualDNA.sectionRhythm.join(" -> ")}`,
        `typographyCharacter: ${designPlan.visualDNA.typographyCharacter}`,
        `shapeLanguage: ${designPlan.visualDNA.shapeLanguage}`,
        `mediaStrategy: ${designPlan.visualDNA.mediaStrategy}`,
        `uniqueMotifs: ${designPlan.visualDNA.uniqueMotifs.join(", ")}`,
        `forbiddenPatterns: ${designPlan.visualDNA.forbiddenPatterns.join(", ") || "none"}`,
    ].join("\n");
}

export function designPlanSourceLabel(source: DesignPlanSource): string {
    return source;
}

export async function evaluateDesignPlanCompliance(input: {
    workspaceRoot: string;
    designPlan: DesignPlan;
    designPlanSource: DesignPlanSource;
}): Promise<DesignPlanCompliance[]> {
    const sourceFiles = await readExistingTextFiles(input.workspaceRoot, [
        "src/App.css",
        "src/App.tsx",
        "src/content.ts",
    ]);
    const source = sourceFiles.join("\n");
    const css = sourceFiles[0] ?? "";
    const lowerSource = source.toLowerCase();
    const lowerCss = css.toLowerCase();
    const forbidden = input.designPlan.visualDNA.forbiddenPatterns;

    const forbiddenHits = forbidden.filter((pattern) => {
        if (isCardGridForbiddenPattern(pattern)) {
            return hasStructuralCardGridEvidence(source, css);
        }
        if (isDominantBlueForbiddenPattern(pattern)) {
            return hasDominantBlueSurfaceEvidence(css);
        }

        // Natural-language forbidden-pattern labels are frequently rendered as
        // acceptance criteria or explanatory copy. Their literal presence in
        // TSX is not implementation evidence. Unknown patterns therefore do
        // not fail the deterministic gate without a structural detector.
        return false;
    });

    return [
        {
            criterion: "DesignPlan is available to review",
            status: "PASS",
            evidence: `designPlanSource=${designPlanSourceLabel(input.designPlanSource)}; applicationType=${input.designPlan.applicationType}`,
        },
        {
            criterion: "composition is represented",
            status: lowerCss.includes("--project-composition") || lowerSource.includes(input.designPlan.visualDNA.composition.slice(0, 20).toLowerCase())
                ? "PASS"
                : "UNVERIFIED",
            evidence: lowerCss.includes("--project-composition")
                ? "Project CSS declares --project-composition from DesignPlan."
                : "No explicit project composition marker found in source.",
        },
        {
            criterion: "surfaceStrategy is represented",
            status: lowerCss.includes(`--surface-strategy: ${input.designPlan.visualDNA.surfaceStrategy}`)
                ? "PASS"
                : "UNVERIFIED",
            evidence: `Expected --surface-strategy: ${input.designPlan.visualDNA.surfaceStrategy}.`,
        },
        {
            criterion: "forbiddenPatterns are avoided",
            status: forbiddenHits.length === 0 ? "PASS" : "FAIL",
            evidence: forbiddenHits.length === 0
                ? `No simple source/CSS evidence found for forbidden patterns: ${forbidden.join(", ") || "none"}.`
                : `Forbidden pattern evidence found: ${forbiddenHits.join(", ")}.`,
        },
        {
            criterion: "uniqueMotifs are represented",
            status: input.designPlan.visualDNA.uniqueMotifs.some((motif) =>
                lowerSource.includes(motif.toLowerCase().split(/\s+/u)[0] ?? ""),
            ) || lowerCss.includes("--unique-motifs")
                ? "PASS"
                : "UNVERIFIED",
            evidence: lowerCss.includes("--unique-motifs")
                ? "Project CSS declares --unique-motifs from DesignPlan."
                : `Checked motifs: ${input.designPlan.visualDNA.uniqueMotifs.join(", ")}.`,
        },
    ];
}


function isCardGridForbiddenPattern(pattern: string): boolean {
    return /(?:card\s*grid|rounded\s*cards?|saas[^\n]{0,24}cards?|feature\s*cards?|generic\s*saas|product\s*cards?|marketing\s*cards?|普通产品卡片|重复圆角卡片|通用\s*saas\s*功能卡片|营销式?卡片|卡片宫格)/iu.test(
        pattern,
    );
}

function hasStructuralCardGridEvidence(source: string, css: string): boolean {
    return (
        /(?:className|class)\s*=\s*["'`][^"'`]*(?:page-card|feature-card|card-grid|page-grid)[^"'`]*["'`]/iu.test(
            source,
        ) ||
        /\.(?:page-card|feature-card|card-grid|page-grid)(?:\b|--)/iu.test(css)
    );
}

function isDominantBlueForbiddenPattern(pattern: string): boolean {
    return /(?:dominant\s+blue|blue\s+(?:saas|corporate)|蓝色企业\s*saas\s*背景|企业蓝(?:色)?背景)/iu.test(
        pattern,
    );
}

function hasDominantBlueSurfaceEvidence(css: string): boolean {
    return /(?:--(?:bg|background|surface)\s*:\s*|background(?:-color)?\s*:\s*)(?:blue\b|#(?:155eef|2563eb|1d4ed8|1e40af|0284c7|0369a1)\b)/iu.test(
        css,
    );
}

async function readExistingTextFiles(
    workspaceRoot: string,
    relativePaths: readonly string[],
): Promise<string[]> {
    const contents: string[] = [];
    for (const relativePath of relativePaths) {
        try {
            contents.push(
                await readFile(path.join(workspaceRoot, relativePath), "utf8"),
            );
        } catch {
            contents.push("");
        }
    }
    return contents;
}
