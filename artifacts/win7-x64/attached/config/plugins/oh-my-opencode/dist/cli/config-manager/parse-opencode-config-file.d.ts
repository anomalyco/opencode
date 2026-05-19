interface ParseConfigResult {
    config: OpenCodeConfig | null;
    error?: string;
}
export interface OpenCodeConfig {
    plugin?: string[];
    [key: string]: unknown;
}
export declare function parseOpenCodeConfigFileWithError(path: string): ParseConfigResult;
export {};
