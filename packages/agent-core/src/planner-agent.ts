import { z } from "zod";

import type { ModelProvider } from "./model-provider.js";
import { completeStructuredOutput } from "./complete-structured-output.js";
import { PlannerOutputJsonSchema } from "./structured-output-schemas.js";

export const PlannerStepSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),});

export const PlannerWorkstreamSchema = z.object({
    id: z.string().min(1),
    role: z.enum(["content", "styles", "shell"]),
    task: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

export const PlannerSiteSchema = z.object({
    title: z.string().min(1).max(80),
    tagline: z.string().min(1).max(160),
});

export const PlannerPageSchema = z.object({
    id: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z][a-z0-9-]*$/u),
    path: z
        .string()
        .min(1)
        .max(100)
        .regex(/^\/[a-z0-9/_-]*$/u),
    label: z.string().min(1).max(50),
    purpose: z.string().min(1).max(500),
    acceptanceCriteria: z.array(z.string().min(1)).min(1).max(8),
});

export const PlannerOutputSchema = z
    .object({
        summary: z.string().min(1),
        steps: z.array(PlannerStepSchema).min(1).max(10),
        site: PlannerSiteSchema.optional(),
        pages: z.array(PlannerPageSchema).min(1).max(6).optional(),
        /** Legacy concern-based plans remain parseable for persisted/test data.
         * Fresh page generation uses `pages`, one Coding API call per entry. */
        workstreams: z
            .array(PlannerWorkstreamSchema)
            .min(1)
            .max(3)
            .optional(),
    })
    .superRefine((output, context) => {
        if (!output.pages) {
            return;
        }

        const ids = new Set<string>();
        const paths = new Set<string>();

        output.pages.forEach((page, index) => {
            if (ids.has(page.id)) {
                context.addIssue({
                    code: "custom",
                    message: `Duplicate page id: ${page.id}`,
                    path: ["pages", index, "id"],
                });
            }
            if (paths.has(page.path)) {
                context.addIssue({
                    code: "custom",
                    message: `Duplicate page path: ${page.path}`,
                    path: ["pages", index, "path"],
                });
            }
            ids.add(page.id);
            paths.add(page.path);
        });

        if (output.pages[0]?.path !== "/") {
            context.addIssue({
                code: "custom",
                message: "The first planned page must be the home path /",
                path: ["pages", 0, "path"],
            });
        }
    });

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export type PlannerAgentOptions = {
    model:ModelProvider;
};

export class PlannerAgent{
    constructor(private readonly options:PlannerAgentOptions){}
    async createPlan(
        goal: string,
        context = "",
    ): Promise<PlannerOutput> {
        return completeStructuredOutput({
            model: this.options.model,
            request: {
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a software planning agent.",
                            "Break the product goal into implementation steps.",
                            "Return exactly one JSON object and no markdown.",
                            "Use this structure:",
                            '{"summary":"...","steps":[{"id":"step-1","title":"...","description":"...","acceptanceCriteria":["..."]}],"site":{"title":"...","tagline":"..."},"pages":[{"id":"home","path":"/","label":"...","purpose":"...","acceptanceCriteria":["..."]}]}',
                            "Keep the plan realistic for one short coding attempt. Prefer 3-5 core steps over many optional details.",
                            "Do not invent product features or business requirements that the user did not ask for.",
                            "Default page-generation contract: when the goal asks to create a page, website, homepage, landing page, or introduction interface and does not explicitly ask for minimal, simple, prototype, or single-screen output, plan a complete polished page rather than a small demo.",
                            "Adapt the complete-page shell to the product type. For content, official-site, landing, and introduction pages, plan a clear high-contrast brand, useful navigation, a topic-specific hero, at least three distinct meaningful content sections beyond the hero, and a finished footer.",
                            "For dashboards, portals, and embedded tools, plan a coherent app shell with product identity, task-appropriate navigation, a summary header or overview, at least three meaningful functional modules, and an appropriate utility, status, or footer treatment. Do not force a marketing hero or marketing footer onto a product interface.",
                            "Use real subject-specific information or task-relevant data and controls, and reject lorem ipsum, generic Feature 1 cards, empty shells, and placeholder copy.",
                            "For complex or multi-view pages, define the information architecture and route map before planning visual sections or polish.",
                            "For fresh page or site generation, include site plus pages. Create exactly one pages entry for every independently rendered webpage or URL view. A single-page request gets one home entry with path /. A multi-page request gets one entry per requested page, including home. Use short stable lowercase ASCII ids, distinct URL paths, user-language labels, page-specific purposes, and acceptance criteria. The coordinator performs one initial Coding API call per pages entry and runs different pages concurrently; a failed page may be retried without regenerating successful pages. Do not split fresh pages into content/styles/shell workstreams.",
                            "Plan complete page coverage with a small coherent design-token system, clear visual hierarchy, focused files for content/CSS/compact components, and only assets essential to the request; do not invent optional decorative assets.",
                            "Plan semantic native controls with 44px targets and visible focus, mobile and desktop layouts without horizontal overflow, and reduced-motion behavior.",
                            "When a brand mark or logo exists, keep it high-contrast and provide a solid-color surface fallback behind it.",
                            "Distinguish same-document anchor navigation from independent page routing.",
                            'If the goal requests independent or multiple pages, plan distinct substantive route views with route-specific headings and meaningful content, route-specific URLs, active navigation state, direct deep-link loading, preservation of the existing home view, and browser Back/Forward behavior. Either pathname routes or URL-aware #/ routes are valid; an ordinary #section link, duplicated view, or placeholder is not an acceptable page route.',
                            "For independent-page routing, the generated route shell must connect every planned page using real links, route-specific rendering, and popstate or hashchange handling.",
                            "For iterations, preserve the existing design language and working features, and plan the smallest coherent change that satisfies the new feedback.",
                            "For a default complete page, acceptance criteria must explicitly verify the product-appropriate shell and primary overview, three or more meaningful content sections or functional modules, real topic-specific copy/data/controls, responsive behavior, and absence of placeholders; do not accept a tiny card or one-section demo. For an introduction or content page, the criteria must still require its brand/navigation, topic-specific hero, post-hero sections, and footer.",
                            "Acceptance criteria must also cover successful build, useful alt text for essential images, and local asset references that actually matter to the goal.",
                            "Use the same natural language as the user's goal.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content:
                            context.length > 0
                                ? `${goal}\n\nPlatform context:\n${context}`
                                : goal,
                    },
                ],
            },
            parse: (text) =>
                PlannerOutputSchema.parse(JSON.parse(text) as unknown),
            outputName: "PlannerOutput",
            schema: PlannerOutputJsonSchema,
        });
    }
}
