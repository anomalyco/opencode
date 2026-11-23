# client-mcp

## GET /api/experimental/client-mcp (experimental)

Upgrade to a WebSocket over which the client hosts an MCP server named after `name`; its tools stay available while the socket is open. One JSON-RPC message per text frame.

Parameters:
- `name: string` Name of the MCP server the client hosts.
- `ticket?: string` Single-use ticket from experimental.mcp.client.token, which authorizes the connection without the usual credentials.

Returns: `boolean`
