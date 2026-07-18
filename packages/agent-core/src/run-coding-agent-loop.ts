import {
    runCodingAgentStep,
    type CodingAgentStepMode,
    type RunCodingAgentStepResult,
} from "./run-coding-agent-step.js";
import type { ModelProvider } from "./model-provider.js";
import type { ImageAssetMode } from "./image-asset-provider.js";
import type { ImageAssetTool } from "./image-asset-tool.js";
import { CodingAgent } from "./coding-agent.js";

const MAX_RECENT_STEP_CONTEXTS = 4;
const MAX_READ_RESULT_CONTEXT_CHARACTERS = 1_500;
const MAX_COMMAND_RESULT_CONTEXT_CHARACTERS = 800;
const MAX_OTHER_RESULT_CONTEXT_CHARACTERS = 500;
const MAX_STAGE_METADATA_ITEMS = 16;

function compactContextText(text: string, maxCharacters: number): string {
    if (text.length <= maxCharacters) {
        return text;
    }

    const omission = `\n... omitted ${text.length - maxCharacters} result characters ...\n`;
    const availableCharacters = Math.max(0, maxCharacters - omission.length);
    const headCharacters = Math.ceil(availableCharacters / 2);
    const tailCharacters = Math.floor(availableCharacters / 2);

    return [
        text.slice(0, headCharacters),
        omission,
        tailCharacters > 0 ? text.slice(-tailCharacters) : "",
    ].join("");
}

function uniqueLimited(values: Iterable<string>): string[] {
    return [...new Set(values)]
        .filter((value) => value.length > 0)
        .slice(0, MAX_STAGE_METADATA_ITEMS);
}

function extractSourceMetadata(path: string, content: string): {
    exports: string[];
    cssClasses: string[];
} {
    const exports: string[] = [];
    const cssClasses: string[] = [];

    if (/\.[cm]?[jt]sx?$/iu.test(path)) {
        for (const match of content.matchAll(
            /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gu,
        )) {
            if (match[1]) {
                exports.push(match[1]);
            }
        }

        if (/\bexport\s+default\b/u.test(content)) {
            exports.push("default");
        }

        for (const match of content.matchAll(/\bexport\s*\{([^}]+)\}/gu)) {
            for (const item of (match[1] ?? "").split(",")) {
                const normalized = item
                    .trim()
                    .replace(/^type\s+/u, "")
                    .split(/\s+as\s+/u)
                    .at(-1)
                    ?.trim();

                if (normalized && /^[A-Za-z_$][\w$]*$/u.test(normalized)) {
                    exports.push(normalized);
                }
            }
        }
    }

    if (/\.css$/iu.test(path)) {
        for (const match of content.matchAll(/\.([_a-zA-Z][\w-]*)/gu)) {
            if (match[1]) {
                cssClasses.push(match[1]);
            }
        }
    }

    return {
        exports: uniqueLimited(exports),
        cssClasses: uniqueLimited(cssClasses),
    };
}

function formatExecutionResultContext(
    step: RunCodingAgentStepResult,
): string {
    const maxCharacters =
        step.action.type === "read_file"
            ? MAX_READ_RESULT_CONTEXT_CHARACTERS
            : step.action.type === "run_command"
              ? MAX_COMMAND_RESULT_CONTEXT_CHARACTERS
              : MAX_OTHER_RESULT_CONTEXT_CHARACTERS;

    return compactContextText(step.execution.message, maxCharacters);
}

function formatStepContext(
    step:RunCodingAgentStepResult,
    stepNumber:number,
):string{
    const action = step.action;
    let actionSummary: string;

    switch (action.type) {
        case "write_file":
        case "append_file": {
            const metadata = extractSourceMetadata(
                action.path,
                action.content,
            );
            actionSummary = JSON.stringify({
                type: action.type,
                path: action.path,
                contentCharacters: action.content.length,
                ...(metadata.exports.length > 0
                    ? { exports: metadata.exports }
                    : {}),
                ...(metadata.cssClasses.length > 0
                    ? { cssClasses: metadata.cssClasses }
                    : {}),
            });
            break;
        }
        case "edit_file": {
            const metadata = extractSourceMetadata(
                action.path,
                action.newText,
            );
            actionSummary = JSON.stringify({
                type: action.type,
                path: action.path,
                oldTextCharacters: action.oldText.length,
                newTextCharacters: action.newText.length,
                ...(metadata.exports.length > 0
                    ? { exports: metadata.exports }
                    : {}),
                ...(metadata.cssClasses.length > 0
                    ? { cssClasses: metadata.cssClasses }
                    : {}),
            });
            break;
        }
        case "get_image":
            actionSummary = JSON.stringify({
                type: action.type,
                outputPath: action.outputPath,
                mode: action.mode,
                altText: action.altText,
            });
            break;
        case "run_command":
            actionSummary = JSON.stringify({
                type: action.type,
                command: action.command,
                args: action.args,
            });
            break;
        case "read_file":
            actionSummary = JSON.stringify({
                type: action.type,
                path: action.path,
            });
            break;
        case "finish":
            actionSummary = JSON.stringify(action);
            break;
    }

    return [
        `Step ${stepNumber}:`,
        `Action: ${actionSummary}`,
        `Result: ${formatExecutionResultContext(step)}`,
    ].join("\n");
}

