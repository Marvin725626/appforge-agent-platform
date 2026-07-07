import { z } from "zod"
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

export const RunSchema=z.object({
  id:z.string().min(1),
  goal: z.string().min(1),
  status: RunStatusSchema,
  createdAt: z.iso.datetime(),
});
export type Run= z.infer<typeof RunSchema>;

export const RunVersionSchema = z.object({
  id:z.string(),
  runId:z.string(),
  versionNumber:z.number().int().positive(),
  goal:z.string(),
  summary:z.string(),
  createdAt:z.string(),
});
export const CreateRunInputSchema = z.object({
  goal:z.string().trim().min(1).max(2000),
});

export type CreateRunInput = z.infer<typeof CreateRunInputSchema>
export type RunVersion = z.infer<typeof RunVersionSchema>;
