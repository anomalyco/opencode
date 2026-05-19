import type { PluginInput } from "@opencode-ai/plugin";
import { type ContextLimitModelCacheState } from "../shared/context-limit-resolver";
export declare function createContextWindowMonitorHook(_ctx: PluginInput, modelCacheState?: ContextLimitModelCacheState): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
