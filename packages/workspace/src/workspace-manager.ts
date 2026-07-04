import { mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./path-policy.js";

export class WorkspaceManager{
    constructor(private readonly workspacesRoot: string) {}
    async create(runId:string):Promise<string>{
        const workspaceRoot=resolveWorkspacePath(
          this.workspacesRoot,
          runId,
        );
        await mkdir(workspaceRoot,{
            recursive:true
        });
        return workspaceRoot
    }
    resolve(runId:string):string{
        return resolveWorkspacePath(this.workspacesRoot,runId)
    }
}