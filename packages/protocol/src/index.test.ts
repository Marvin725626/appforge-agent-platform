import { describe, expect, it } from "vitest";

import {
  CreateRunInputSchema,
  PROTOCOL_VERSION,
  RunSchema,
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
});
