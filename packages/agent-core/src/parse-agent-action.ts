import { AgentActionSchema, type AgentAction } from "@appforge/protocol";

function previewModelOutput(text: string): string {
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function extractJsonCandidate(text: string): string {
    const fencedJson = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);

    if (fencedJson?.[1]) {
        return fencedJson[1].trim();
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return text.slice(firstBrace, lastBrace + 1);
    }

    return text;
}

function normalizeAgentActionCandidate(candidate: unknown): unknown {
    if (
        typeof candidate !== "object" ||
        candidate === null ||
        !("action" in candidate) ||
        !("args" in candidate)
    ) {
        return candidate;
    }

    const legacyAction = candidate as {
        action: unknown;
        args: unknown;
    };

    if (
        typeof legacyAction.action !== "string" ||
        typeof legacyAction.args !== "object" ||
        legacyAction.args === null
    ) {
        return candidate;
    }

    return {
        type: legacyAction.action,
        ...legacyAction.args,
    };
}

export function parseAgentAction(text:string):AgentAction{
    let parsed: unknown;

    try {
        parsed = JSON.parse(extractJsonCandidate(text));
    } catch (error) {
        throw new Error(
            `Model did not return valid JSON. Output preview: ${previewModelOutput(text)}`,
            {
                cause: error,
            },
        );
    }

    const result = AgentActionSchema.safeParse(
        normalizeAgentActionCandidate(parsed),
    );

    if (!result.success) {
        const issues = result.error.issues
            .slice(0, 5)
            .map((issue) => {
                const path = issue.path.length > 0
                    ? issue.path.join(".")
                    : "<root>";
                return `${path}: ${issue.message}`;
            })
            .join("; ");

        throw new Error(
            [
                "Model JSON did not match AgentAction schema.",
                issues.length > 0 ? `Validation issues: ${issues}.` : "",
                `Output preview: ${previewModelOutput(text)}`,
            ]
                .filter(Boolean)
                .join(" "),
            {
                cause: result.error,
            },
        );
    }

    return result.data;
}
