export interface ToolCallSignature {
    toolName: string;
    signature: string;
    callID: string;
    turn: number;
}
export interface FileOperation {
    callID: string;
    tool: string;
    filePath: string;
    turn: number;
}
export interface ErroredToolCall {
    callID: string;
    toolName: string;
    turn: number;
    errorAge: number;
}
export interface PruningResult {
    itemsPruned: number;
    totalTokensSaved: number;
    strategies: {
        deduplication: number;
        supersedeWrites: number;
        purgeErrors: number;
    };
}
export interface PruningState {
    toolIdsToPrune: Set<string>;
    currentTurn: number;
    fileOperations: Map<string, FileOperation[]>;
    toolSignatures: Map<string, ToolCallSignature[]>;
    erroredTools: Map<string, ErroredToolCall>;
}
export declare const CHARS_PER_TOKEN = 4;
export declare function estimateTokens(text: string): number;
