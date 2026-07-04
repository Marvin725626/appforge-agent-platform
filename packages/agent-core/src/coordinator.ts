export type AgentRole = "planner" | "coder" | "reviewer";

export type AgentAssignment = {
    role: AgentRole;
    task: string;
};

export type CoordinateAgentsInput = {
    goal: string;
};

export type CoordinateAgentsResult = {
    goal: string;
    assignments: AgentAssignment[];
    plan:string[];
};

export function coordinateAgents(
    input: CoordinateAgentsInput,
): CoordinateAgentsResult {
    return {
        goal: input.goal,
        assignments: [
            {
                role: "planner",
                task: `Break down the product goal: ${input.goal}`,
            },
            {
                role: "coder",
                task: `Implement the app for this goal: ${input.goal}`,
            },
            {
                role: "reviewer",
                task: `Review whether the generated app satisfies this goal: ${input.goal}`,
            },
        ],
        plan: [
            "Prepare the React/Vite workspace",
            "Implement the requested UI in src/App.tsx",
            "Install dependencies and build the app",
            "Evaluate the generated app against the goal",
            "Repair the app if evaluation or review fails",
        ],
    };
}
export function formatCoordinationContext(
    coordination:CoordinateAgentsResult,
):string{
    return [
        "Agent plan:",
        ...coordination.plan.map((step, index) => `${index + 1}. ${step}`),
        "",
        "Agent assignments:",
        ...coordination.assignments.map(
            (assignment) => `- ${assignment.role}: ${assignment.task}`,
        ),
    ].join("\n");
}