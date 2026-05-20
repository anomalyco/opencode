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
interface EventInput {
    event: {
        type: string;
        properties?: unknown;
    };
}
export declare function createAgentUsageReminderHook(_ctx: PluginInput): {
    "tool.execute.after": (input: ToolExecuteInput, output: ToolExecuteOutput) => Promise<void>;
    event: ({ event }: EventInput) => Promise<void>;
};
export {};
