import type { PluginInput } from "@opencode-ai/plugin";
interface ToolExecuteInput {
    tool: string;
    sessionID: string;
    callID: string;
}
interface ToolExecuteOutput {
    title: string;
    output: string;
    metadata: unknown;
}
interface ToolExecuteBeforeOutput {
    args: unknown;
}
interface EventInput {
    event: {
        type: string;
        properties?: unknown;
    };
}
export declare function createRulesInjectorHook(ctx: PluginInput, modelCacheState?: {
    anthropicContext1MEnabled: boolean;
}, options?: {
    skipClaudeUserRules?: boolean;
}): {
    "tool.execute.before": (input: ToolExecuteInput, output: ToolExecuteBeforeOutput) => Promise<void>;
    "tool.execute.after": (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>;
    event: ({ event }: EventInput) => Promise<void>;
};
export {};
