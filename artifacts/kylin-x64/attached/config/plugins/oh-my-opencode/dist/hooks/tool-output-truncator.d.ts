import type { PluginInput } from "@opencode-ai/plugin";
import type { ExperimentalConfig } from "../config/schema";
interface ToolOutputTruncatorOptions {
    modelCacheState?: {
        anthropicContext1MEnabled: boolean;
        modelContextLimitsCache?: Map<string, number>;
    };
    experimental?: ExperimentalConfig;
}
export declare function createToolOutputTruncatorHook(ctx: PluginInput, options?: ToolOutputTruncatorOptions): {
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
export {};
