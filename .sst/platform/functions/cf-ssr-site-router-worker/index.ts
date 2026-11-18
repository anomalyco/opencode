declare var caches: any;
declare var SST_ASSET_MANIFEST: Record<string, string>;
declare var SST_ROUTES: { regex: string; origin: "assets" | "server" }[];

export interface Env {
  ASSETS: any;
  SERVER: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/^\//, "");

    // Return from cache if available
    let cachedResponse = await lookupCache();
    if (cachedResponse) return cachedResponse;

    const route = SST_ROUTES.find((r) => new RegExp(r.regex).test(pathname));

    // Fetch from server origin
    if (route?.origin === "server") {
      return await env.SERVER.fetch(request);
    }
    // Fetch from assets origin
    else if (route?.origin === "assets") {
      const object = await env.ASSETS.getWithMetadata(pathname);
      if (object.value) return await respond(200, object);
    }

    return new Response("Page Not Found", { status: 404 });

    async function lookupCache() {
      const cache = caches.default;
      const r = await cache.match(request);

      // cache does not exist
      if (!r) return;

      // cache exists but etag does not match
      if (r.headers.get("etag") !== SST_ASSET_MANIFEST[pathname]) return;

      // cache exists
      return r;
    }

    async function saveCache(response: Response) {
      const cache = caches.default;
      await cache.put(request, response.clone());
    }

    async function respond(status: number, object: any) {
      // build response
      const headers = new Headers();
      if (SST_ASSET_MANIFEST[pathname]) {
        headers.set("etag", SST_ASSET_MANIFEST[pathname]);
        headers.set("content-type", object.metadata.contentType);
        headers.set("cache-control", object.metadata.cacheControl);
      }
      const response = new Response(object.value, {
        status,
        headers,
      });

      if (request.method === "GET") {
        await saveCache(response);
      }

      return response;
    }
  },
};
