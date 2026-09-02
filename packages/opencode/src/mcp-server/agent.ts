import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { z } from "zod"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { OpencodeClient, Message, Part } from "@opencode-ai/sdk/v2"
import { ServerAuth } from "@/server/auth"
import http from "http"

const NAME = "opencode"
const VERSION = InstallationVersion

type Transport = "stdio" | "streamable-http" | "sse"

interface Options {
  readonly transport: Transport
  readonly port?: number
  readonly path?: string
  readonly hostname?: string
}

interface ServerHandle {
  readonly hostname: string
  readonly port: number
  readonly stop: () => Promise<void>
}

export interface Interface {
  readonly start: (options: Options) => Promise<ServerHandle>
}

export function init({ sdk }: { sdk: OpencodeClient }): Interface {
  return {
    start: (options: Options) => createServer(sdk, options),
  }
}

// The MCP SDK ships its own nested `zod` dependency, which can resolve to a
// different minor version than this package's `zod`. The two versions are
// runtime-compatible but structurally distinct to the type checker, so the
// raw shapes are cast when handed to registerTool.
const sessionOptionalTitleSchema = {
  title: z.string().optional().describe("Session title (auto-generated if not provided)"),
} as any

const sessionIdSchema = {
  session_id: z.string().describe("Session ID"),
} as any

const promptSchema = {
  session_id: z.string().describe("Session ID. Create one first with create_session if needed."),
  message: z.string().describe("The task or question to send to the session"),
} as any

export function formatParts(role: string, parts: Array<Part>): string[] {
  const lines: string[] = []

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.trim()) lines.push(`[${role}] ${part.text}`)
    } else if (part.type === "tool") {
      const label = `[Tool ${part.tool}]`
      if (part.state.status === "completed") {
        lines.push(`${label} ${part.state.output.trim()}`)
      } else if (part.state.status === "error") {
        lines.push(`${label} error: ${part.state.error}`)
      }
    } else if (part.type === "file") {
      lines.push(`[File] ${part.filename ?? part.url}`)
    }
  }

  return lines
}

export function formatMessages(messages: Array<{ info: Message; parts: Array<Part> }>): string {
  const lines: string[] = []

  for (const { info, parts } of messages) {
    const role = info.role === "user" ? "User" : `Assistant`
    lines.push(...formatParts(role, parts))
  }

  return lines.join("\n\n")
}

