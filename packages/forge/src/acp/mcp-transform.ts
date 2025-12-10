import type { McpCapabilities, McpServer, EnvVariable, HttpHeader } from "@agentclientprotocol/sdk"
import type { Config } from "../config/config"

/**
 * Transforms Forge's MCP configuration to ACP's McpServer format.
 *
 * @param config - Record of MCP server configurations from Forge config
 * @param capabilities - Agent's MCP capabilities (from initialize response)
 * @returns Array of MCP servers in ACP format, filtered by capabilities
 */
export function transformMcpServers(
  config: Record<string, Config.Mcp> | undefined,
  capabilities?: McpCapabilities
): McpServer[] {
  if (!config) {
    return []
  }

  const servers: McpServer[] = []

  for (const [name, mcp] of Object.entries(config)) {
    // Skip disabled servers
    if (mcp.enabled === false) {
      continue
    }

    if (mcp.type === "local") {
      // Transform local (stdio) server
      const [command, ...args] = mcp.command

      const env: EnvVariable[] = []
      if (mcp.environment) {
        for (const [envName, envValue] of Object.entries(mcp.environment)) {
          env.push({ name: envName, value: envValue })
        }
      }

      servers.push({
        name,
        command,
        args,
        env,
      })
    } else if (mcp.type === "remote") {
      // Check if agent supports HTTP transport
      // If capabilities not provided or http not explicitly true, skip remote servers
      if (!capabilities?.http) {
        continue
      }

      // Transform remote (HTTP/SSE) server to HTTP format
      const headers: HttpHeader[] = []
      if (mcp.headers) {
        for (const [headerName, headerValue] of Object.entries(mcp.headers)) {
          headers.push({ name: headerName, value: headerValue })
        }
      }

      servers.push({
        type: "http",
        name,
        url: mcp.url,
        headers,
      })
    }
  }

  return servers
}
