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
interface DirectoryAgentsInjectorHook {
    "tool.execute.before"?: (input: ToolExecuteInput, output: {
        args: unknown;
    }) => Promise<void>;
    "tool.execute.after": (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>;
    event: (input: EventInput) => Promise<void>;
}
interface EventInput {
    event: {
        type: string;
        properties?: unknown;
    };
}
export declare function createDirectoryAgentsInjectorHook(ctx: PluginInput, modelCacheState?: {
    anthropicContext1MEnabled: boolean;
}): DirectoryAgentsInjectorHook;
export {};
