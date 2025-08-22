import { experimental_createMCPClient, type Tool } from "ai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { App } from "../app/app"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import { z } from "zod"
import { Session } from "../session"
import { Bus } from "../bus"

export namespace MCP {
  const log = Log.create({ service: "mcp" })

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  interface MCPClientInfo {
    client: Awaited<ReturnType<typeof experimental_createMCPClient>>
    type: "local" | "remote"
    createdAt: number
    lastUsed: number
    config: any
    restartCount: number
  }

  const state = App.state(
    "mcp",
    async () => {
      const cfg = await Config.get()
      const clients: Record<string, MCPClientInfo> = {}
      const maxRestarts = 3
      const restartDelay = 5000 // 5 seconds

      // Health check interval for monitoring client status
      const healthCheckInterval = setInterval(async () => {
        for (const [key, clientInfo] of Object.entries(clients)) {
          try {
            // Try to ping the client to check if it's alive
            await clientInfo.client.tools()
            clientInfo.lastUsed = Date.now()
          } catch (error) {
            log.warn(`MCP client ${key} health check failed`, {
              error: error instanceof Error ? error.message : String(error),
              restartCount: clientInfo.restartCount,
            })

            // If it's a local client and hasn't exceeded restart limit, try to restart
            if (clientInfo.type === "local" && clientInfo.restartCount < maxRestarts) {
              log.info(`Attempting to restart MCP client ${key}`, {
                attempt: clientInfo.restartCount + 1,
                maxAttempts: maxRestarts,
              })

              setTimeout(async () => {
                try {
                  await restartLocalClient(key, clientInfo.config, clients)
                } catch (restartError) {
                  log.error(`Failed to restart MCP client ${key}`, {
                    error: restartError instanceof Error ? restartError.message : String(restartError),
                  })
                }
              }, restartDelay)
            }
          }
        }
      }, 30000) // Check every 30 seconds

      async function restartLocalClient(key: string, mcp: any, clientsMap: Record<string, MCPClientInfo>) {
        const existingClient = clientsMap[key]
        if (existingClient) {
          try {
            existingClient.client.close()
          } catch (error) {
            log.debug(`Error closing existing MCP client ${key}`, { error })
          }
        }

        const [cmd, ...args] = mcp.command
        const client = await experimental_createMCPClient({
          name: key,
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
        })

        clientsMap[key] = {
          client,
          type: "local",
          createdAt: Date.now(),
          lastUsed: Date.now(),
          config: mcp,
          restartCount: existingClient ? existingClient.restartCount + 1 : 0,
        }

        log.info(`Successfully restarted MCP client ${key}`, {
          restartCount: clientsMap[key].restartCount,
        })
      }

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
              name: key,
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
              clients[key] = {
                client,
                type: "remote",
                createdAt: Date.now(),
                lastUsed: Date.now(),
                config: mcp,
                restartCount: 0,
              }
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
          try {
            await restartLocalClient(key, mcp, clients)
          } catch (error) {
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
          }
        }
      }

      log.info("MCP service initialized", {
        clientCount: Object.keys(clients).length,
        clients: Object.keys(clients).join(", "),
      })

      return {
        clients,
        healthCheckInterval,
      }
    },
    async (state) => {
      log.info("Shutting down MCP service", {
        clientCount: Object.keys(state.clients).length,
      })

      // Clear health check interval
      if (state.healthCheckInterval) {
        clearInterval(state.healthCheckInterval)
      }

      // Close all clients gracefully
      for (const [key, clientInfo] of Object.entries(state.clients)) {
        try {
          log.debug(`Closing MCP client ${key}`)
          clientInfo.client.close()
        } catch (error) {
          log.warn(`Error closing MCP client ${key}`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      log.info("MCP service shutdown complete")
    },
  )

  export async function clients() {
    const s = await state()
    const result: Record<string, Awaited<ReturnType<typeof experimental_createMCPClient>>> = {}

    for (const [key, clientInfo] of Object.entries(s.clients)) {
      result[key] = clientInfo.client
    }

    return result
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    const clientsMap = await clients()

    for (const [clientName, client] of Object.entries(clientsMap)) {
      try {
        const clientTools = await client.tools()
        for (const [toolName, tool] of Object.entries(clientTools)) {
          const sanitizedClientName = clientName.replace(/\s+/g, "_")
          const sanitizedToolName = toolName.replace(/[-\s]+/g, "_")
          result[sanitizedClientName + "_" + sanitizedToolName] = tool
        }

        // Update last used timestamp
        const s = await state()
        if (s.clients[clientName]) {
          s.clients[clientName].lastUsed = Date.now()
        }
      } catch (error) {
        log.warn(`Failed to get tools from MCP client ${clientName}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result
  }

  // Utility functions for monitoring and debugging
  export async function getClientStats() {
    const s = await state()
    const stats = {
      totalClients: Object.keys(s.clients).length,
      clientsByType: { local: 0, remote: 0 },
      clients: Object.entries(s.clients).map(([key, info]) => ({
        name: key,
        type: info.type,
        ageMinutes: Math.round((Date.now() - info.createdAt) / 60000),
        idleMinutes: Math.round((Date.now() - info.lastUsed) / 60000),
        restartCount: info.restartCount,
      })),
    }

    for (const info of Object.values(s.clients)) {
      stats.clientsByType[info.type]++
    }

    return stats
  }

  export async function restartAllClients() {
    const s = await state()
    log.info("Manually restarting all MCP clients")

    const localClients = Object.entries(s.clients).filter(([, info]) => info.type === "local")

    for (const [key, clientInfo] of localClients) {
      try {
        log.info(`Restarting MCP client ${key}`)
        clientInfo.client.close()

        // Restart the client
        const [cmd, ...args] = clientInfo.config.command
        const newClient = await experimental_createMCPClient({
          name: key,
          transport: new StdioClientTransport({
            stderr: "ignore",
            command: cmd,
            args,
            env: {
              ...process.env,
              ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
              ...clientInfo.config.environment,
            },
          }),
        })

        s.clients[key] = {
          ...clientInfo,
          client: newClient,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          restartCount: clientInfo.restartCount + 1,
        }

        log.info(`Successfully restarted MCP client ${key}`)
      } catch (error) {
        log.error(`Failed to restart MCP client ${key}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
