import { z } from "zod";

const WriteFileActionSchema = z.object({
  type: z.literal("write_file"),
  path: z.string().min(1),
  content: z.string().max(
      6000,
      "write_file content is too large; split complex pages into smaller files such as src/content.ts, src/App.css, and src/App.tsx",
  ),
});

const AppendFileActionSchema = z.object({
  type: z.literal("append_file"),
  path: z.string().min(1),
  content: z.string().min(1).max(
      4000,
      "append_file content is too large; append a smaller chunk",
  ),
});

const EditFileActionSchema = z.object({
  type: z.literal("edit_file"),
  path: z.string().min(1),
  oldText: z.string().min(1).max(6000),
  newText: z.string().max(6000),
  replaceAll: z.boolean().optional(),
});

const ReadFileActionSchema = z.object({
  type: z.literal("read_file"),
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

const RunCommandActionSchema = z.object({
  type: z.literal("run_command"),
  command: z.string().min(1),
  args: z.array(z.string()),
});
const GetImageActionSchema = z.object({
  type: z.literal("get_image"),
  query: z.string().trim().min(1).max(500),
  mode: z.enum([
    "search",
    "generate",
  ]),
  altText: z.string().trim().min(1).max(500),
  outputPath: z.string().trim().min(1).max(500),
});
const FinishActionSchema = z.object({
  type: z.literal("finish"),
  summary: z.string().min(1),
});

export const AgentActionSchema = z.discriminatedUnion("type", [
  WriteFileActionSchema,
  AppendFileActionSchema,
  EditFileActionSchema,
  ReadFileActionSchema,
  RunCommandActionSchema,
  GetImageActionSchema,
  FinishActionSchema,
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;
