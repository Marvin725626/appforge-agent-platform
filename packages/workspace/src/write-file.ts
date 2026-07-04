import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./path-policy.js";
export async function writeWorkspaceFile(
    workspaceRoot:string,
    requestedPath:string,
    content:string,
):Promise<void>{
    const safepath=resolveWorkspacePath(workspaceRoot,requestedPath);
    await mkdir(path.dirname(safepath),{recursive:true,});
    await writeFile(safepath,content,"utf8")

}