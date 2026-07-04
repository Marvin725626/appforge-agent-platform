import { z } from "zod";

const WriteFileActionSchema = z.object({
  type: z.literal("write_file"),
  path: z.string().min(1),
  content: z.string(),
});

const RunCommandActionSchema = z.object({
  type: z.literal("run_command"),
  command: z.string().min(1),
  args: z.array(z.string()),
});

const FinishActionSchema = z.object({
  type: z.literal("finish"),
  summary: z.string().min(1),
});

export const AgentActionSchema = z.discriminatedUnion("type", [
  WriteFileActionSchema,
  RunCommandActionSchema,
  FinishActionSchema,
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;
