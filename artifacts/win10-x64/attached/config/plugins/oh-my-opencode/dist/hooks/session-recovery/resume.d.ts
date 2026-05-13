import type { createOpencodeClient } from "@opencode-ai/sdk";
import type { MessageData, ResumeConfig } from "./types";
type Client = ReturnType<typeof createOpencodeClient>;
export declare function findLastUserMessage(messages: MessageData[]): MessageData | undefined;
export declare function extractResumeConfig(userMessage: MessageData | undefined, sessionID: string): ResumeConfig;
export declare function resumeSession(client: Client, config: ResumeConfig): Promise<boolean>;
export {};
