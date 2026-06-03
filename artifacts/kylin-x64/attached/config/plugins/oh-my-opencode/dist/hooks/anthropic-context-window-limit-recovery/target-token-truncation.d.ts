import type { PluginInput } from "@opencode-ai/plugin";
import type { AggressiveTruncateResult } from "./tool-part-types";
type OpencodeClient = PluginInput["client"];
export declare function truncateUntilTargetTokens(sessionID: string, currentTokens: number, maxTokens: number, targetRatio?: number, charsPerToken?: number, client?: OpencodeClient): Promise<AggressiveTruncateResult>;
export {};
