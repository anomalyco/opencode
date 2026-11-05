import { PATHS } from "./paths.ts"

// /config.json and /tui.json are static assets and never reach this code. The Worker builds the two documents that
// are generated per request.
export default {
  fetch(request: Request) {
    const url = new URL(request.url)
    if (request.method !== "GET" && request.method !== "HEAD") return notFound()
    if (url.pathname === PATHS.client) return client(url.origin)
    if (url.pathname === PATHS.appleAppSiteAssociation)
      return new Response(APPLE_APP_SITE_ASSOCIATION, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      })
    return notFound()
  },
}

// OAuth Client ID Metadata Document for the opencode client.
// Spec: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/
//
// When an MCP server's authorization server supports this, opencode sends this URL as its OAuth client_id instead of
// registering a new client. The authorization server fetches the document to learn our name and allowed redirect
// URIs. The client_id field must equal the exact URL the document was fetched from, so it is built from the request
// origin and stays valid on dev.opencode.ai as well as production.
//
// redirect_uris have no port because opencode binds an ephemeral port per login. RFC 8252 section 7.3 has
// authorization servers ignore the port when matching loopback redirects for native apps.
function client(origin: string) {
  const document = {
    client_id: origin + PATHS.client,
    client_name: "opencode",
    client_uri: origin,
    logo_uri: origin + "/web-app-manifest-512x512.png",
    application_type: "native",
    redirect_uris: [
      "http://127.0.0.1/callback",
      "http://localhost/callback",
      // Older clients use this path; loopback ports still vary per login.
      "http://127.0.0.1/mcp/oauth/callback",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
  }
  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

// Lets https://opencode.ai/pair links open the OpenCode iOS app. Only /pair may open the app.
const APPLE_APP_SITE_ASSOCIATION = JSON.stringify({
  applinks: {
    details: [
      {
        appIDs: ["5NZ4Q7NXJ4.ai.opencode.mobilecode"],
        components: [{ "/": "/pair", comment: "pairing links, payload in the fragment" }, { "/": "/pair/*" }],
      },
    ],
  },
})

function notFound() {
  return new Response("Not Found", { status: 404 })
}
