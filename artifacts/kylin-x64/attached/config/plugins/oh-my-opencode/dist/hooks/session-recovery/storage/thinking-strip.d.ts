import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function stripThinkingParts(messageID: string): boolean;
export declare function stripThinkingPartsAsync(client: OpencodeClient, sessionID: string, messageID: string): Promise<boolean>;
export {};
