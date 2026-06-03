import type { ServerConnection } from "./types";
export declare function createServerConnection(options: {
    port?: number;
    attach?: string;
    signal: AbortSignal;
}): Promise<ServerConnection>;
