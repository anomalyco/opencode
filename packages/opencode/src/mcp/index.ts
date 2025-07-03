import { experimental_createMCPClient, type Tool } from "ai"
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio"
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

  const state = App.state(
    "mcp",
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
          const client = await experimental_createMCPClient({
            name: key,
            transport: {
              type: "sse",
              url: mcp.url,
            },
          }).catch(() => {})
          if (!client) {
            Bus.publish(Session.Event.Error, {
              error: {
                name: "UnknownError",
                data: {
                  message: `MCP server ${key} failed to start`,
                },
              },
            })
            continue
          }
          clients[key] = client
        }

        if (mcp.type === "local") {
          const [cmd, ...args] = mcp.command
          const client = await experimental_createMCPClient({
            name: key,
            transport: new Experimental_StdioMCPTransport({
              stderr: "ignore",
              command: cmd,
              args,
              env: {
                ...process.env,
                ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
                ...mcp.environment,
              },
            }),
          }).catch(() => {})
          if (!client) {
            Bus.publish(Session.Event.Error, {
              error: {
                name: "UnknownError",
                data: {
                  message: `MCP server ${key} failed to start`,
                },
              },
            })
            continue
          }
          clients[key] = client
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

  export async function tools() {
    const result: Record<string, Tool> = {}
    for (const [clientName, client] of Object.entries(await clients())) {
      for (const [toolName, tool] of Object.entries(await client.tools())) {
        result[clientName + "_" + toolName] = tool
      }
    }
    return result
  }
}
