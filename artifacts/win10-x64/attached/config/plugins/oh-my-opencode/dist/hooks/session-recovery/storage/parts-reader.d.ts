import type { PluginInput } from "@opencode-ai/plugin";
import type { StoredPart } from "../types";
type OpencodeClient = PluginInput["client"];
export declare function readParts(messageID: string): StoredPart[];
export declare function readPartsFromSDK(client: OpencodeClient, sessionID: string, messageID: string): Promise<StoredPart[]>;
export {};
