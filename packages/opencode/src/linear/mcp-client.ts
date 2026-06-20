import { Effect } from "effect"
import z from "zod/v4"
import { NamedError } from "@opencode-ai/util/error"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js"

export const LinearMcpError = NamedError.create(
  "LinearMcpError",
  z.object({
    message: z.string(),
    cause: z.unknown().optional(),
  }),
)
export type LinearMcpError = InstanceType<typeof LinearMcpError>

export interface Opts {
  url?: string
  key?: string
}

export type Tool = MCPTool

function err(message: string, cause?: unknown): LinearMcpError {
  return new LinearMcpError({ message, cause })
}

function fail(message: string, cause?: unknown): Effect.Effect<never, LinearMcpError> {
  return Effect.fail(err(message, cause))
}

export class LinearMcpClient {
  readonly client: Client
  readonly transport: StreamableHTTPClientTransport
  connected: boolean

  private constructor(client: Client, transport: StreamableHTTPClientTransport) {
    this.client = client
    this.transport = transport
    this.connected = true
  }

  /** Connect to the Linear MCP server and return a ready client */
  static create = Effect.fn("LinearMcpClient.create")(function* (opts: Opts = {}) {
    const url = opts.url ?? "https://mcp.linear.app/mcp"
    const key = opts.key ?? process.env.LINEAR_API_KEY
    if (!key) return yield* fail("LINEAR_API_KEY not set")

    const tr = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${key}` },
      },
    })

    const cl = new Client({ name: "opencode", version: "0.0.0" })

    return yield* Effect.tryPromise({
      try: async () => {
        await cl.connect(tr)
        return new LinearMcpClient(cl, tr)
      },
      catch: (e) => err(`Failed to connect to Linear MCP: ${String(e)}`, e),
    })
  })

  listTools(): Effect.Effect<Tool[], LinearMcpError> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) return yield* fail("Client is disconnected")
      return yield* Effect.tryPromise({
        try: () => self.client.listTools().then((r) => r.tools),
        catch: (e) => err(`Failed to list tools: ${String(e)}`, e),
      })
    })
  }

  callTool(name: string, args: Record<string, unknown>): Effect.Effect<unknown, LinearMcpError> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) return yield* fail("Client is disconnected")
      return yield* Effect.tryPromise({
        try: () => self.client.callTool({ name, arguments: args }, CallToolResultSchema),
        catch: (e) => err(`Failed to call tool "${name}": ${String(e)}`, e),
      })
    })
  }

  close(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) return
      self.connected = false
      yield* Effect.tryPromise(() => self.client.close()).pipe(Effect.ignore)
    })
  }

  status(): Effect.Effect<"connected" | "disconnected"> {
    return Effect.succeed(this.connected ? "connected" : "disconnected")
  }
}
