export type WorkspaceCommand={
    command:string;
    args:string[];
};
const allowedCommands:WorkspaceCommand[]=[
    {
        command: "npm",
        args: ["install"],
    },
    {
        command: "npm",
        args: ["run", "build"],
    },
    {
        command: "npm",
        args: ["test"],
    },
];
export  function assertCommandAllowed(request:WorkspaceCommand,):void {
    const isAllowed=allowedCommands.some((allowed)=>{
        const sameCommand=allowed.command===request.command;
        const sameArgumentCount=allowed.args.length===request.args.length;

        const sameArguments=allowed.args.every((argument,index)=>{
            return argument===request.args[index];
        });
        return sameCommand&&sameArgumentCount&&sameArguments
    });
    if (!isAllowed) {
        throw new Error(
            `Command is not allowed: ${request.command} ${request.args.join(" ")}`,
        );
    }
}