import type { ServerLookupResult } from "./types";
export declare function findServerForExtension(ext: string): ServerLookupResult;
export declare function getAllServers(): Array<{
    id: string;
    installed: boolean;
    extensions: string[];
    disabled: boolean;
    source: string;
    priority: number;
}>;
export declare function getConfigPaths_(): {
    project: string;
    user: string;
    opencode: string;
};
