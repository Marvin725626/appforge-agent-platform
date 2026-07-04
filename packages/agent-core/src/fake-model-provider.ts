import type {
    ModelProvider,
    ModelRequest,
    ModelResponse,
} from "./model-provider.js";

export class FakeModelProvider implements ModelProvider {
    readonly requests: ModelRequest[] = [];

    private readonly responses: ModelResponse[];

    constructor(response: ModelResponse | ModelResponse[]) {
        this.responses = Array.isArray(response) ? response : [response];
    }

    async complete(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);

        const response = this.responses[this.requests.length - 1];

        if (!response) {
            throw new Error("FakeModelProvider has no response for this request");
        }

        return response;
    }
}