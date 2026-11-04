export * from "./client.js";
export * from "./server.js";
import type { ServerOptions } from "./server.js";
export declare function createOpencode(options?: ServerOptions): Promise<{
    client: import("./client.js").OpencodeClient;
    server: {
        url: string;
        close(): void;
    };
}>;
