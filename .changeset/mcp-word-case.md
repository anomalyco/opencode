---
"@opencode-ai/core": major
---

Treat MCP as a word in current Core namespace exports: rename `MCP` to `Mcp`, `MCPClient` to `McpClient`, `MCPStdio` to `McpStdio`, `MCPOAuth` to `McpOAuth`, `ConfigMCPPlugin` to `ConfigMcpPlugin`, and `MCPCodeModeExclusionPlugin` to `McpCodeModeExclusionPlugin`. Direct consumers must update their imports. Module paths, Schema contracts, runtime service keys, error tags, and behavior are unchanged.
