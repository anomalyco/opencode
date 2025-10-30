---
description: Add a local MCP server
agent: build
subtask: true
---

Add a local MCP server with the specified name and command.

!`opencode mcp local $ARGUMENTS`

The MCP server will be configured and available as tools once added.

Example usage:
/mcp-local filesystem npx -y @modelcontextprotocol/server-filesystem /tmp
