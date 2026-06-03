export type RalphLoopStrategy = "reset" | "continue";
export type ParsedRalphLoopArguments = {
    prompt: string;
    maxIterations?: number;
    completionPromise?: string;
    strategy?: RalphLoopStrategy;
};
export declare function parseRalphLoopArguments(rawArguments: string): ParsedRalphLoopArguments;
