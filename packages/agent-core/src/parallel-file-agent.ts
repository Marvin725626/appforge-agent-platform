import { z } from "zod";

import { completeStructuredOutput } from "./complete-structured-output.js";
import type { ModelProvider } from "./model-provider.js";
import { ParallelFileArtifactJsonSchema } from "./structured-output-schemas.js";

const PARALLEL_FILE_CONTENT_TARGET_CHARACTERS = 5_500;
const PARALLEL_FILE_CONTENT_MAX_CHARACTERS = 8_000;

export const ParallelFileArtifactSchema = z.object({
    path: z.string().min(1),
    content: z.string().min(1).max(PARALLEL_FILE_CONTENT_MAX_CHARACTERS),
    summary: z.string().min(1).max(500),
});

export type ParallelFileArtifact = z.infer<
    typeof ParallelFileArtifactSchema
>;

export type ParallelFileAgentOptions = {
    model: ModelProvider;
    /** Structured correction attempts for this artifact. Page-per-API
     * orchestration can raise this for JSON-truncation recovery. */
    maxAttempts?: number;
};

export type GenerateParallelFileInput = {
    goal: string;
    role: string;
    path: string;
    instructions: string;
    planContext?: string;
};

function normalizeWorkspacePath(filePath: string): string {
    return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export class ParallelFileAgent {
    constructor(private readonly options: ParallelFileAgentOptions) {}

    async generate(
        input: GenerateParallelFileInput,
    ): Promise<ParallelFileArtifact> {
        const expectedPath = normalizeWorkspacePath(input.path);

        return await completeStructuredOutput({
            model: this.options.model,
            request: {
                messages: [
                    {
                        role: "system",
                        content: [
                            `You are the ${input.role} Coding Agent in a parallel React/Vite build.`,
                            `You own exactly one file: ${expectedPath}.`,
                            "Return exactly one JSON object and no markdown.",
                            'Use this structure: {"path":"src/file.ts","content":"complete escaped file content","summary":"..."}.',
                            "The content must be a complete usable file, not a patch, diff, placeholder, TODO, or explanation.",
                            `Keep content focused and preferably under ${PARALLEL_FILE_CONTENT_TARGET_CHARACTERS} characters; the hard limit is ${PARALLEL_FILE_CONTENT_MAX_CHARACTERS} characters. Escape newlines and quotes correctly as JSON.`,
                            "Avoid inline style objects, long repeated copy, huge arrays, and oversized JSX. Use shared CSS classes and compact repeated structures so the JSON object does not get truncated.",
                            "Do not create, edit, reference as newly created, or claim ownership of any other file.",
                            "Use React, TypeScript, UTF-8, semantic accessible controls, responsive behavior, and the same natural language as the user.",
                            "Follow the shared contract exactly so the coordinator can merge independently generated files without another model round trip.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content: [
                            `Product goal:\n${input.goal}`,
                            input.planContext
                                ? `Planner context:\n${input.planContext}`
                                : "",
                            `Owned file:\n${expectedPath}`,
                            `Workstream instructions:\n${input.instructions}`,
                        ]
                            .filter((part) => part.length > 0)
                            .join("\n\n"),
                    },
                ],
            },
            parse: (text) => {
                const artifact = ParallelFileArtifactSchema.parse(
                    JSON.parse(text) as unknown,
                );
                const actualPath = normalizeWorkspacePath(artifact.path);

                if (actualPath !== expectedPath) {
                    throw new Error(
                        `Parallel file agent must return ${expectedPath}, received ${actualPath}`,
                    );
                }

                return {
                    ...artifact,
                    path: expectedPath,
                };
            },
            outputName: `ParallelFileArtifact(${expectedPath})`,
            schema: ParallelFileArtifactJsonSchema,
            maxAttempts: this.options.maxAttempts ?? 2,
            invalidResponseInstruction: [
                `Return only the complete file artifact for ${expectedPath}.`,
                "Do not return AgentAction, markdown, a file bundle, or another path.",
                `Your previous JSON was invalid or too large. Return a shorter complete file under ${PARALLEL_FILE_CONTENT_TARGET_CHARACTERS} characters.`,
                "Remove inline style objects and long prose; use compact JSX with shared class names.",
            ].join(" "),
        });
    }
}
