import type { PluginInput } from "@opencode-ai/plugin";
export declare function detectCompletionInTranscript(transcriptPath: string | undefined, promise: string, startedAt?: string): boolean;
export declare function detectCompletionInSessionMessages(ctx: PluginInput, options: {
    sessionID: string;
    promise: string;
    apiTimeoutMs: number;
    directory: string;
    sinceMessageIndex?: number;
}): Promise<boolean>;
