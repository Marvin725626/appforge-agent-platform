import { z } from "zod";

import { RunSchema, RunVersionSchema } from "./run.js";
import { TraceEventSchema } from "./trace.js";

export const RunReportSchema = z.object({
    run: RunSchema,
    generatedAt: z.string(),
    statusLine: z.string(),
    summary: z.object({
        attempts: z.number().int().nonnegative(),
        agentFinished: z.boolean().optional(),
        buildExitCode: z.number().optional(),
        evalPassed: z.boolean().optional(),
        evalPassedChecks: z.number().int().nonnegative(),
        evalTotalChecks: z.number().int().nonnegative(),
        browserPassed: z.boolean().optional(),
        browserPassedChecks: z.number().int().nonnegative(),
        browserTotalChecks: z.number().int().nonnegative(),
        reviewAccepted: z.boolean().optional(),
        reviewReason: z.string().optional(),
    }),
    coordination: z
        .object({
            plan: z.array(z.string()),
            assignments: z.array(
                z.object({
                    role: z.string(),
                    task: z.string(),
                }),
            ),
        })
        .optional(),
    trace: z.array(TraceEventSchema),
    versions: z.array(RunVersionSchema),
    files: z.array(z.string()),
    memory: z.array(
        z.object({
            outcome: z.string(),
            summary: z.string(),
            createdAt: z.string(),
        }),
    ),
    narrative: z.string(),
});

export type RunReport = z.infer<typeof RunReportSchema>;
