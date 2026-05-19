import type { PluginInput } from "@opencode-ai/plugin";
export declare function createEmptyTaskResponseDetectorHook(_ctx: PluginInput): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
