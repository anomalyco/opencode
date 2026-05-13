import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
export declare function recoverToolResultMissing(client: Client, sessionID: string, failedAssistantMsg: MessageData): Promise<boolean>;
export {};
