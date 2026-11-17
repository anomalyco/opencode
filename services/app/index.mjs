export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname
    if (pathname === "/") url.pathname = "/index.html"
    const asset = await env.ASSETS.fetch(new Request(url, request))
    if (asset.status !== 404) return asset

    // Tabs opened before the cutover can still request chunks from the SST build.
    if (pathname.startsWith("/assets/")) {
      const { value, metadata } = await env.LEGACY.getWithMetadata(pathname.slice(1))
      if (value) {
        return new Response(request.method === "HEAD" ? null : Uint8Array.from(atob(value), (c) => c.charCodeAt(0)), {
          headers: { "content-type": metadata.contentType, "cache-control": metadata.cacheControl },
        })
      }
    }
    url.pathname = "/index.html"
    return env.ASSETS.fetch(new Request(url, request))
  },
}
