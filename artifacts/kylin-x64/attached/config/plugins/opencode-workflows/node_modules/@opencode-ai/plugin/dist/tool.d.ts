import { z } from "zod";
export type ToolContext = {
    sessionID: string;
    messageID: string;
    agent: string;
    /**
     * Current project directory for this session.
     * Prefer this over process.cwd() when resolving relative paths.
     */
    directory: string;
    /**
     * Project worktree root for this session.
     * Useful for generating stable relative paths (e.g. path.relative(worktree, absPath)).
     */
    worktree: string;
    abort: AbortSignal;
    metadata(input: {
        title?: string;
        metadata?: {
            [key: string]: any;
        };
    }): void;
    ask(input: AskInput): Promise<void>;
};
type AskInput = {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: {
        [key: string]: any;
    };
};
export declare function tool<Args extends z.ZodRawShape>(input: {
    description: string;
    args: Args;
    execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>;
}): {
    description: string;
    args: Args;
    execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>;
};
export declare namespace tool {
    var schema: typeof z;
}
export type ToolDefinition = ReturnType<typeof tool>;
export {};
