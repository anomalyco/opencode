export * from "./gen/types.gen.js";
import { createClient } from "./gen/client/client.gen.js";
import { OpencodeClient } from "./gen/sdk.gen.js";
export { OpencodeClient };
function pick(value, fallback) {
    if (!value)
        return;
    if (!fallback)
        return value;
    if (value === fallback)
        return fallback;
    if (value === encodeURIComponent(fallback))
        return fallback;
    return value;
}
function rewrite(request, directory) {
    if (request.method !== "GET" && request.method !== "HEAD")
        return request;
    const value = pick(request.headers.get("x-opencode-directory"), directory);
    if (!value)
        return request;
    const url = new URL(request.url);
    if (!url.searchParams.has("directory")) {
        url.searchParams.set("directory", value);
    }
    const next = new Request(url, request);
    next.headers.delete("x-opencode-directory");
    return next;
}
export function createOpencodeClient(config) {
    if (!config?.fetch) {
        const customFetch = (req) => {
            // @ts-ignore
            req.timeout = false;
            return fetch(req);
        };
        config = {
            ...config,
            fetch: customFetch,
        };
    }
    if (config?.directory) {
        config.headers = {
            ...config.headers,
            "x-opencode-directory": encodeURIComponent(config.directory),
        };
    }
    const client = createClient(config);
    client.interceptors.request.use((request) => rewrite(request, config?.directory));
    return new OpencodeClient({ client });
}
