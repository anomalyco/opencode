import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function injectTextPart(sessionID: string, messageID: string, text: string): boolean;
export declare function injectTextPartAsync(client: OpencodeClient, sessionID: string, messageID: string, text: string): Promise<boolean>;
export {};
