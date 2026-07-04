import { z } from "zod";

export  const TraceEventStatusSchema = z.enum([
    "pending",
    "running",
    "succeeded",
    "failed",
]);

export const TraceEventSchema = z.object({
    id: z.string(),
    label: z.string(),
    status: TraceEventStatusSchema,
    message: z.string().optional(),
    createdAt: z.string(),
})
export type TraceEventStatus = z.infer<typeof TraceEventStatusSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
