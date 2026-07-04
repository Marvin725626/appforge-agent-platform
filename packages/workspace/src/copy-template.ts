import { cp } from "node:fs/promises";

import { resolveWorkspacePath } from "./path-policy.js";

export async function copyWorkspaceTemplate(
    workspaceRoot: string,
    templateRoot: string,
    requestedPath = ".",
): Promise<void> {
    const destination = resolveWorkspacePath(
        workspaceRoot,
        requestedPath,
    );

    await cp(templateRoot, destination, {
        recursive: true,
        force: true,
    });
}