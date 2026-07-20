import { MAX_WRITE_FILE_CONTENT_LENGTH } from "@appforge/protocol";

import type { JsonSchemaValue } from "./model-provider.js";

const stringSchema = (maxLength?: number): JsonSchemaValue => ({
    type: "string",
    minLength: 1,
    ...(maxLength !== undefined ? { maxLength } : {}),
});

const stringArraySchema = (
    minItems = 0,
    maxItems?: number,
): JsonSchemaValue => ({
    type: "array",
    items: stringSchema(),
    minItems,
    ...(maxItems !== undefined ? { maxItems } : {}),
});

const objectSchema = (
    properties: Record<string, JsonSchemaValue>,
    required: string[],
): JsonSchemaValue => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
});

export const PlannerOutputJsonSchema: JsonSchemaValue = objectSchema(
    {
        summary: stringSchema(),
        steps: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: objectSchema(
                {
                    id: stringSchema(),
                    title: stringSchema(),
                    description: stringSchema(),
                    acceptanceCriteria: stringArraySchema(1),
                },
                ["id", "title", "description", "acceptanceCriteria"],
            ),
        },
        site: objectSchema(
            {
                title: stringSchema(80),
                tagline: stringSchema(160),
            },
            ["title", "tagline"],
        ),
        pages: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: objectSchema(
                {
                    id: {
                        type: "string",
                        minLength: 1,
                        maxLength: 40,
                        pattern: "^[a-z][a-z0-9-]*$",
                    },
                    path: {
                        type: "string",
                        minLength: 1,
                        maxLength: 100,
                        pattern: "^/[a-z0-9/_-]*$",
                    },
                    label: stringSchema(50),
                    purpose: stringSchema(500),
                    acceptanceCriteria: stringArraySchema(1, 8),
                },
                ["id", "path", "label", "purpose", "acceptanceCriteria"],
            ),
        },
        workstreams: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: objectSchema(
                {
                    id: stringSchema(),
                    role: {
                        type: "string",
                        enum: ["content", "styles", "shell"],
                    },
                    task: stringSchema(),
                    acceptanceCriteria: stringArraySchema(1),
                },
                ["id", "role", "task", "acceptanceCriteria"],
            ),
        },
    },
    ["summary", "steps"],
);

export const DesignPlanJsonSchema: JsonSchemaValue = objectSchema(
    {
        version: { type: "number", const: 1 },
        applicationType: {
            type: "string",
            enum: [
                "editorial",
                "institution",
                "dashboard",
                "commerce",
                "product",
                "portfolio",
                "game",
                "custom",
            ],
        },
        designIntent: objectSchema(
            {
                audience: stringSchema(),
                primaryGoal: stringSchema(),
                emotionalTone: stringArraySchema(1),
                brandTraits: stringArraySchema(1),
            },
            ["audience", "primaryGoal", "emotionalTone", "brandTraits"],
        ),
        informationArchitecture: objectSchema(
            {
                routes: {
                    type: "array",
                    minItems: 1,
                    items: objectSchema(
                        {
                            path: stringSchema(),
                            purpose: stringSchema(),
                            primaryContent: stringArraySchema(1),
                            primaryActions: stringArraySchema(),
                        },
                        [
                            "path",
                            "purpose",
                            "primaryContent",
                            "primaryActions",
                        ],
                    ),
                },
            },
            ["routes"],
        ),
        visualDNA: objectSchema(
            {
                composition: stringSchema(),
                density: { type: "string", enum: ["low", "medium", "high"] },
                surfaceStrategy: {
                    type: "string",
                    enum: ["open", "mixed", "contained"],
                },
                navigationPattern: stringSchema(),
                heroPattern: stringSchema(),
                sectionRhythm: stringArraySchema(1),
                typographyCharacter: stringSchema(),
                shapeLanguage: stringSchema(),
                mediaStrategy: stringSchema(),
                uniqueMotifs: stringArraySchema(1),
                forbiddenPatterns: stringArraySchema(),
            },
            [
                "composition",
                "density",
                "surfaceStrategy",
                "navigationPattern",
                "heroPattern",
                "sectionRhythm",
                "typographyCharacter",
                "shapeLanguage",
                "mediaStrategy",
                "uniqueMotifs",
                "forbiddenPatterns",
            ],
        ),
        designTokens: objectSchema(
            {
                colorRoles: objectSchema(
                    {
                        background: stringSchema(),
                        surface: stringSchema(),
                        foreground: stringSchema(),
                        mutedForeground: stringSchema(),
                        accent: stringSchema(),
                        accentForeground: stringSchema(),
                    },
                    [
                        "background",
                        "surface",
                        "foreground",
                        "mutedForeground",
                        "accent",
                        "accentForeground",
                    ],
                ),
                radiusScale: {
                    type: "array",
                    minItems: 1,
                    items: { type: "number", minimum: 0 },
                },
                spacingScale: {
                    type: "array",
                    minItems: 1,
                    items: { type: "number", exclusiveMinimum: 0 },
                },
            },
            ["colorRoles", "radiusScale", "spacingScale"],
        ),
        acceptanceCriteria: {
            type: "array",
            minItems: 1,
            items: objectSchema(
                {
                    id: stringSchema(),
                    instruction: stringSchema(),
                    verification: stringSchema(),
                },
                ["id", "instruction", "verification"],
            ),
        },
    },
    [
        "version",
        "applicationType",
        "designIntent",
        "informationArchitecture",
        "visualDNA",
        "designTokens",
        "acceptanceCriteria",
    ],
);

