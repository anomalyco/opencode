import type { PluginInput } from "@opencode-ai/plugin";
import type { StoredMessageMeta } from "../types";
type OpencodeClient = PluginInput["client"];
export declare function readMessages(sessionID: string): StoredMessageMeta[];
export declare function readMessagesFromSDK(client: OpencodeClient, sessionID: string): Promise<StoredMessageMeta[]>;
export {};
