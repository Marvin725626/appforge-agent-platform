import { z } from "zod"
import { DesignPlanSchema, DesignPlanSourceSchema } from "./design-plan.js";
export const RunStatusSchema = z.enum([
  "queued",
  "planning",
  "running",
  "executing",
  "validating",
  "repairing",
  "evaluating",
  "succeeded",
  "failed",
  "waiting_for_human",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunOperationSchema = z.enum([
  "initial_generation",
  "iteration",
  "repair",
  "retry",
]);
export type RunOperation = z.infer<typeof RunOperationSchema>;

export const RunOperationStageSchema = z.enum([
  "preparing",
  "planning",
  "coding",
  "installing",
  "building",
  "evaluating",
  "reviewing",
  "repairing",
]);
export type RunOperationStage = z.infer<typeof RunOperationStageSchema>;

export const RunSchema=z.object({
  id:z.string().min(1),
  goal: z.string().min(1),
  status: RunStatusSchema,
  operation: RunOperationSchema.optional(),
  operationId: z.string().min(1).optional(),
  operationStage: RunOperationStageSchema.optional(),
  operationStartedAt: z.iso.datetime().optional(),
  operationUpdatedAt: z.iso.datetime().optional(),
  operationPrompt: z.string().min(1).max(2000).optional(),
  errorMessage: z.string().min(1).max(4000).optional(),
  createdAt: z.iso.datetime(),
});
export type Run= z.infer<typeof RunSchema>;

export const RunVersionSchema = z.object({
  id:z.string(),
  runId:z.string(),
  versionNumber:z.number().int().positive(),
  snapshotId:z.string().min(1).optional(),
  goal:z.string(),
  summary:z.string(),
  review: z.object({
    accepted: z.boolean(),
    reason: z.string(),
    checks: z.object({
      agentFinished: z.boolean(),
      installPassed: z.boolean(),
      buildPassed: z.boolean(),
      evalPassed: z.boolean(),
      browserPassed: z.boolean().optional(),
    }),
  }).optional(),
  designPlan: DesignPlanSchema.optional(),
  designPlanSource: DesignPlanSourceSchema.optional(),
  createdAt:z.string(),
});
export const CreateRunInputSchema = z.object({
  goal:z.string().trim().min(1).max(2000),
});

export type CreateRunInput = z.infer<typeof CreateRunInputSchema>
export type RunVersion = z.infer<typeof RunVersionSchema>;
