export declare function fuzzyMatchModel(target: string, available: Set<string>, providers?: string[]): string | null;
/**
 * Check if a target model is available (fuzzy match by model name, no provider filtering)
 *
 * @param targetModel - Model name to check (e.g., "gpt-5.3-codex")
 * @param availableModels - Set of available models in "provider/model" format
 * @returns true if model is available, false otherwise
 */
export declare function isModelAvailable(targetModel: string, availableModels: Set<string>): boolean;
export declare function getConnectedProviders(client: any): Promise<string[]>;
export declare function fetchAvailableModels(client?: any, options?: {
    connectedProviders?: string[] | null;
}): Promise<Set<string>>;
export declare function __resetModelCache(): void;
export declare function isModelCacheAvailable(): boolean;