async function createServer(sdk: OpencodeClient, options: Options): Promise<ServerHandle> {
  const mcpServer = new McpServer({ name: NAME, version: VERSION })

  mcpServer.registerTool(
    "create_session",
    {
      description: "Create a new opencode session for a coding task. Returns a session ID you can use to send prompts.",
      inputSchema: sessionOptionalTitleSchema,
    },
    async (input: any) => {
      try {
        const result = await sdk.session.create({ title: input.title }, { throwOnError: true })
        const session = result.data

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: session.id,
                  title: session.title,
                  directory: session.directory,
                },
                null,
                2,
              ),
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to create session: ${error}` }],
          isError: true,
        }
      }
    },
  )

  mcpServer.registerTool(
    "list_sessions",
    {
      description: "List recent opencode sessions with their status",
      inputSchema: {},
    },
    async () => {
      try {
        const result = await sdk.session.list({ limit: 50 }, { throwOnError: true })

        const lines = result.data.map((s) => {
          const status = s.time.archived ? "archived" : "active"
          return `- ${s.id} (${status}) ${s.title}`
        })

        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "No sessions found" }],
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to list sessions: ${error}` }],
          isError: true,
        }
      }
    },
  )

  mcpServer.registerTool(
    "get_session",
    {
      description: "Get details about a specific session",
      inputSchema: sessionIdSchema,
    },
    async (input: any) => {
      try {
        const result = await sdk.session.get({ sessionID: input.session_id }, { throwOnError: true })
        const session = result.data

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  session_id: session.id,
                  title: session.title,
                  status: session.time.archived ? "archived" : "active",
                  created_at: session.time.created,
                  updated_at: session.time.updated,
                },
                null,
                2,
              ),
            },
          ],
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Session not found: ${input.session_id}` }],
          isError: true,
        }
      }
    },
  )

  mcpServer.registerTool(
    "prompt",
    {
      description:
        "Send a message to an opencode session and wait for processing to complete. The session will use AI and tools to complete the task.",
      inputSchema: promptSchema,
    },
    async (input: any) => {
      try {
        const result = await sdk.session.prompt(
          {
            sessionID: input.session_id,
            parts: [{ type: "text", text: input.message }],
          },
          { throwOnError: true },
        )

        return {
          content: [{ type: "text" as const, text: formatParts("Assistant", result.data.parts).join("\n\n") }],
        }
      } catch (error) {
        const message = String(error)
        if (message.includes("not found")) {
          return {
            content: [{ type: "text" as const, text: `Session not found: ${input.session_id}` }],
            isError: true,
          }
        }
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        }
      }
    },
  )

  mcpServer.registerTool(
    "get_context",
    {
      description: "Get the full message history of a session",
      inputSchema: sessionIdSchema,
    },
    async (input: any) => {
      try {
        const result = await sdk.session.messages({ sessionID: input.session_id }, { throwOnError: true })
        return {
          content: [{ type: "text" as const, text: formatMessages(result.data) }],
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to get context: ${error}` }],
          isError: true,
        }
      }
    },
  )

  mcpServer.registerTool(
    "interrupt_session",
    {
      description: "Interrupt a running session. Use this if a session is taking too long.",
      inputSchema: sessionIdSchema,
    },
    async (input: any) => {
      try {
        await sdk.session.abort({ sessionID: input.session_id })
        return {
          content: [{ type: "text" as const, text: "Session interrupted" }],
        }
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to interrupt session: ${error}` }],
          isError: true,
        }
      }
    },
  )

  return startTransport(mcpServer, options)
}

async function startTransport(server: McpServer, options: Options): Promise<ServerHandle> {
  switch (options.transport) {
    case "stdio":
      return startStdio(server)
    case "streamable-http":
      return startStreamableHTTP(server, options)
    case "sse":
      return startSSE(server, options)
  }
}

async function startStdio(server: McpServer): Promise<ServerHandle> {
  const transport = new StdioServerTransport()
  await server.connect(transport)

  return {
    hostname: "stdio",
    port: 0,
    stop: async () => {
      await server.close()
      process.exit(0)
    },
  }
}

async function startStreamableHTTP(server: McpServer, options: Options): Promise<ServerHandle> {
  const port = options.port ?? 3001
  const hostname = options.hostname ?? "127.0.0.1"
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const expectedAuth = ServerAuth.header()

  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (expectedAuth && req.headers.authorization !== expectedAuth) {
      res.writeHead(401)
      res.end()
      return
    }

    const sessionId = req.headers["x-session-id"] as string | undefined
    let transport = sessionId ? transports.get(sessionId) : undefined

    if (!transport) {
      const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id: string) => {
          transports.set(id, newTransport)
        },
      })

      newTransport.onclose = () => {
        if (sessionId) transports.delete(sessionId)
      }

      await server.connect(newTransport)
      transport = newTransport
    }

    await transport.handleRequest(req, res)
  }

  const httpServer = http.createServer(handleRequest)

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(port, hostname, () => resolve())
  })

  return {
    hostname,
    port,
    stop: async () => {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
      await server.close()
    },
  }
}

async function startSSE(server: McpServer, options: Options): Promise<ServerHandle> {
  const port = options.port ?? 3002
  const hostname = options.hostname ?? "127.0.0.1"
  const path = options.path ?? "/mcp"
  const transports = new Map<string, SSEServerTransport>()
  const expectedAuth = ServerAuth.header()

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${hostname}:${port}`)

    if (url.pathname.startsWith(`${path}/messages/`)) {
      const sessionId = url.pathname.split("/").pop()
      const transport = sessionId ? transports.get(sessionId) : undefined
      if (transport && req.method === "POST") transport.handlePostMessage(req, res)
      else res.writeHead(404).end()
      return
    }

    if (url.pathname === path && req.method === "GET") {
      if (expectedAuth && req.headers.authorization !== expectedAuth) {
        res.writeHead(401).end()
        return
      }

      const sessionId = crypto.randomUUID()
      const transport = new SSEServerTransport(`${path}/messages/${sessionId}`, res)
      transports.set(sessionId, transport)
      transport.onclose = () => transports.delete(sessionId)
      server.connect(transport)
      return
    }

    res.writeHead(404).end()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(port, hostname, () => resolve())
  })

  return {
    hostname,
    port,
    stop: async () => {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
      await server.close()
    },
  }
}

export * as McpServerAgent from "./agent"
