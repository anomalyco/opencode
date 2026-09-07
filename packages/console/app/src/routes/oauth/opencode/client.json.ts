import type { APIEvent } from "@solidjs/start/server"

// OAuth Client ID Metadata Document for the opencode client (draft-ietf-oauth-client-id-metadata-document,
// MCP authorization "Client ID Metadata Documents"). opencode presents this URL as its OAuth client_id when an
// MCP authorization server advertises client_id_metadata_document_supported, and the authorization server
// fetches it to learn the client name and allowed redirect URIs. The spec requires the client_id field to equal
// the exact URL the document is served from, so it is derived from the request origin to stay self-consistent
// on every stage.
//
// redirect_uris are portless loopback URIs: opencode binds an ephemeral port per login, and RFC 8252 section 7.3
// tells authorization servers to ignore the port when matching loopback redirects for native applications.
const PATH = "/oauth/opencode/client.json"

const cache = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400, stale-if-error=604800"

export function GET(event: APIEvent) {
  const origin = new URL(event.request.url).origin
  const document = {
    client_id: origin + PATH,
    client_name: "opencode",
    client_uri: origin,
    logo_uri: origin + "/web-app-manifest-512x512.png",
    application_type: "native",
    redirect_uris: ["http://127.0.0.1/callback", "http://localhost/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
  }
  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      "Access-Control-Allow-Origin": "*",
    },
  })
}
