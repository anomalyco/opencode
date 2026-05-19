import type { PluginInput } from "@opencode-ai/plugin";
export * from "./constants";
export * from "./detector";
export * from "./types";
export declare function createNonInteractiveEnvHook(_ctx: PluginInput): {
    "tool.execute.before": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        args: Record<string, unknown>;
        message?: string;
    }) => Promise<void>;
};
