import path from "node:path";
import { access, cp, mkdir, rm } from "node:fs/promises";

const SNAPSHOT_ENTRIES = [
    "src",
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
];

async function pathExists(filePath:string):Promise<boolean>{
    try{
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

export  async function saveRunVersionSnapshot(input:{
    workspaceRoot:string;
    versionNumber:number;
}):Promise<string>{
    const snapshotRoot = path.join(
        input.workspaceRoot,
        "versions",
        `v${input.versionNumber}`,
    );
    await rm(snapshotRoot,{
        recursive:true,
        force:true,
    });
    await mkdir(snapshotRoot,{
        recursive:true,
    });

    for (const entry of SNAPSHOT_ENTRIES){
        const sourcePath=path.join(input.workspaceRoot,entry);
        const targetPath = path.join(snapshotRoot,entry);

        if(!(await pathExists(sourcePath))){
            continue;
        }

        await cp(sourcePath, targetPath, {
            recursive: true,
        });
    }

    return snapshotRoot;
}