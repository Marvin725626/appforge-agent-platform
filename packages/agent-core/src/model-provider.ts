export type ModelRole="system"|"user"|"assistant";

export type ModelMessage = {
    role:ModelRole;
    content:string;
};
export type ModelRequest ={
    messages:ModelMessage[];
    responseFormat?: "json_object";
    signal?: AbortSignal;
    onActivity?: () => void;
};
export type ModelResponse= {
    content:string;
};
export interface  ModelProvider{
    complete(request:ModelRequest): Promise<ModelResponse>;
}
