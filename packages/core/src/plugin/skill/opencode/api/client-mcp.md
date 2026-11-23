# client-mcp

## GET /api/experimental/client-mcp (experimental)

Upgrade to a WebSocket over which the client hosts an MCP server named after `name`; its tools stay available while the socket is open. One JSON-RPC message per text frame.

Parameters:
- `name: string`
- `ticket?: string`

Returns: `boolean`
