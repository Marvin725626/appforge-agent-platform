import { AgentActionSchema, type AgentAction } from "@appforge/protocol";

function previewModelOutput(text: string): string {
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

export function parseAgentAction(text:string):AgentAction{
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(
            `Model did not return valid JSON. Output preview: ${previewModelOutput(text)}`,
            {
                cause: error,
            },
        );
    }

    const result = AgentActionSchema.safeParse(parsed);

    if (!result.success) {
        throw new Error(
            `Model JSON did not match AgentAction schema. Output preview: ${previewModelOutput(text)}`,
            {
                cause: result.error,
            },
        );
    }

    return result.data;
}
