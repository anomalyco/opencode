# mcp

## GET /api/mcp

Retrieve configured MCP servers and their connection status.

Returns: `{ location: Location.PublicRef; data: Mcp.Server[] }`

## PUT /api/experimental/mcp/{server} (experimental)

Add an MCP server at runtime or replace an existing one, connecting it immediately.

Body:
- `config: Mcp.LocalConfigEncoded | Mcp.RemoteConfigEncoded`

Returns: nothing

## DELETE /api/experimental/mcp/{server} (experimental)

Stop an MCP server and remove it from the runtime set until restart.

Returns: nothing

## POST /api/experimental/mcp/{server}/connect (experimental)

Connect an MCP server at runtime, overriding a disabled configuration until restart.

Returns: nothing

## POST /api/experimental/mcp/{server}/disconnect (experimental)

Disconnect an MCP server at runtime, removing its tools until reconnected.

Returns: nothing

## GET /api/mcp/resource

Retrieve resources and resource templates from connected MCP servers.

Returns: `{ location: Location.PublicRef; data: Mcp.ResourceCatalog }`

## Types

- `Location.PublicRef`: `{ directory: string }`
- `Mcp.LocalConfigEncoded`: `{ type: "local"; command: string[]; cwd?: string; environment?: Record<string, string>; disabled?: boolean; codemode?: boolean; timeout?: { startup, catalog, execution }; protocol?: "legacy" | "auto" | "2026-07-28"; pool?: boolean }`
- `Mcp.RemoteConfigEncoded`: `{ type, url, headers, oauth, disabled, codemode, timeout, protocol, pool }`
- `Mcp.Resource`: `{ server: string; name: string; uri: string; description?: string; mimeType?: string }`
- `Mcp.ResourceCatalog`: `{ resources: Mcp.Resource[]; templates: Mcp.ResourceTemplate[] }`
- `Mcp.ResourceTemplate`: `{ server: string; name: string; uriTemplate: string; description?: string; mimeType?: string }`
- `Mcp.Server`: `{ name: string; status: Mcp.Status.Connected | Mcp.Status.Pending | Mcp.Status.Disabled | Mcp.Status.Failed | Mcp.Status.NeedsAuth; title?: string; integrationID?: string }`
- `Mcp.Status.Connected`: `{ status: "connected" }`
- `Mcp.Status.Disabled`: `{ status: "disabled" }`
- `Mcp.Status.Failed`: `{ status: "failed"; error: string }`
- `Mcp.Status.NeedsAuth`: `{ status: "needs_auth"; error: string }`
- `Mcp.Status.Pending`: `{ status: "pending" }`
