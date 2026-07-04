export type Skill = {
    id: string;
    name: string;
    description: string;
    instructions: string[];
};
export const reactViteAppSkill: Skill = {
    id: "react-vite-app",
    name: "React Vite App",
    description: "Generate buildable React/Vite TypeScript apps.",
    instructions: [
        "The workspace is an existing Vite React TypeScript project.",
        "Return only valid JSON actions.",
        "First write src/App.tsx using a write_file action.",
        "src/main.tsx imports a named export with `import { App } from \"./App.js\"`, so src/App.tsx must export `App` as a named export.",
        "Do not use only `export default App`.",
        "All user-facing UI text and page content must use the same natural language as the user's goal.",
        "If the goal is Chinese, write Chinese UI text and page content.",
        "Do not translate the user's requested app into English unless the user asks for English.",
        "If src/App.tsx has already been written successfully, return finish.",
        "Do not edit package.json.",
    ],
};
export function formatSkillInstructions(skill:Skill):string{
    return [
        `Skill: ${skill.name}`,
        skill.description,
        "",
        "Instructions:",
        ...skill.instructions.map((instruction) => `- ${instruction}`),
    ].join("\n");
}