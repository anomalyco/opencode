import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
export declare function recoverThinkingBlockOrder(client: Client, sessionID: string, _failedAssistantMsg: MessageData, _directory: string, error: unknown): Promise<boolean>;
export {};