function formatRecentStepContexts(
    steps: RunCodingAgentStepResult[],
): string {
    if (steps.length === 0) {
        return "";
    }

    const startIndex = Math.max(0, steps.length - MAX_RECENT_STEP_CONTEXTS);

    return [
        "Recent execution results:",
        ...steps
            .slice(startIndex)
            .map((step, index) =>
                formatStepContext(step, startIndex + index + 1),
            ),
    ].join("\n\n");
}

function formatCompletedWorkspaceStages(
    steps: RunCodingAgentStepResult[],
): string {
    const stages = new Map<
        string,
        {
            path: string;
            latestAction: "write_file" | "append_file" | "edit_file" | "get_image";
            operations: number;
            exports: string[];
            cssClasses: string[];
        }
    >();

    for (const step of steps) {
        if (!actionChangesWorkspace(step)) {
            continue;
        }

        const action = step.action;

        if (action.type === "get_image") {
            const key = `asset:${action.outputPath}`;
            const previous = stages.get(key);

            stages.set(key, {
                path: action.outputPath,
                latestAction: action.type,
                operations: (previous?.operations ?? 0) + 1,
                exports: [],
                cssClasses: [],
            });
            continue;
        }

        if (
            action.type !== "write_file" &&
            action.type !== "append_file" &&
            action.type !== "edit_file"
        ) {
            continue;
        }

        const content =
            action.type === "edit_file" ? action.newText : action.content;
        const metadata = extractSourceMetadata(action.path, content);
        const previous = stages.get(action.path);
        const resetsFile = action.type === "write_file";

        stages.set(action.path, {
            path: action.path,
            latestAction: action.type,
            operations: (previous?.operations ?? 0) + 1,
            exports: uniqueLimited([
                ...(resetsFile ? [] : previous?.exports ?? []),
                ...metadata.exports,
            ]),
            cssClasses: uniqueLimited([
                ...(resetsFile ? [] : previous?.cssClasses ?? []),
                ...metadata.cssClasses,
            ]),
        });
    }

    const completed = [...stages.values()].map((stage) => {
        const details = [
            `latest: ${stage.latestAction}`,
            `successful operations: ${stage.operations}`,
            ...(stage.exports.length > 0
                ? [`exports: ${stage.exports.join(", ")}`]
                : []),
            ...(stage.cssClasses.length > 0
                ? [`CSS classes: ${stage.cssClasses.join(", ")}`]
                : []),
        ];

        return `- ${stage.path} (${details.join("; ")})`;
    });

    return completed.length > 0
        ? [
              "Completed workspace stages in this attempt:",
              ...completed,
              "Continue with the next missing file or finish. Do not rewrite a completed file unless its last action failed.",
          ].join("\n")
        : "";
}

function actionChangesWorkspace(step: RunCodingAgentStepResult): boolean {
    return (
        step.execution.ok &&
        step.execution.changed !== false &&
        (step.action.type === "write_file" ||
            step.action.type === "append_file" ||
            step.action.type === "edit_file" ||
            step.action.type === "get_image")
    );
}

function requiresDraftChange(goal: string, context: string): boolean {
    return /Iteration request:|Continuation repair request:|Newest human feedback|Human repair feedback|Repair request:/u.test(
        `${goal}\n${context}`,
    );
}

export type RunCodingAgentLoopOptions = {
    goal: string;
    model: ModelProvider;
    workspaceRoot: string;
    maxSteps: number;
    /**
     * Require this loop invocation to make at least one real workspace change
     * before a finish action can be accepted. This is opt-in so existing
     * callers keep the legacy continuation-context behaviour by default.
     */
    requireWorkspaceChange?: boolean;
    context?: string;
    imageAssetTool?: ImageAssetTool;
    imageAssetModes?: ImageAssetMode[];
    mode?: CodingAgentStepMode;
    signal?: AbortSignal;
};

export type RunCodingAgentLoopResult = {
    steps: RunCodingAgentStepResult[];
    finished: boolean;
    errorMessage?: string;
    stopReason?:
        | "finish"
        | "finish_after_max_steps"
        | "action_failed"
        | "model_error"
        | "max_steps_reached";
};

