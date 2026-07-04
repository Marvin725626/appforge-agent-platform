import type {ModelProvider} from "./model-provider.js";
export async function createPlan(
    provider:ModelProvider,
    goal:string,
):Promise<string>{
    const response= await provider.complete({
        messages:[
            {
                role:"system",
                content:
                    "You are a coding agent. Create a short implementation plan.",
            },
            {
                role:"user",
                content:goal,
            },
        ],
    });
    return  response.content;
}
