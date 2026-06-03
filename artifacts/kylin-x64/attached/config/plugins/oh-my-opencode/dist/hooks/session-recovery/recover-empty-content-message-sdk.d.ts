import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
type ReplaceEmptyTextPartsAsync = (client: Client, sessionID: string, messageID: string, replacementText: string) => Promise<boolean>;
type InjectTextPartAsync = (client: Client, sessionID: string, messageID: string, text: string) => Promise<boolean>;
type FindMessagesWithEmptyTextPartsFromSDK = (client: Client, sessionID: string) => Promise<string[]>;
export declare function recoverEmptyContentMessageFromSDK(client: Client, sessionID: string, failedAssistantMsg: MessageData, error: unknown, dependencies: {
    placeholderText: string;
    replaceEmptyTextPartsAsync: ReplaceEmptyTextPartsAsync;
    injectTextPartAsync: InjectTextPartAsync;
    findMessagesWithEmptyTextPartsFromSDK: FindMessagesWithEmptyTextPartsFromSDK;
}): Promise<boolean>;
export {};
