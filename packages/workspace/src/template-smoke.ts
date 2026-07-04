import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { copyWorkspaceTemplate } from "./copy-template.js";
import { runWorkspaceCommand } from "./run-command.js";

const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(),"appforge-template-smoke-"),
);
const templateRoot = path.resolve(
    process.cwd(),
    "../../tests/fixtures/vite-react-starter",
);
await copyWorkspaceTemplate(workspaceRoot,templateRoot);

const installResult = await runWorkspaceCommand(workspaceRoot,{
    command:"npm",
    args:["install"],
});
if (installResult.exitCode !== 0) {
    throw new Error(installResult.stderr || installResult.stdout);
}
const buildResult = await runWorkspaceCommand(workspaceRoot,{
    command: "npm",
    args: ["run", "build"],
});
if (buildResult.exitCode !== 0) {
    throw new Error(buildResult.stderr || buildResult.stdout);
}

console.log(`Template smoke passed in workspace: ${workspaceRoot}`);
