import type { ResolvedServer } from "./types";
interface LspEntry {
    disabled?: boolean;
    command?: string[];
    extensions?: string[];
    priority?: number;
    env?: Record<string, string>;
    initialization?: Record<string, unknown>;
}
interface ConfigJson {
    lsp?: Record<string, LspEntry>;
}
type ConfigSource = "project" | "user" | "opencode";
interface ServerWithSource extends ResolvedServer {
    source: ConfigSource;
}
export declare function loadJsonFile<T>(path: string): T | null;
export declare function getConfigPaths(): {
    project: string;
    user: string;
    opencode: string;
};
export declare function loadAllConfigs(): Map<ConfigSource, ConfigJson>;
export declare function getMergedServers(): ServerWithSource[];
export {};
