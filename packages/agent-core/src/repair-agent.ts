import type { AgentAction } from "@appforge/protocol";

import type { ImageAssetMode } from "./image-asset-provider.js";
import type { ModelProvider } from "./model-provider.js";
import { parseAgentAction } from "./parse-agent-action.js";
import { completeStructuredOutput } from "./complete-structured-output.js";

export type RepairAgentOptions = {
    model: ModelProvider;
    imageToolsEnabled?: boolean;
    imageToolModes?: ImageAssetMode[];
};

export class RepairAgent {
    constructor(private readonly options: RepairAgentOptions) {}

    async decideNextAction(
        goal: string,
        context = "",
    ): Promise<AgentAction> {
        const imageToolModes =
            this.options.imageToolModes ??
            (this.options.imageToolsEnabled
                ? (["search", "generate"] satisfies ImageAssetMode[])
                : []);

        return completeStructuredOutput({
            model: this.options.model,
            request: {
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a repair agent for an existing React/Vite app.",
                            "Return exactly one JSON object and no markdown.",
                            "The response is parsed as JSON. Escape all newlines as \\n and all double quotes inside string values as \\\".",
                            'For write_file, use: {"type":"write_file","path":"src/App.tsx","content":"..."}',
                            'For continuing a long file, use append_file: {"type":"append_file","path":"src/content.ts","content":"..."}',
                            'For small changes, prefer edit_file: {"type":"edit_file","path":"src/App.tsx","oldText":"exact existing text","newText":"replacement text"}.',
                            'For get_image, use: {"type":"get_image","query":"...","mode":"generate","altText":"...","outputPath":"public/assets/image.jpg"}',
                            'For finish, use: {"type":"finish","summary":"..."}',
                            "Repair only the specific build, eval, browser, or reviewer issues in the context.",
                            "When the repair context includes a failed action and execution result, do not repeat that action unchanged. For 'Edit target not found', copy oldText exactly from the latest target file source included in context or use a smaller safe edit.",
                            "Preserve the current app content, layout, language, and working features unless the issue explicitly requires changing them.",
                            "Prefer the smallest coherent edit. Do not replace the app with a starter or unrelated design.",
                            "For navigation, link, button, tab, anchor, or route changes, use edit_file against the existing component instead of rewriting the whole page.",
                            "When context says route-shell-first, edit src/App.tsx to connect the functional route skeleton before adding content, images, or CSS.",
                            "Treat same-page anchors and independent URL routes as different requirements. Do not repair a requested page route by adding #section scrolling.",
                            "For independent pages, preserve existing working views, add substantive distinct routed views, update a route-specific URL, and support browser Back/Forward through pathname routing or a URL-aware #/ hash router.",
                            'Remove href="#", empty navigation, route placeholders, and ordinary #section substitutes when repairing a route request. A manual #/ hash router must read location.hash and handle hashchange.',
                            "For complex pages, repair the smallest affected file. Prefer editing src/content.ts, src/App.css, or a compact src/App.tsx instead of rewriting the whole app.",
                            "Each write_file content must be under 6000 characters. Longer file writes are rejected by the platform.",
                            "Each append_file content must be under 4000 characters. Use multiple append_file actions when continuing a large content or CSS file.",
                            "Keep each write_file content focused and avoid oversized JSX or excessive inline styles.",
                            "If the issue is a JSX syntax error, fix the broken tags or text escaping only.",
                            "If the issue is a missing local image asset and image tools are available, call get_image for that asset before editing code.",
                            "If the current app already satisfies the issue, return finish.",
                            ...(imageToolModes.length > 0
                                ? [
                                      `Available image modes: ${imageToolModes.join(", ")}.`,
                                      "Image outputPath must be inside public/assets.",
                                      'Reference saved assets in React as "/assets/filename.ext".',
                                  ]
                                : []),
                            "All user-facing UI text must stay in the user's language.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content:
                            context.length > 0
                                ? `${goal}\n\nRepair context:\n${context}`
                                : goal,
                    },
                ],
            },
            parse: parseAgentAction,
            outputName: "AgentAction",
            maxAttempts: 3,
            invalidResponseInstruction: [
                "For Repair AgentAction correction, do not repeat a huge src/App.tsx response.",
                "write_file content over 6000 characters is invalid and will be rejected.",
                "If a file needs more content, return one append_file action with a small chunk.",
                "Return one small corrected JSON action only.",
                "For continuation or navigation fixes, prefer edit_file with exact oldText/newText.",
                "If the previous response was too large or invalid, repair a smaller file such as src/content.ts or src/App.css when possible.",
                "Keep the corrected write_file content under 3000 characters.",
            ].join(" "),
        });
    }
}
