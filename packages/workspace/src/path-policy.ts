import path from "node:path"

export function resolveWorkspacePath(
    workspaceRoot:string,
    requestedPath:string,
):string {
    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedPath=path.resolve(resolvedRoot,requestedPath);

    if(
        resolvedPath !==resolvedRoot &&
        !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
    ){
        throw new Error("Path escapes workspace root");
    }

    return resolvedPath;
}
