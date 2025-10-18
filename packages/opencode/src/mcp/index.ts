import { experimental_createMCPClient, type Tool } from "ai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import z from "zod/v4"
import { Instance } from "../project/instance"
import { withTimeout } from "@/util/timeout"

export namespace MCP {
  const log = Log.create({ service: "mcp" })

  export const Failed = NamedError.create(
    "MCPFailed",
    z.object({
      name: z.string(),
    }),
  )

  type Client = Awaited<ReturnType<typeof experimental_createMCPClient>>

  export const Status = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("connected"),
        })
        .meta({
          ref: "MCPStatusConnected",
        }),
      z
        .object({
          status: z.literal("disabled"),
        })
        .meta({
          ref: "MCPStatusDisabled",
        }),
      z
        .object({
          status: z.literal("failed"),
          error: z.string(),
        })
        .meta({
          ref: "MCPStatusFailed",
        }),
    ])
    .meta({
      ref: "MCPStatus",
    })
  export type Status = z.infer<typeof Status>

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const clients: Record<string, Client> = {}
      const status: Record<string, Status> = {}
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
            const result = await experimental_createMCPClient({
              name: "opencode",
              transport,
            })
              .then((client) => {
                log.info("connected", { key, transport: name })
                clients[key] = client
                status[key] = {
                  status: "connected",
                }
                return true
              })
              .catch((error) => {
                lastError = error instanceof Error ? error : new Error(String(error))
                log.debug("transport connection failed", {
                  key,
                  transport: name,
                  url: mcp.url,
                  error: lastError.message,
                })
                status[key] = {
                  status: "failed",
                  error: lastError.message,
                }
                return false
              })
            if (result) break
          }
        }

        if (mcp.type === "local") {
          const [cmd, ...args] = mcp.command
          await experimental_createMCPClient({
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
          })
            .then((client) => {
              clients[key] = client
              status[key] = {
                status: "connected",
              }
            })
            .catch((error) => {
              log.error("local mcp startup failed", {
                key,
                command: mcp.command,
                error: error instanceof Error ? error.message : String(error),
              })
              status[key] = {
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              }
            })
        }
      }

      for (const [key, client] of Object.entries(clients)) {
        log.info("checking tools", { key })
        const result = await withTimeout(client.tools(), 5000).catch(() => {})
        if (!result) {
          client.close()
          delete clients[key]
          status[key] = {
            status: "failed",
            error: "Failed to get tools",
          }
        }
      }

      return {
        status,
        clients,
      }
    },
    async (state) => {
      for (const client of Object.values(state.clients)) {
        client.close()
      }
    },
  )

  export async function status() {
    return state().then((state) => state.status)
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function tools() {
    const result: Record<string, Tool> = {}
    for (const [clientName, client] of Object.entries(await clients())) {
      for (const [toolName, tool] of Object.entries(await client.tools())) {
        const sanitizedClientName = clientName.replace(/\s+/g, "_")
        const sanitizedToolName = toolName.replace(/[-\s]+/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = tool
      }
    }
    return result
  }
}
