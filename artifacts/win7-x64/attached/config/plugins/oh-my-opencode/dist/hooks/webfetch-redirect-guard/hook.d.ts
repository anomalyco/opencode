import type { PluginInput } from "@opencode-ai/plugin";
type ToolExecuteInput = {
    tool: string;
    sessionID: string;
    callID: string;
};
type ToolExecuteBeforeOutput = {
    args: Record<string, unknown>;
};
type ToolExecuteAfterOutput = {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
};
export declare function createWebFetchRedirectGuardHook(_ctx: PluginInput): {
    "tool.execute.before": (input: ToolExecuteInput, output: ToolExecuteBeforeOutput) => Promise<void>;
    "tool.execute.after": (input: ToolExecuteInput, output: ToolExecuteAfterOutput) => Promise<void>;
};
export {};
