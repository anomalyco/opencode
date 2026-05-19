/**
 * Parses a tools configuration value into a boolean record.
 * Accepts comma-separated strings, string arrays, or unknown values from config files.
 * Returns undefined when input is empty or invalid.
 */
export declare function parseToolsConfig(toolsValue: unknown): Record<string, boolean> | undefined;
