import type { ActionExecutionResult } from "@appforge/agent-core";
import type { AgentAction } from "@appforge/protocol";
import { readWorkspaceFile } from "@appforge/workspace";
import * as ts from "typescript";

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;

function applyActionToSource(
    action: Extract<AgentAction, { type: "write_file" | "append_file" | "edit_file" }>,
    currentSource: string,
): string | undefined {
    if (action.type === "write_file") {
        return action.content;
    }

    if (action.type === "append_file") {
        return `${currentSource}${action.content}`;
    }

    if (!currentSource.includes(action.oldText)) {
        return undefined;
    }

    return action.replaceAll
        ? currentSource.split(action.oldText).join(action.newText)
        : currentSource.replace(action.oldText, action.newText);
}

function formatDiagnostic(
    diagnostic: ts.Diagnostic,
    fallbackPath: string,
): string {
    const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
    );

    if (!diagnostic.file || diagnostic.start === undefined) {
        return `${fallbackPath}: ${message}`;
    }

    const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start,
    );

    return `${fallbackPath}:${position.line + 1}:${position.character + 1}: ${message}`;
}

export async function validateRepairSourceAction(
    workspaceRoot: string,
    action: AgentAction,
): Promise<ActionExecutionResult | undefined> {
    if (
        (action.type !== "write_file" &&
            action.type !== "append_file" &&
            action.type !== "edit_file") ||
        !SOURCE_FILE_PATTERN.test(action.path)
    ) {
        return undefined;
    }

    let currentSource = "";

    if (action.type !== "write_file") {
        try {
            currentSource = await readWorkspaceFile(
                workspaceRoot,
                action.path,
            );
        } catch {
            return undefined;
        }
    }

    const nextSource = applyActionToSource(action, currentSource);

    if (nextSource === undefined) {
        return undefined;
    }

    const result = ts.transpileModule(nextSource, {
        fileName: action.path,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            allowJs: true,
        },
    });
    const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );

    if (errors.length === 0) {
        return undefined;
    }

    return {
        ok: false,
        changed: false,
        retryable: true,
        message: [
            `Repair action rejected before writing ${action.path} because it would introduce source syntax errors.`,
            ...errors.slice(0, 5).map((diagnostic) =>
                formatDiagnostic(diagnostic, action.path),
            ),
            "Return a smaller corrected edit_file action. Do not rewrite unrelated literals or sections.",
        ].join("\n"),
    };
}
