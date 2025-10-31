import { experimental_createMCPClient, type Tool } from "ai"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { NamedError } from "../util/error"
import z from "zod"
import { Session } from "../session"
import { Bus } from "../bus"
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

  type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clients: {
        [name: string]: MCPClient
      } = {}

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          const result = await create(key, mcp).catch(() => undefined)
          if (!result) return
          clients[key] = result.client
        }),
      )

      return {
        clients,
        config,
      }
    },
    async (state) => {
      await Promise.all(Object.values(state.clients).map((client) => client.close()))
    },
  )

  export async function add(name: string, mcp: Config.Mcp) {
    const s = await state()
    const result = await create(name, mcp)
    if (!result) return
    s.clients[name] = result.client
  }

  async function create(name: string, mcp: Config.Mcp) {
    if (mcp.enabled === false) {
      log.info("mcp server disabled", { name })
      return
    }
    log.info("found", { name, type: mcp.type })

    let mcpClient: MCPClient | undefined

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
            name,
            transport: name,
            url: mcp.url,
            error: lastError.message,
          })
          return null
        })
        if (client) {
          log.debug("transport connection succeeded", { name, transport: name })
          mcpClient = client
          break
        }
      }
      if (!mcpClient) {
        const errorMessage = lastError
          ? `MCP server ${name} failed to connect: ${lastError.message}`
          : `MCP server ${name} failed to connect to ${mcp.url}`
        log.error("remote mcp connection failed", { name, url: mcp.url, error: lastError?.message })
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
            ? `MCP server ${name} failed to start: ${error.message}`
            : `MCP server ${name} failed to start`
        log.error("local mcp startup failed", {
          name,
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
        mcpClient = client
      }
    }

    if (!mcpClient) {
      log.warn("mcp client not initialized", { name })
      return
    }

    const result = await withTimeout(mcpClient.tools(), mcp.timeout ?? 5000).catch(() => { })
    if (!result) {
      log.warn("mcp client verification failed, dropping client", { name })
      return
    }

    return {
      client: mcpClient,
    }
  }

  export async function status() {
    return state().then((state) => {
      const result: Record<string, "connected" | "failed" | "disabled"> = {}
      for (const [key, client] of Object.entries(state.config)) {
        if (client.enabled === false) {
          result[key] = "disabled"
          continue
        }
        if (state.clients[key]) {
          result[key] = "connected"
          continue
        }
        result[key] = "failed"
      }
      return result
    })
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
