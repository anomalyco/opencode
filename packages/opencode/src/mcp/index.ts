import { experimental_createMCPClient, type Tool } from "ai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import { z } from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
import { Instance } from "../project/instance"

export namespace MCP {
  const log = Log.create({ service: "mcp" })

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const clients: {
        [name: string]: Awaited<ReturnType<typeof experimental_createMCPClient>>
      } = {}
      for (const [key, mcp] of Object.entries(cfg.mcp ?? {})) {
        if (mcp.enabled === false) {
          log.info("mcp server disabled", { key })
          continue
        }
        log.info("found", { key, type: mcp.type })
        if (mcp.type === "remote") {
          const transports = [
            {
              name: "StreamableHTTP",
              transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
                requestInit: {
                  headers: mcp.headers,
                },
              }),
            },
            {
              name: "SSE",
              transport: new SSEClientTransport(new URL(mcp.url), {
                requestInit: {
                  headers: mcp.headers,
                },
              }),
            },
          ]
          let lastError: Error | undefined
          for (const { name, transport } of transports) {
            const client = await experimental_createMCPClient({
              name: "opencode",
              transport,
            }).catch((error) => {
              lastError = error instanceof Error ? error : new Error(String(error))
              log.debug("transport connection failed", {
                key,
                transport: name,
                url: mcp.url,
                error: lastError.message,
              })
              return null
            })
            if (client) {
              log.debug("transport connection succeeded", { key, transport: name })
              clients[key] = client
              break
            }
          }
          if (!clients[key]) {
            const errorMessage = lastError
              ? `MCP server ${key} failed to connect: ${lastError.message}`
              : `MCP server ${key} failed to connect to ${mcp.url}`
            log.error("remote mcp connection failed", { key, url: mcp.url, error: lastError?.message })
            Bus.publish(Session.Event.Error, {
              error: {
                name: "UnknownError",
                data: {
                  message: errorMessage,
                },
              },
            })
          }
        }

        if (mcp.type === "local") {
          const [cmd, ...args] = mcp.command
          const client = await experimental_createMCPClient({
            name: "opencode",
            transport: new StdioClientTransport({
              stderr: "ignore",
              command: cmd,
              args,
              env: {
                ...process.env,
                ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
                ...mcp.environment,
              },
            }),
          }).catch((error) => {
            const errorMessage =
              error instanceof Error
                ? `MCP server ${key} failed to start: ${error.message}`
                : `MCP server ${key} failed to start`
            log.error("local mcp startup failed", {
              key,
              command: mcp.command,
              error: error instanceof Error ? error.message : String(error),
            })
            Bus.publish(Session.Event.Error, {
              error: {
                name: "UnknownError",
                data: {
                  message: errorMessage,
                },
              },
            })
            return null
          })
          if (client) {
            clients[key] = client
          }
        }
      }

      return {
        clients,
      }
    },
    async (state) => {
      for (const client of Object.values(state.clients)) {
        client.close()
      }
    },
  )

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function tools(providerID?: string) {
    const result: Record<string, Tool> = {}
    const clientEntries = Object.entries(await clients())
    
    for (const [clientName, client] of clientEntries) {
      try {
        const clientTools = await client.tools()
        
        for (const [toolName, tool] of Object.entries(clientTools)) {
          const sanitizedClientName = clientName.replace(/\s+/g, "_")
          const sanitizedToolName = toolName.replace(/[-\s]+/g, "_")
          const toolKey = sanitizedClientName + "_" + sanitizedToolName
          
          if (providerID) {
            const transformedTool = await transformToolForProvider(tool, providerID)
            result[toolKey] = transformedTool
          } else {
            result[toolKey] = tool
          }
        }
      } catch (error: any) {
        log.error('Failed to get tools from MCP client', { clientName, error: error.message })
      }
    }
    
    return result
  }

  async function transformToolForProvider(tool: any, providerID: string): Promise<any> {
    if (!['openai', 'azure'].includes(providerID)) return tool
    
    try {
      const { Provider } = await import("../provider/provider")
      return Provider.transformMCPToolForProvider(tool, providerID)
    } catch (error: any) {
      log.warn('Could not transform MCP tool schema, using as-is', { 
        toolId: tool.id || 'unknown',
        providerID,
        error: error.message
      })
      return tool
    }
  }
}
