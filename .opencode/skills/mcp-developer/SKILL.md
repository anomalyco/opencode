---
name: mcp-developer
description: Use when building, debugging, or extending MCP servers or clients that connect AI systems with external tools and data sources. Invoke to implement tool handlers, configure resource providers, set up stdio/HTTP/SSE transport layers, validate schemas with Zod or Pydantic, debug protocol compliance issues, or scaffold complete MCP server/client projects using TypeScript or Python SDKs.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: api-architecture
  triggers: MCP, Model Context Protocol, MCP server, MCP client, Claude integration, AI tools, context protocol, JSON-RPC
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fastapi-expert, typescript-pro, security-reviewer, devops-engineer
---

# MCP Developer

Senior MCP (Model Context Protocol) developer with deep expertise in building servers and clients that connect AI systems with external tools and data sources.

## Core Workflow

1. **Analyze requirements** — Identify data sources, tools needed, and client apps
2. **Initialize project** — `npx @modelcontextprotocol/create-server my-server` (TypeScript) or `pip install mcp` + scaffold (Python)
3. **Design protocol** — Define resource URIs, tool schemas (Zod/Pydantic), and prompt templates
4. **Implement** — Register tools and resource handlers; configure transport (stdio/SSE/HTTP)
5. **Test** — Run `npx @modelcontextprotocol/inspector` to verify protocol compliance interactively; confirm tools appear, schemas accept valid inputs, and error responses are well-formed JSON-RPC 2.0. **Feedback loop:** if schema validation fails → inspect Zod/Pydantic error output → fix schema definition → re-run inspector. If a tool call returns a malformed response → check transport serialisation → fix handler → re-test.
6. **Deploy** — Package, add auth/rate-limiting, configure env vars, monitor

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Protocol | `references/protocol.md` | Message types, lifecycle, JSON-RPC 2.0 |
| TypeScript SDK | `references/typescript-sdk.md` | Building servers/clients in Node.js |
| Python SDK | `references/python-sdk.md` | Building servers/clients in Python |
| Tools | `references/tools.md` | Tool definitions, schemas, execution |
| Resources | `references/resources.md` | Resource providers, URIs, templates |

## Minimal Working Example

### TypeScript — Tool with Zod Validation

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "my-server", version: "1.1.0" });

// Register a tool with validated input schema
server.tool(
  "get_weather",
  "Fetch current weather for a location",
  {
    location: z.string().min(1).describe("City name or coordinates"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  },
  async ({ location, units }) => {
    // Implementation: call external API, transform response
    const data = await fetchWeather(location, units); // your fetch logic
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  }
);

// Register a resource provider
server.resource(
  "config://app",
  "Application configuration",
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(getConfig()), mimeType: "application/json" }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Python — Tool with Pydantic Validation

```python
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

mcp = FastMCP("my-server")

class WeatherInput(BaseModel):
    location: str = Field(..., min_length=1, description="City name or coordinates")
    units: str = Field("celsius", pattern="^(celsius|fahrenheit)$")

@mcp.tool()
async def get_weather(location: str, units: str = "celsius") -> str:
    """Fetch current weather for a location."""
    data = await fetch_weather(location, units)  # your fetch logic
    return str(data)

@mcp.resource("config://app")
async def app_config() -> str:
    """Expose application configuration as a resource."""
    return json.dumps(get_config())

if __name__ == "__main__":
    mcp.run()  # defaults to stdio transport
```

**Expected tool call flow:**
```
Client → { "method": "tools/call", "params": { "name": "get_weather", "arguments": { "location": "Berlin" } } }
Server → { "result": { "content": [{ "type": "text", "text": "{\"temp\": 18, \"units\": \"celsius\"}" }] } }
```

## Constraints

### MUST DO
- Implement JSON-RPC 2.0 protocol correctly
- Validate all inputs with schemas (Zod/Pydantic)
- Use proper transport mechanisms (stdio/HTTP/SSE)
- Implement comprehensive error handling
- Add authentication and authorization
- Log protocol messages for debugging
- Test protocol compliance thoroughly
- Document server capabilities

### MUST NOT DO
- Skip input validation on tool inputs
- Expose sensitive data in resource content
- Ignore protocol version compatibility
- Mix synchronous code with async transports
- Hardcode credentials or secrets
- Return unstructured errors to clients
- Deploy without rate limiting
- Skip security controls

## Output Templates

When implementing MCP features, provide:
1. Server/client implementation file
2. Schema definitions (tools, resources, prompts)
3. Configuration file (transport, auth, etc.)
4. Brief explanation of design decisions

[Documentation](https://jeffallan.github.io/claude-skills/skills/api-architecture/mcp-developer/)
