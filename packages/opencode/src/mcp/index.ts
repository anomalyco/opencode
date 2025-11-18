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
import { Bus } from "../bus"

export namespace MCP {
  const log = Log.create({ service: "mcp" })

  export const Event = {
    ServerAdded: Bus.event(
      "mcp.server.added",
      z.object({
        name: z.string(),
        scope: z.enum(["instance", "session"]),
        sessionID: z.string().optional(),
      }),
    ),
    ServerRemoved: Bus.event(
      "mcp.server.removed",
      z.object({
        name: z.string(),
        scope: z.enum(["instance", "session"]),
        sessionID: z.string().optional(),
      }),
    ),
  }

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
  type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>

  const state = Instance.state(
    async () => {
      const cfg = await Config.get()
      const config = cfg.mcp ?? {}
      const clients: Record<string, Client> = {}
      const status: Record<string, Status> = {}

      await Promise.all(
        Object.entries(config).map(async ([key, mcp]) => {
          const result = await create(key, mcp).catch(() => undefined)
          if (!result) return

          status[key] = result.status

          if (result.mcpClient) {
            clients[key] = result.mcpClient
          }
        }),
      )
      return {
        status,
        clients,
      }
    },
    async (state) => {
      await Promise.all(
        Object.values(state.clients).map((client) =>
          client.close().catch((error) => {
            log.error("Failed to close MCP client", {
              error,
            })
          }),
        ),
      )
    },
  )

  // Session-scoped MCP state
  const sessionState = Instance.state(() => {
    return new Map<
      string,
      {
        clients: Record<string, Client>
        status: Record<string, Status>
      }
    >()
  })

  export async function add(name: string, mcp: Config.Mcp, sessionID?: string) {
    const s = await state()
    const result = await create(name, mcp, true) // Ignore enabled flag for dynamic loading
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      s.status[name] = status
      return {
        status,
      }
    }
    if (!result.mcpClient) {
      s.status[name] = result.status
      return {
        status: s.status,
      }
    }
    s.clients[name] = result.mcpClient
    s.status[name] = result.status

    // Publish event so tools can be refreshed
    await Bus.publish(Event.ServerAdded, {
      name,
      scope: "instance",
      sessionID,
    })

    return {
      status: s.status,
    }
  }

  export async function addSessionScoped(sessionID: string, name: string, mcp: Config.Mcp) {
    const sessions = await sessionState()
    let session = sessions.get(sessionID)
    if (!session) {
      session = {
        clients: {},
        status: {},
      }
      sessions.set(sessionID, session)
    }

    const result = await create(name, mcp, true) // Ignore enabled flag for dynamic loading
    if (!result) {
      const status = {
        status: "failed" as const,
        error: "unknown error",
      }
      session.status[name] = status
      return {
        status,
      }
    }
    if (!result.mcpClient) {
      session.status[name] = result.status
      return {
        status: session.status,
      }
    }
    session.clients[name] = result.mcpClient
    session.status[name] = result.status

    log.info("added session-scoped MCP", { sessionID, name })

    // Publish event so tools can be refreshed
    await Bus.publish(Event.ServerAdded, {
      name,
      scope: "session",
      sessionID,
    })

    return {
      status: session.status,
    }
  }

  export async function disposeSession(sessionID: string) {
    const sessions = await sessionState()
    const session = sessions.get(sessionID)
    if (!session) return

    log.info("disposing session-scoped MCPs", { sessionID, count: Object.keys(session.clients).length })

    await Promise.all(
      Object.entries(session.clients).map(async ([name, client]) => {
        await client.close().catch((error) => {
          log.error("Failed to close session-scoped MCP client", {
            sessionID,
            name,
            error,
          })
        })
        await Bus.publish(Event.ServerRemoved, {
          name,
          scope: "session",
          sessionID,
        })
      }),
    )

    sessions.delete(sessionID)
  }

  async function create(key: string, mcp: Config.Mcp, ignoreEnabled = false) {
    if (mcp.enabled === false && !ignoreEnabled) {
      log.info("mcp server disabled", { key })
      return
    }
    log.info("found", { key, type: mcp.type })
    let mcpClient: MCPClient | undefined
    let status: Status | undefined = undefined

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
            mcpClient = client
            status = { status: "connected" }
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
            status = {
              status: "failed" as const,
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
          mcpClient = client
          status = {
            status: "connected",
          }
        })
        .catch((error) => {
          log.error("local mcp startup failed", {
            key,
            command: mcp.command,
            error: error instanceof Error ? error.message : String(error),
          })
          status = {
            status: "failed" as const,
            error: error instanceof Error ? error.message : String(error),
          }
        })
    }

    if (!status) {
      status = {
        status: "failed" as const,
        error: "Unknown error",
      }
    }

    if (!mcpClient) {
      return {
        mcpClient: undefined,
        status,
      }
    }

    const result = await withTimeout(mcpClient.tools(), mcp.timeout ?? 5000).catch((err) => {
      log.error("failed to get tools from client", { key, error: err })
      return undefined
    })
    if (!result) {
      await mcpClient.close().catch((error) => {
        log.error("Failed to close MCP client", {
          error,
        })
      })
      status = {
        status: "failed",
        error: "Failed to get tools",
      }
      return {
        mcpClient: undefined,
        status: {
          status: "failed" as const,
          error: "Failed to get tools",
        },
      }
    }

    log.info("create() successfully created client", { key, toolCount: Object.keys(result).length })
    return {
      mcpClient,
      status,
    }
  }

  export async function status(sessionID?: string) {
    const instanceStatus = await state().then((state) => state.status)
    if (!sessionID) {
      return instanceStatus
    }

    const sessions = await sessionState()
    const session = sessions.get(sessionID)
    if (!session) {
      return instanceStatus
    }

    return {
      ...instanceStatus,
      ...session.status,
    }
  }

  export async function clients() {
    return state().then((state) => state.clients)
  }

  export async function tools(sessionID?: string) {
    const result: Record<string, Tool> = {}
    const s = await state()
    const clientsSnapshot = await clients()

    // Add instance-scoped tools
    for (const [clientName, client] of Object.entries(clientsSnapshot)) {
      const tools = await client.tools().catch((e) => {
        log.error("failed to get tools", { clientName, error: e.message })
        const failedStatus = {
          status: "failed" as const,
          error: e instanceof Error ? e.message : String(e),
        }
        s.status[clientName] = failedStatus
        delete s.clients[clientName]
      })
      if (!tools) {
        continue
      }
      for (const [toolName, tool] of Object.entries(tools)) {
        const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
        const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_")
        result[sanitizedClientName + "_" + sanitizedToolName] = tool
      }
    }

    // Add session-scoped tools if sessionID provided
    if (sessionID) {
      const sessions = await sessionState()
      const session = sessions.get(sessionID)
      if (session) {
        for (const [clientName, client] of Object.entries(session.clients)) {
          const tools = await client.tools().catch((e) => {
            log.error("failed to get session-scoped tools", { sessionID, clientName, error: e.message })
            const failedStatus = {
              status: "failed" as const,
              error: e instanceof Error ? e.message : String(e),
            }
            session.status[clientName] = failedStatus
            delete session.clients[clientName]
          })
          if (!tools) {
            continue
          }
          for (const [toolName, tool] of Object.entries(tools)) {
            const sanitizedClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, "_")
            const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_")
            result[sanitizedClientName + "_" + sanitizedToolName] = tool
          }
        }
      }
    }

    return result
  }
}
