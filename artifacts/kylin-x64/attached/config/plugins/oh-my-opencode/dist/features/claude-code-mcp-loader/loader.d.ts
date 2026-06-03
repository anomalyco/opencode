import type { LoadedMcpServer, McpLoadResult } from "./types";
export declare function getSystemMcpServerNames(): Set<string>;
export declare function loadMcpConfigs(disabledMcps?: string[]): Promise<McpLoadResult>;
export declare function formatLoadedServersForToast(loadedServers: LoadedMcpServer[]): string;
