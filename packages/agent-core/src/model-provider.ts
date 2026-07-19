export type ModelRole="system"|"user"|"assistant";

export type ModelMessage = {
    role:ModelRole;
    content:string;
};

export type JsonSchemaValue =
    | string
    | number
    | boolean
    | null
    | JsonSchemaValue[]
    | { [key: string]: JsonSchemaValue };

export type JsonSchemaResponseFormat = {
    type: "json_schema";
    name: string;
    schema: JsonSchemaValue;
    strict?: boolean;
};

export type ModelRequest ={
    messages:ModelMessage[];
    responseFormat?: "json_object" | JsonSchemaResponseFormat;
    stream?: boolean;
    thinking?: {
        type: "enabled" | "disabled" | "auto";
    };
    signal?: AbortSignal;
    onActivity?: () => void;
};
export type ModelResponse= {
    content:string;
    finishReason?: string | null;
    metrics?: {
        durationMs?: number;
        responseLength?: number;
        timeout?: boolean;
        thinkingEnabled?: boolean;
        stream?: boolean;
    };
};
export interface  ModelProvider{
    complete(request:ModelRequest): Promise<ModelResponse>;
}
