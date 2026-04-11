# Issue: `[FEATURE]: Add OAuth authentication for webfetch tool (RFC 9728 / 8414 discovery)`

## Feature hasn't been suggested before.
- [x] I have verified this feature I'm about to request hasn't been suggested before.

## Describe the enhancement you want to request

When the `webfetch` tool fetches a URL that returns `401` or `403` with a `WWW-Authenticate: Bearer` header, there is no way to authenticate. The request just fails.

Many APIs and MCP-adjacent services use standard OAuth protected resource metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html)) and authorization server metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html)) to advertise how clients should authenticate. OpenCode already implements this discovery flow for MCP servers, but `webfetch` doesn't benefit from it.

### What this adds

On a `401`/`403` with a `WWW-Authenticate` header, webfetch would:

1. Parse the `WWW-Authenticate` challenges (RFC 9110 Section 11.6.1)
2. Discover the resource metadata via `/.well-known/oauth-protected-resource` (RFC 9728)
3. Discover the authorization server metadata via `/.well-known/oauth-authorization-server` (RFC 8414)
4. Run an OAuth authorization code + PKCE flow (RFC 7636), falling back to device code (RFC 8628)
5. Store credentials and retry the request with a Bearer token

### Why

This unblocks webfetch from working with any OAuth-protected API that advertises standard discovery metadata. It also aligns webfetch with how MCP server auth already works, reusing the same RFC-based discovery path.

### Related issues

None of these are duplicates — they all target MCP server connections or LLM provider APIs, not the webfetch tool.

| Issue | Relation |
|-------|----------|
| #7228 | MCP OAuth fails to follow `authorization_servers` from protected resource metadata. Same RFCs (9728/8414), different integration point (MCP vs webfetch). Closed as completed. |
| #9013 | WebFetch User-Agent causes 401 from corporate proxies. Related symptom (webfetch + auth failure), but the ask is a static header override, not an OAuth flow. |
| #9711 | GitLab OAuth token not auto-refreshed on 401. Same detect-401-and-retry pattern, but for a specific LLM provider, not arbitrary URLs via webfetch. |
| #6088 | Header-based credential injection for OpenCode's server mode. Related concept (injecting auth), but different scope (server API keys, not webfetch to external sites). |

### Scope

- New module: `src/auth/` with discovery, flow, credential store, and WWW-Authenticate parser
- Small change to `src/tool/webfetch.ts` to call into the auth module on 401/403
- ~100 tests covering RFC compliance, SSRF protection, and token lifecycle

Implementation PR is ready.
