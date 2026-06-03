import type { ToolResultInfo } from "./tool-part-types";
export declare function findToolResultsBySize(sessionID: string): ToolResultInfo[];
export declare function findLargestToolResult(sessionID: string): ToolResultInfo | null;
export declare function truncateToolResult(partPath: string): {
    success: boolean;
    toolName?: string;
    originalSize?: number;
};
export declare function getTotalToolOutputSize(sessionID: string): number;
export declare function countTruncatedResults(sessionID: string): number;
