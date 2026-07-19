import { z } from "zod";

export const ApplicationTypeSchema = z.enum([
    "editorial",
    "institution",
    "dashboard",
    "commerce",
    "product",
    "portfolio",
    "game",
    "custom",
]);

export const SurfaceStrategySchema = z.enum([
    "open",
    "mixed",
    "contained",
]);

export const DesignPlanComplianceSchema = z.object({
    criterion: z.string().min(1),
    status: z.enum(["PASS", "FAIL", "UNVERIFIED"]),
    evidence: z.string().min(1),
});

export const DesignPlanSchema = z.object({
    version: z.literal(1),
    applicationType: ApplicationTypeSchema,
    designIntent: z.object({
        audience: z.string().min(1),
        primaryGoal: z.string().min(1),
        emotionalTone: z.array(z.string().min(1)).min(1),
        brandTraits: z.array(z.string().min(1)).min(1),
    }),
    informationArchitecture: z.object({
        routes: z.array(
            z.object({
                path: z.string().min(1),
                purpose: z.string().min(1),
                primaryContent: z.array(z.string().min(1)).min(1),
                primaryActions: z.array(z.string().min(1)),
            }),
        ).min(1),
    }),
    visualDNA: z.object({
        composition: z.string().min(1),
        density: z.enum(["low", "medium", "high"]),
        surfaceStrategy: SurfaceStrategySchema,
        navigationPattern: z.string().min(1),
        heroPattern: z.string().min(1),
        sectionRhythm: z.array(z.string().min(1)).min(1),
        typographyCharacter: z.string().min(1),
        shapeLanguage: z.string().min(1),
        mediaStrategy: z.string().min(1),
        uniqueMotifs: z.array(z.string().min(1)).min(1),
        forbiddenPatterns: z.array(z.string().min(1)),
    }),
    designTokens: z.object({
        colorRoles: z.object({
            background: z.string().min(1),
            surface: z.string().min(1),
            foreground: z.string().min(1),
            mutedForeground: z.string().min(1),
            accent: z.string().min(1),
            accentForeground: z.string().min(1),
        }),
        radiusScale: z.array(z.number().nonnegative()).min(1),
        spacingScale: z.array(z.number().positive()).min(1),
    }),
    acceptanceCriteria: z.array(
        z.object({
            id: z.string().min(1),
            instruction: z.string().min(1),
            verification: z.string().min(1),
        }),
    ).min(1),
});

export const DesignPlanSourceSchema = z.enum([
    "planner",
    "preserved",
    "fallback",
]);

export type ApplicationType = z.infer<typeof ApplicationTypeSchema>;
export type SurfaceStrategy = z.infer<typeof SurfaceStrategySchema>;
export type DesignPlan = z.infer<typeof DesignPlanSchema>;
export type DesignPlanSource = z.infer<typeof DesignPlanSourceSchema>;
export type DesignPlanCompliance = z.infer<typeof DesignPlanComplianceSchema>;
