import type { PluginInput } from "@opencode-ai/plugin";
import type { AtlasHookOptions } from "./types";
export declare function createAtlasHook(ctx: PluginInput, options?: AtlasHookOptions): {
    handler: (arg: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
    "tool.execute.before": (toolInput: {
        tool: string;
        sessionID?: string;
        callID?: string;
    }, toolOutput: {
        args: Record<string, unknown>;
        message?: string;
    }) => Promise<void>;
    "tool.execute.after": (toolInput: import("./types").ToolExecuteAfterInput, toolOutput: import("./types").ToolExecuteAfterOutput) => Promise<void>;
};
