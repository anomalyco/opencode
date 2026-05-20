import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function truncateToolOutputsByCallId(sessionID: string, callIds: Set<string>, client?: OpencodeClient): Promise<{
    truncatedCount: number;
}>;
export {};
