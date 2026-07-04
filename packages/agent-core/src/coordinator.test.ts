import { describe, expect, it } from "vitest";
import {
    coordinateAgents,
    formatCoordinationContext,
} from "./coordinator.js";

describe("coordinateAgents", () => {
    it("creates planner, coder, and reviewer assignments", () => {
        const result = coordinateAgents({
            goal: "Create a simple React task app",
        });

        expect(result.goal).toBe("Create a simple React task app");
        expect(result.assignments).toHaveLength(3);

        expect(result.assignments[0]?.role).toBe("planner");
        expect(result.assignments[1]?.role).toBe("coder");
        expect(result.assignments[2]?.role).toBe("reviewer");
    });

    it("keeps the user goal inside each task", () => {
        const result = coordinateAgents({
            goal: "Build a todo app with filters",
        });

        expect(result.assignments.every((assignment) =>
            assignment.task.includes("Build a todo app with filters"),
        )).toBe(true);
    });

    it("creates a structured execution plan", () => {
        const result = coordinateAgents({
            goal: "Create a simple React task app",
        });

        expect(result.plan).toEqual([
            "Prepare the React/Vite workspace",
            "Implement the requested UI in src/App.tsx",
            "Install dependencies and build the app",
            "Evaluate the generated app against the goal",
            "Repair the app if evaluation or review fails",
        ]);
    });
});
it("formats assignments as agent context", () => {
    const coordination = coordinateAgents({
        goal: "Create a task app",
    });

    expect(formatCoordinationContext(coordination)).toBe(
        [
            "Agent plan:",
            "1. Prepare the React/Vite workspace",
            "2. Implement the requested UI in src/App.tsx",
            "3. Install dependencies and build the app",
            "4. Evaluate the generated app against the goal",
            "5. Repair the app if evaluation or review fails",
            "",
            "Agent assignments:",
            "- planner: Break down the product goal: Create a task app",
            "- coder: Implement the app for this goal: Create a task app",
            "- reviewer: Review whether the generated app satisfies this goal: Create a task app",
        ].join("\n"),
    );
});
