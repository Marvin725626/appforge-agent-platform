import { readFile } from "node:fs/promises";

import { resolveWorkspacePath } from "./path-policy.js";

export async function readWorkspaceFile(
    workspaceRoot: string,
    requestedPath: string,
):Promise<string>{
    const safePath = resolveWorkspacePath(workspaceRoot,requestedPath)
    return readFile(safePath,"utf8");
}