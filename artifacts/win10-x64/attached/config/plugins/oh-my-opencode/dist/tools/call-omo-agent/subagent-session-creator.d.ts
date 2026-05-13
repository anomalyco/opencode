import type { PluginInput } from "@opencode-ai/plugin";
import type { CallOmoAgentArgs } from "./types";
import type { ToolContextWithMetadata } from "./tool-context-with-metadata";
export declare function resolveOrCreateSessionId(ctx: PluginInput, args: CallOmoAgentArgs, toolContext: ToolContextWithMetadata): Promise<{
    ok: true;
    sessionID: string;
} | {
    ok: false;
    error: string;
}>;