const actionBase = (
    type: string,
    properties: Record<string, JsonSchemaValue>,
    required: string[],
): JsonSchemaValue =>
    objectSchema(
        {
            type: { type: "string", const: type },
            ...properties,
        },
        ["type", ...required],
    );

export const EntrypointAgentActionJsonSchema: JsonSchemaValue = {
    anyOf: [
        actionBase(
            "write_file",
            {
                path: { type: "string", const: "src/App.tsx" },
                content: {
                    type: "string",
                    minLength: 1,
                    maxLength: MAX_WRITE_FILE_CONTENT_LENGTH,
                },
            },
            ["path", "content"],
        ),
        actionBase(
            "edit_file",
            {
                path: { type: "string", const: "src/App.tsx" },
                oldText: { type: "string", minLength: 1, maxLength: 6000 },
                newText: { type: "string", maxLength: 6000 },
                replaceAll: { type: "boolean" },
            },
            ["path", "oldText", "newText"],
        ),
        actionBase(
            "finish",
            {
                summary: stringSchema(),
            },
            ["summary"],
        ),
    ],
};

export const AgentActionJsonSchema: JsonSchemaValue = {
    anyOf: [
        actionBase(
            "write_file",
            {
                path: stringSchema(),
                content: {
                    type: "string",
                    maxLength: MAX_WRITE_FILE_CONTENT_LENGTH,
                },
            },
            ["path", "content"],
        ),
        actionBase(
            "append_file",
            {
                path: stringSchema(),
                content: { type: "string", minLength: 1, maxLength: 4000 },
            },
            ["path", "content"],
        ),
        actionBase(
            "edit_file",
            {
                path: stringSchema(),
                oldText: { type: "string", minLength: 1, maxLength: 6000 },
                newText: { type: "string", maxLength: 6000 },
                replaceAll: { type: "boolean" },
            },
            ["path", "oldText", "newText"],
        ),
        actionBase(
            "read_file",
            {
                path: stringSchema(),
                startLine: { type: "integer", minimum: 1 },
                endLine: { type: "integer", minimum: 1 },
            },
            ["path"],
        ),
        actionBase(
            "run_command",
            {
                command: stringSchema(),
                args: { type: "array", items: { type: "string" } },
            },
            ["command", "args"],
        ),
        actionBase(
            "get_image",
            {
                query: stringSchema(500),
                mode: { type: "string", enum: ["search", "generate"] },
                altText: stringSchema(500),
                outputPath: stringSchema(500),
            },
            ["query", "mode", "altText", "outputPath"],
        ),
        actionBase(
            "finish",
            {
                summary: stringSchema(),
            },
            ["summary"],
        ),
    ],
};

export const ParallelFileArtifactJsonSchema: JsonSchemaValue = objectSchema(
    {
        path: stringSchema(500),
        content: { type: "string", minLength: 1, maxLength: 8000 },
        summary: stringSchema(500),
    },
    ["path", "content", "summary"],
);

export const ReviewerOutputJsonSchema: JsonSchemaValue = objectSchema(
    {
        accepted: { type: "boolean" },
        reason: stringSchema(),
        issues: { type: "array", items: { type: "string" } },
    },
    ["accepted", "reason", "issues"],
);
