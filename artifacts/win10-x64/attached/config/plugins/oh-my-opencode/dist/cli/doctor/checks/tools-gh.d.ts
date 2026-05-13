export interface GhCliInfo {
    installed: boolean;
    version: string | null;
    path: string | null;
    authenticated: boolean;
    username: string | null;
    scopes: string[];
    error: string | null;
}
export declare function getGhCliInfo(): Promise<GhCliInfo>;
