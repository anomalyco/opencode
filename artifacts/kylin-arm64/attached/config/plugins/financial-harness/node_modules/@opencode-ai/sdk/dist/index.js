export * from "./client.js";
export * from "./server.js";
import { createOpencodeClient } from "./client.js";
import { createOpencodeServer } from "./server.js";
export async function createOpencode(options) {
    const server = await createOpencodeServer({
        ...options,
    });
    const client = createOpencodeClient({
        baseUrl: server.url,
    });
    return {
        client,
        server,
    };
}
