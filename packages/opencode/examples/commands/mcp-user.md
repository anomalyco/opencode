---
description: Add a remote MCP server
agent: build
subtask: true
---

Add a remote MCP server with the specified name and URL.

!`opencode mcp user $ARGUMENTS`

The MCP server will be configured and available as tools once added.

Example usage:
/mcp-user my-server https://my-server.com/mcp --headers "Authorization: Bearer token"
