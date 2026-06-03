export interface StoredToolPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    callID: string;
    tool: string;
    state: {
        status: "pending" | "running" | "completed" | "error";
        input: Record<string, unknown>;
        output?: string;
        error?: string;
        time?: {
            start: number;
            end?: number;
            compacted?: number;
        };
    };
    truncated?: boolean;
    originalSize?: number;
}
export interface ToolResultInfo {
    partPath: string;
    partId: string;
    messageID: string;
    toolName: string;
    outputSize: number;
}
export interface AggressiveTruncateResult {
    success: boolean;
    sufficient: boolean;
    truncatedCount: number;
    totalBytesRemoved: number;
    targetBytesToRemove: number;
    truncatedTools: Array<{
        toolName: string;
        originalSize: number;
    }>;
}
