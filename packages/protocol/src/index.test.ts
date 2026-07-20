import { describe, expect, it } from "vitest";

import {
  CreateRunInputSchema,
  PROTOCOL_VERSION,
  RunSchema,
  RunOperationStageSchema,
  RunStatusSchema,
} from "./index.js";



describe("protocol package", () => {
  it("exposes its current protocol version", () => {
    expect(PROTOCOL_VERSION).toBe("0.1.0");
  });
});

import type { Run } from "./index.js";

describe("Run",()=>{
  it("accept a valid run object",()=>{
    const run:Run={
      id: "run-001",
      goal: "Create a task management application",
      status: "planning",
      createdAt: "2026-06-09T10:00:00.000Z",
    };
    expect(run.status).toBe("planning");
  });
});

describe("RunStatusSchema",()=>{
  it("accepts a valid status at runtime",()=>{
      expect(RunStatusSchema.parse("planning")).toBe("planning");
      expect(RunStatusSchema.parse("running")).toBe("running");
      expect(RunStatusSchema.parse("succeeded")).toBe("succeeded");
  });

  it("rejects an invalid status at runtime", () => {
    expect(() => RunStatusSchema.parse("unknown")).toThrow();
  });
});
describe("RunSchema", () => {
  it("returns success for a valid run", () => {
    const result = RunSchema.safeParse({
      id: "run-001",
      goal: "Create a task management application",
      status: "planning",
      createdAt: "2026-06-10T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("accepts bounded live operation progress metadata", () => {
    const result = RunSchema.safeParse({
      id: "run-live",
      goal: "Create a routed application",
      status: "running",
      operation: "initial_generation",
      operationId: "operation-1",
      operationStage: "building",
      operationStartedAt: "2026-07-16T04:00:00.000Z",
      operationUpdatedAt: "2026-07-16T04:01:00.000Z",
      createdAt: "2026-07-16T03:59:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(RunOperationStageSchema.safeParse("thinking").success).toBe(false);
  });

  it("returns errors for an invalid run", () => {
    const result = RunSchema.safeParse({
      id: "",
      goal: "",
      status: "unknown",
      createdAt: "today",
    });

    expect(result.success).toBe(false);
  });
});

describe ("CreateRunInputSchema",()=>{
  it("trims and acepts a valid goal",()=>{
    const result=CreateRunInputSchema.parse({
      goal: "  Create a task application  ",
    });

    expect(result.goal).toBe("Create a task application");
  });
  it("rejects an empty goal", () => {
    const result = CreateRunInputSchema.safeParse({
      goal: "   ",
    });

    expect(result.success).toBe(false);
  });
});
import { AgentActionSchema } from "./index.js";

describe("AgentActionSchema", () => {
  it("accepts a write_file action", () => {
    const action = AgentActionSchema.parse({
      type: "write_file",
      path: "src/App.tsx",
      content: "export default function App() {}",
    });

    expect(action.type).toBe("write_file");
  });

  it("accepts a complete generated App.tsx larger than the old 6000-character limit", () => {
    const result = AgentActionSchema.safeParse({
      type: "write_file",
      path: "src/App.tsx",
      content: "x".repeat(12_000),
    });

    expect(result.success).toBe(true);
  });

  it("rejects a write_file action above the bounded protocol limit", () => {
    const result = AgentActionSchema.safeParse({
      type: "write_file",
      path: "src/App.tsx",
      content: "x".repeat(40_001),
    });

    expect(result.success).toBe(false);
  });

  it("accepts an edit_file action", () => {
    const action = AgentActionSchema.parse({
      type: "edit_file",
      path: "src/App.tsx",
      oldText: 'href="#"',
      newText: 'href="#about"',
    });

    expect(action).toEqual({
      type: "edit_file",
      path: "src/App.tsx",
      oldText: 'href="#"',
      newText: 'href="#about"',
    });
  });

  it("rejects an edit_file action without oldText", () => {
    const result = AgentActionSchema.safeParse({
      type: "edit_file",
      path: "src/App.tsx",
      oldText: "",
      newText: "replacement",
    });

    expect(result.success).toBe(false);
  });

  it("accepts an append_file action", () => {
    const action = AgentActionSchema.parse({
      type: "append_file",
      path: "src/content.ts",
      content: "export const extraSections = [];",
    });

    expect(action).toEqual({
      type: "append_file",
      path: "src/content.ts",
      content: "export const extraSections = [];",
    });
  });

  it("rejects an oversized append_file action", () => {
    const result = AgentActionSchema.safeParse({
      type: "append_file",
      path: "src/content.ts",
      content: "x".repeat(4001),
    });

    expect(result.success).toBe(false);
  });

  it("accepts a run_command action", () => {
    const action = AgentActionSchema.parse({
      type: "run_command",
      command: "npm",
      args: ["run", "build"],
    });

    expect(action.type).toBe("run_command");
  });

  it("rejects an unknown action", () => {
    const result = AgentActionSchema.safeParse({
      type: "delete_workspace",
    });

    expect(result.success).toBe(false);
  });
  it("accepts a get_image action", () => {
    const action = AgentActionSchema.parse({
      type: "get_image",
      query: "温州江心屿日落",
      mode: "search",
      altText: "夕阳下的温州江心屿",
      outputPath:
          "public/assets/jiangxinyu.jpg",
    });

    expect(action).toEqual({
      type: "get_image",
      query: "温州江心屿日落",
      mode: "search",
      altText: "夕阳下的温州江心屿",
      outputPath:
          "public/assets/jiangxinyu.jpg",
    });
  });

  it("rejects a get_image action with an empty query", () => {
    const result = AgentActionSchema.safeParse({
      type: "get_image",
      query: "   ",
      mode: "search",
      altText: "温州风景",
      outputPath:
          "public/assets/wenzhou.jpg",
    });

    expect(result.success).toBe(false);
  });
});
