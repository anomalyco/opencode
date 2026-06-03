import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function replaceEmptyTextParts(messageID: string, replacementText: string): boolean;
export declare function replaceEmptyTextPartsAsync(client: OpencodeClient, sessionID: string, messageID: string, replacementText: string): Promise<boolean>;
export declare function findMessagesWithEmptyTextParts(sessionID: string): string[];
export declare function findMessagesWithEmptyTextPartsFromSDK(client: OpencodeClient, sessionID: string): Promise<string[]>;
export {};