async function askForFinalFinishAction(
    options: RunCodingAgentLoopOptions,
    context: string,
): Promise<RunCodingAgentStepResult | undefined> {
    const signal = options.signal;
    const agent = new CodingAgent({
        model: signal
            ? {
                  complete: (request: Parameters<ModelProvider["complete"]>[0]) =>
                      options.model.complete({
                          ...request,
                          signal,
                      }),
              }
            : options.model,
    });

    try {
        options.signal?.throwIfAborted();
        const action = await agent.decideNextAction(
            options.goal,
            [
                context,
                "Finalization step:",
                "The allowed implementation steps are already used.",
                'Return only {"type":"finish","summary":"..."} if the requested app is complete.',
                "Do not return write_file, get_image, or run_command in this finalization step.",
                "Do not return append_file in this finalization step.",
            ].join("\n\n"),
        );
        options.signal?.throwIfAborted();

        if (action.type !== "finish") {
            return undefined;
        }

        return {
            action,
            execution: {
                ok: true,
                message: action.summary,
            },
        };
    } catch (error) {
        if (options.signal?.aborted) {
            options.signal.throwIfAborted();
        }
        return undefined;
    }
}

export async function runCodingAgentLoop(
    options: RunCodingAgentLoopOptions,
): Promise<RunCodingAgentLoopResult> {
    const steps: RunCodingAgentStepResult[] = [];
    const baseContext = options.context ?? "";
    const loopFeedback: string[] = [];
    const explicitlyRequiresWorkspaceChange =
        options.requireWorkspaceChange === true;
    const mustChangeDraft =
        explicitlyRequiresWorkspaceChange ||
        requiresDraftChange(options.goal, baseContext);

    const formatCurrentContext = (...additionalParts: string[]): string =>
        [
            baseContext,
            loopFeedback.join("\n\n"),
            formatRecentStepContexts(steps),
            ...additionalParts,
        ]
            .filter((part) => part.length > 0)
            .join("\n\n");

    for (let index = 0; index < options.maxSteps; index += 1) {
        options.signal?.throwIfAborted();
        const remainingSteps = options.maxSteps - index;
        const hasChangedWorkspace = steps.some(actionChangesWorkspace);
        const stepBudgetContext = [
            "Agent loop status:",
            `You have ${remainingSteps} action step(s) remaining in this attempt.`,
            formatCompletedWorkspaceStages(steps),
            mustChangeDraft && !hasChangedWorkspace
                ? explicitlyRequiresWorkspaceChange
                    ? "This request requires at least one actual workspace change. You have not changed the workspace in this attempt yet. Do not return finish until you have written a changed file or saved a needed image."
                    : "This is a continuation or repair request. You have not changed the workspace in this attempt yet. Do not return finish until you have written a changed file or saved a needed image."
                : "",
            remainingSteps === 2
                ? "You are near the end. If the essential files are already written, return finish on this or the next step instead of starting another large rewrite."
                : "",
            remainingSteps === 1
                ? "This is the final allowed action. If the requested app is complete, return a finish action instead of rewriting files."
                : "",
        ]
            .filter((part) => part.length > 0)
            .join("\n");

        let step: RunCodingAgentStepResult;

        try {
            step = await runCodingAgentStep({
                goal: options.goal,
                model: options.model,
                workspaceRoot: options.workspaceRoot,
                ...(options.mode ? { mode: options.mode } : {}),
                context: formatCurrentContext(stepBudgetContext),
                ...(options.imageAssetTool
                    ? {
                          imageAssetTool:
                              options.imageAssetTool,
                      }
                    : {}),
                ...(options.imageAssetModes
                    ? { imageAssetModes: options.imageAssetModes }
                    : {}),
                ...(options.signal ? { signal: options.signal } : {}),
            });
        } catch (error) {
            if (options.signal?.aborted) {
                options.signal.throwIfAborted();
            }
            return {
                steps,
                finished: false,
                stopReason: "model_error",
                errorMessage:
                    error instanceof Error
                        ? error.message
                        : "Agent model request failed",
            };
        }

        if (
            step.action.type === "finish" &&
            mustChangeDraft &&
            !hasChangedWorkspace
        ) {
            const prematureFinishFeedback = [
                "Premature finish rejected:",
                explicitlyRequiresWorkspaceChange
                    ? "This request requires a workspace change, but no file or image changed in this attempt."
                    : "The request asked for a continuation or repair, but no file or image changed in this attempt.",
                "Make one focused edit_file, write_file, append_file, or get_image action that applies the requested feedback.",
            ].join("\n");

            if (!loopFeedback.includes(prematureFinishFeedback)) {
                loopFeedback.push(prematureFinishFeedback);
            }

            continue;
        }

        steps.push(step);
        if (step.action.type === "finish") {
            return {
                steps,
                finished: true,
                stopReason: "finish",
            };
        }

        if (!step.execution.ok) {
            return {
                steps,
                finished: false,
                stopReason: "action_failed",
            };
        }
    }

    const finalFinishStep = mustChangeDraft && !steps.some(actionChangesWorkspace)
        ? undefined
        : await askForFinalFinishAction(
            options,
            formatCurrentContext(
                formatCompletedWorkspaceStages(steps),
            ),
        );

    if (finalFinishStep) {
        steps.push(finalFinishStep);

        return {
            steps,
            finished: true,
            stopReason: "finish_after_max_steps",
        };
    }

    return {
        steps,
        finished: false,
        stopReason: "max_steps_reached",
    };
}
