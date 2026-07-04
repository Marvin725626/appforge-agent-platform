import { readdir } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./path-policy.js";

export async function listWorkspaceFiles(
  workspaceRoot: string,
  requestedPath = ".",
): Promise<string[]> {
  const directoryPath = resolveWorkspacePath(
    workspaceRoot,
    requestedPath,
  );

  const entries = await readdir(directoryPath, {
    withFileTypes: true,
  });

  return entries.map((entry) => path.relative(workspaceRoot,
          path.join(directoryPath, entry.name),),).sort();
}
