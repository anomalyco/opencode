import { Effect } from "effect"
import z from "zod/v4"
import { NamedError } from "@opencode-ai/util/error"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js"

/**
 * Error type for Linear MCP operations.
 * The actual message is stored in `.data.message` (NamedError stores the class name in `.message`).
 * Use `LinearMcpError.isInstance(e)` to check, then access `e.data.message`.
 */
export const LinearMcpError = NamedError.create(
  "LinearMcpError",
  z.object({
    message: z.string(),
    cause: z.unknown().optional(),
  }),
)
export type LinearMcpError = InstanceType<typeof LinearMcpError>

/** Options for creating a LinearMcpClient */
export interface Opts {
  /** MCP server URL (default: https://mcp.linear.app/mcp) */
  url?: string
  /** API key (default: process.env.LINEAR_API_KEY) */
  key?: string
}

/** Re-export of MCP SDK Tool type */
export type Tool = MCPTool

function err(message: string, cause?: unknown): LinearMcpError {
  return new LinearMcpError({ message, cause })
}

function fail(message: string, cause?: unknown): Effect.Effect<never, LinearMcpError> {
  return Effect.fail(err(message, cause))
}

/**
 * StreamableHTTP client for the Linear MCP server.
 *
 * Wraps the MCP SDK Client with linear-opencode lifecycle:
 * connect on create, fail on disconnect, cleanup on close.
 */
export class LinearMcpClient {
  readonly client: Client
  readonly transport: StreamableHTTPClientTransport
  connected: boolean

  private constructor(client: Client, transport: StreamableHTTPClientTransport) {
    this.client = client
    this.transport = transport
    this.connected = true
  }

  /**
   * Connect to the Linear MCP server and return a ready client.
   * Reads `LINEAR_API_KEY` from env if not passed via opts.
   * Fails with `LinearMcpError` if the key is missing or connection fails.
   */
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

  /** List available tools from the Linear MCP server. Fails if disconnected. */
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

  /**
   * Call a named tool on the Linear MCP server.
   * The result format follows MCP protocol: `{ content: [{ type: "text", text: "..." }] }`.
   * The `text` field typically contains JSON-encoded Linear GraphQL response data.
   */
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

  /** Disconnect from the MCP server. Idempotent — safe to call multiple times. */
  close(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) return
      self.connected = false
      yield* Effect.tryPromise(() => self.client.close()).pipe(Effect.ignore)
    })
  }

  /** Returns "connected" if the client is active, "disconnected" after close(). */
  status(): Effect.Effect<"connected" | "disconnected"> {
    return Effect.succeed(this.connected ? "connected" : "disconnected")
  }
}
