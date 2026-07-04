import type { AgentAction } from "@appforge/protocol";
import {
    runWorkspaceCommand,
    writeWorkspaceFile,
} from "@appforge/workspace";

export type ActionExecutionResult = {
    ok: boolean;
    message: string;
};

export type ActionExecutorOptions = {
    workspaceRoot: string;
};

export class ActionExecutor {
    constructor(private readonly options: ActionExecutorOptions) {}

    async execute(action: AgentAction): Promise<ActionExecutionResult> {
        if (action.type === "write_file") {
            await writeWorkspaceFile(
                this.options.workspaceRoot,
                action.path,
                action.content,
            );

            return {
                ok: true,
                message: `Wrote file: ${action.path}`,
            };
        }

        if (action.type==="run_command"){
            const result = await runWorkspaceCommand(this.options.workspaceRoot,{
                command:action.command,
                args:action.args,
            });
            return{
                ok:result.exitCode===0,
                message:[
                    `Command exited with code ${result.exitCode}`,
                    result.stdout,
                    result.stderr,
                ]
                    .filter ((part)=>part.length>0)
                    .join("\n")
            };
        }
        if (action.type === "finish") {
            return {
                ok: true,
                message: action.summary,
            };
        }

        return {
            ok: false,
            message: "Unsupported action",
        };
    }
}
