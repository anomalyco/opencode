import type { PluginInput } from "@opencode-ai/plugin";
export declare function createIterationSession(ctx: PluginInput, parentSessionID: string, directory: string): Promise<string | null>;
export declare function selectSessionInTui(client: PluginInput["client"], sessionID: string): Promise<boolean>;
