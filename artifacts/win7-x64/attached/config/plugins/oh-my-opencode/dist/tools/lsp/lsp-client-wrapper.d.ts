import { LSPClient } from "./client";
import type { ServerLookupResult } from "./types";
export declare function isDirectoryPath(filePath: string): boolean;
export declare function uriToPath(uri: string): string;
export declare function findWorkspaceRoot(filePath: string): string;
export declare function formatServerLookupError(result: Exclude<ServerLookupResult, {
    status: "found";
}>): string;
export declare function withLspClient<T>(filePath: string, fn: (client: LSPClient) => Promise<T>): Promise<T>;
