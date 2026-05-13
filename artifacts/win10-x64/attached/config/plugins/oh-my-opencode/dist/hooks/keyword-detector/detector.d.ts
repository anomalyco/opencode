export interface DetectedKeyword {
    type: "ultrawork" | "search" | "analyze";
    message: string;
}
export declare function removeCodeBlocks(text: string): string;
export declare function detectKeywords(text: string, agentName?: string, modelID?: string): string[];
export declare function detectKeywordsWithType(text: string, agentName?: string, modelID?: string): DetectedKeyword[];
export declare function extractPromptText(parts: Array<{
    type: string;
    text?: string;
}>): string;
