import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./path-policy.js";

export async function writeWorkspaceBinaryFile(
    workspaceRoot:string,
    requestedPath:string,
    data:Uint8Array,
):Promise<void>{
    const safePath = resolveWorkspacePath(
        workspaceRoot,
        requestedPath,
    );
    await mkdir(path.dirname(safePath), {
        recursive: true,
    });

    await writeFile(safePath, data);
}