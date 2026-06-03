import type { PluginInput } from "@opencode-ai/plugin";
import type { ModelInfo } from "./types";
type PromptContext = {
    model?: ModelInfo;
    tools?: Record<string, boolean>;
};
export declare function resolveRecentPromptContextForSession(ctx: PluginInput, sessionID: string): Promise<PromptContext>;
export declare function resolveRecentModelForSession(ctx: PluginInput, sessionID: string): Promise<ModelInfo | undefined>;
export {};
