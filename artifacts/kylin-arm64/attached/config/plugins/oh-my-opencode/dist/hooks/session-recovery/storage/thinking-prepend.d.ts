import type { PluginInput } from "@opencode-ai/plugin";
import type { MessageData, StoredPart } from "../types";
import { log, isSqliteBackend, patchPart } from "../../../shared";
type OpencodeClient = PluginInput["client"];
type StoredSignedThinkingPart = StoredPart & {
    type: "thinking" | "redacted_thinking";
    signature: string;
};
type SDKMessagePart = NonNullable<MessageData["parts"]>[number];
type SDKSignedThinkingPart = SDKMessagePart & {
    id: string;
    type: "thinking" | "redacted_thinking";
    signature: string;
};
type ThinkingPrependDeps = {
    isSqliteBackend: typeof isSqliteBackend;
    patchPart: typeof patchPart;
    log: typeof log;
    findLastThinkingPart: typeof findLastThinkingPart;
    findLastThinkingPartFromSDK: typeof findLastThinkingPartFromSDK;
    readTargetPartIDs: typeof readTargetPartIDs;
    readTargetPartIDsFromSDK: typeof readTargetPartIDsFromSDK;
};
declare function readTargetPartIDs(messageID: string): string[];
declare function readTargetPartIDsFromSDK(client: OpencodeClient, sessionID: string, messageID: string): Promise<string[]>;
declare function findLastThinkingPart(sessionID: string, beforeMessageID: string): StoredSignedThinkingPart | null;
export declare function prependThinkingPart(sessionID: string, messageID: string, deps?: ThinkingPrependDeps): boolean;
declare function findLastThinkingPartFromSDK(client: OpencodeClient, sessionID: string, beforeMessageID: string): Promise<SDKSignedThinkingPart | null>;
export declare function prependThinkingPartAsync(client: OpencodeClient, sessionID: string, messageID: string, deps?: ThinkingPrependDeps): Promise<boolean>;
export {};
