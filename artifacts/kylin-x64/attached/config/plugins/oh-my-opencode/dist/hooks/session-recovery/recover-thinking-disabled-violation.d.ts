import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
export declare function recoverThinkingDisabledViolation(client: Client, sessionID: string, _failedAssistantMsg: MessageData): Promise<boolean>;
export {};
