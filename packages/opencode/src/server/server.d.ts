import { Hono } from "hono";
export declare namespace Server {
    const Default: any;
    const createApp: (opts: {
        cors?: string[] | undefined;
    }) => Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
    function openapi(): any;
    /** @deprecated do not use this dumb shit */
    let url: URL;
    function listen(opts: {
        port: number;
        hostname: string;
        cors?: string[];
    }): Bun.Server<import("hono/bun").BunWebSocketData>;
}
