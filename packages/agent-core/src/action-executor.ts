import type { AgentAction } from "@appforge/protocol";
import {
    readWorkspaceFile,
    runWorkspaceCommand,
    writeWorkspaceFile,
} from "@appforge/workspace";
import type { ImageAssetTool } from "./image-asset-tool.js";

export type ActionExecutionResult = {
    ok: boolean;
    message: string;
    /**
     * Whether the action actually changed workspace state. The field is
     * optional so callers that construct synthetic execution results keep the
     * previous behaviour; mutating actions are assumed to have changed state
     * unless the executor explicitly reports an idempotent no-op.
     */
    changed?: boolean;
};

export type ActionExecutorOptions = {
    workspaceRoot: string;
    imageAssetTool?: ImageAssetTool;
    signal?: AbortSignal;
};

export class ActionExecutor {
    constructor(private readonly options: ActionExecutorOptions) {}

    async execute(action: AgentAction): Promise<ActionExecutionResult> {
        this.options.signal?.throwIfAborted();
        if (action.type === "write_file") {
            try {
                const currentContent = await readWorkspaceFile(
                    this.options.workspaceRoot,
                    action.path,
                );

                if (currentContent === action.content) {
                    return {
                        ok: true,
                        changed: false,
                        message: `Skipped unchanged file: ${action.path}`,
                    };
                }
            } catch {
                this.options.signal?.throwIfAborted();
                // The file does not exist yet (or cannot be read). Let the
                // normal write path create it or surface the policy error.
            }

            this.options.signal?.throwIfAborted();
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

        if (action.type === "append_file") {
            let currentContent = "";

            try {
                currentContent = await readWorkspaceFile(
                    this.options.workspaceRoot,
                    action.path,
                );
            } catch {
                this.options.signal?.throwIfAborted();
                currentContent = "";
            }

            if (
                action.content.length === 0 ||
                currentContent.endsWith(action.content)
            ) {
                return {
                    ok: true,
                    changed: false,
                    message: `Skipped duplicate append: ${action.path}`,
                };
            }

            this.options.signal?.throwIfAborted();
            await writeWorkspaceFile(
                this.options.workspaceRoot,
                action.path,
                `${currentContent}${action.content}`,
            );

            return {
                ok: true,
                message: `Appended file: ${action.path}`,
            };
        }

        if (action.type === "edit_file") {
            const currentContent = await readWorkspaceFile(
                this.options.workspaceRoot,
                action.path,
            );
            this.options.signal?.throwIfAborted();

            if (!currentContent.includes(action.oldText)) {
                if (
                    action.newText.length > 0 &&
                    currentContent.includes(action.newText)
                ) {
                    return {
                        ok: true,
                        changed: false,
                        message: `Skipped already-applied edit: ${action.path}`,
                    };
                }

                return {
                    ok: false,
                    message: `Edit target not found in file: ${action.path}`,
                };
            }

            const nextContent = action.replaceAll
                ? currentContent.split(action.oldText).join(action.newText)
                : currentContent.replace(action.oldText, action.newText);

            if (nextContent === currentContent) {
                return {
                    ok: true,
                    changed: false,
                    message: `Skipped unchanged edit: ${action.path}`,
                };
            }

            this.options.signal?.throwIfAborted();
            await writeWorkspaceFile(
                this.options.workspaceRoot,
                action.path,
                nextContent,
            );

            return {
                ok: true,
                message: `Edited file: ${action.path}`,
            };
        }

        if (action.type === "read_file") {
            const content = await readWorkspaceFile(
                this.options.workspaceRoot,
                action.path,
            );
            this.options.signal?.throwIfAborted();
            const lines = content.split(/\r?\n/u);
            const startLine = action.startLine ?? 1;
            const requestedEndLine = action.endLine ?? startLine + 199;
            const endLine = Math.min(
                lines.length,
                Math.max(startLine, requestedEndLine),
            );
            const excerpt = lines
                .slice(startLine - 1, endLine)
                .map((line, index) => `${startLine + index}: ${line}`)
                .join("\n")
                .slice(0, 12_000);

            return {
                ok: true,
                message: [
                    `Read file: ${action.path}`,
                    `Lines ${startLine}-${endLine} of ${lines.length}`,
                    excerpt,
                ].join("\n"),
            };
        }

        if (action.type==="run_command"){
            const result = await runWorkspaceCommand(this.options.workspaceRoot,{
                command:action.command,
                args:action.args,
            }, this.options.signal ? { signal: this.options.signal } : {});
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
        if (action.type === "get_image") {
            if (!this.options.imageAssetTool) {
                return {
                    ok: false,
                    message: "Image asset tool is not configured",
                };
            }

            try {
                const saved =
                    await this.options.imageAssetTool.save({
                        request: {
                            query: action.query,
                            mode: action.mode,
                            altText: action.altText,
                        },
                        outputPath: action.outputPath,
                        ...(this.options.signal
                            ? { signal: this.options.signal }
                            : {}),
                    });

                this.options.signal?.throwIfAborted();

                return {
                    ok: true,
                    message: [
                        `Saved image: ${saved.path}`,
                        `Media type: ${saved.mediaType}`,
                        `Source: ${saved.source}`,
                        ...(saved.attribution
                            ? [`Attribution: ${saved.attribution}`]
                            : []),
                        `Bytes: ${saved.byteLength}`,
                    ].join("\n"),
                };
            } catch (error) {
                if (this.options.signal?.aborted) {
                    this.options.signal.throwIfAborted();
                }
                return {
                    ok: false,
                    message:
                        error instanceof Error
                            ? `Image request failed: ${error.message}`
                            : "Image request failed",
                };
            }
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
