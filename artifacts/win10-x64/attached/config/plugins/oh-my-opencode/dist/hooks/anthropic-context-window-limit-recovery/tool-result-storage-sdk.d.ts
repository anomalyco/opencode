import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolResultInfo } from "./tool-part-types";
type OpencodeClient = PluginInput["client"];
interface SDKToolPart {
    id: string;
    type: string;
    callID?: string;
    tool?: string;
    state?: {
        status?: string;
        input?: Record<string, unknown>;
        output?: string;
        error?: string;
        time?: {
            start?: number;
            end?: number;
            compacted?: number;
        };
    };
}
export declare function findToolResultsBySizeFromSDK(client: OpencodeClient, sessionID: string): Promise<ToolResultInfo[]>;
export declare function truncateToolResultAsync(client: OpencodeClient, sessionID: string, messageID: string, partId: string, part: SDKToolPart): Promise<{
    success: boolean;
    toolName?: string;
    originalSize?: number;
}>;
export declare function countTruncatedResultsFromSDK(client: OpencodeClient, sessionID: string): Promise<number>;
export declare function getTotalToolOutputSizeFromSDK(client: OpencodeClient, sessionID: string): Promise<number>;
export {};
