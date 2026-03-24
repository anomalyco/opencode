// Cloudflare Worker CORS proxy for Anthropic API
// Deploy: wrangler deploy proxy/cors-worker.ts
//
// This proxies requests to api.anthropic.com, adding CORS headers
// so the browser can call the API directly.

export default {
  async fetch(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      })
    }

    const url = new URL(request.url)
    const targetUrl = `https://api.anthropic.com${url.pathname}${url.search}`

    // Forward the request to Anthropic
    const headers = new Headers(request.headers)
    headers.delete("origin")
    headers.delete("referer")

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
    })

    // Add CORS headers to response
    const newHeaders = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders())) {
      newHeaders.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  },
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
    "Access-Control-Expose-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }
}
