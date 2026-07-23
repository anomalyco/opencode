import { Context, Effect, Schema, Config, Option } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"

/**
 * Typed error for all Linear MCP failures (connection, tool call, GraphQL
 * fallback). Uses `Schema.TaggedErrorClass` per packages/opencode/AGENTS.md
 * "Use `Schema.TaggedErrorClass` for typed errors" so it carries a `_tag`
 * field and can be caught precisely with `Effect.catchTag("LinearMcpError", …)`,
 * letting defects (Interrupt/Die) propagate.
 *
 * `cause` uses `Schema.Defect` (per AGENTS.md [E4]) since it carries
 * arbitrary thrown values from the MCP SDK / fetch layer that are
 * defect-like — preserves the original cause for logs without claiming
 * a typed shape. Matches the pattern in `sync-pull.ts` / `sync-push.ts`.
 */
export class LinearMcpError extends Schema.TaggedErrorClass<LinearMcpError>()("LinearMcpError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Domain-level error union (per AGENTS.md [E9] — export Error from service modules). */
export type Error = LinearMcpError

/**
 * Request-derived Context tag carrying the resolved Linear MCP client
 * (or null when neither MCP registration nor env-var fallback produced a
 * client).
 *
 * Provided per-request by `LinearClientMiddleware` (see
 * `server/routes/instance/httpapi/middleware/linear-client.ts`), per
 * `httpapi/AGENTS.md` [line 35]: `Effect.provideService` for this tag
 * lives in middleware only — handlers yield the tag, they do not inject
 * it. Consumed by:
 *   - HTTP handlers in `handlers/issue.ts` (linear* + sync routes)
 *   - Sync services `SyncPull.pull` and `SyncPush.push`
 *
 * The agent-side `issue_sync` tool also provides this tag via
 * `Effect.provideService` (agent tools are outside the HTTP API rule's
 * scope — the rule is scoped to `httpapi/`).
 */
export const LinearClientRef = Context.Service<LinearMcpClient | null>("@opencode/LinearClientRef")

/** Options for creating a LinearMcpClient */
export interface Opts {
  /** MCP server URL (default: https://mcp.linear.app/mcp) */
  url?: string
  /** API key (default: read from `LINEAR_API_KEY` via Effect `Config`) */
  key?: string
}

/**
 * StreamableHTTP client for the Linear MCP server.
 *
 * Wraps the MCP SDK Client with linear-opencode lifecycle:
 * connect on create, fail on disconnect, cleanup on close.
 *
 * `create` is a traced `Effect.fn` per AGENTS.md [C2]. Instance methods
 * (`listTools`/`callTool`/`close`/`status`) use plain `Effect.gen` —
 * they are class methods that close over `this`, and `Effect.fn`'s
 * arrow-function form loses `this` typing. The class is not a Context
 * Service, so the service-method [C2] rule does not strictly apply.
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
   * Reads `LINEAR_API_KEY` via Effect's `Config` system (per AGENTS.md
   * [P4] — prefer `Config` over `process.env`) when not passed via opts.
   * Fails with `LinearMcpError` if the key is missing or connection fails.
   */
  static create = Effect.fn("LinearMcpClient.create")(function* (opts: Opts = {}) {
    const url = opts.url ?? "https://mcp.linear.app/mcp"
    // Effect's `Config` reads through the active ConfigProvider (env vars
    // by default). `Config.option` returns None if the var is unset.
    const keyOption = yield* Config.string("LINEAR_API_KEY").pipe(Config.option)
    const envKey = Option.getOrNull(keyOption)
    const key = opts.key ?? envKey
    if (!key) return yield* new LinearMcpError({ message: "LINEAR_API_KEY not set" })

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
      catch: (e) => new LinearMcpError({ message: `Failed to connect to Linear MCP: ${String(e)}`, cause: e }),
    })
  })

  /**
   * Wrap an already-connected MCP SDK Client as a LinearMcpClient.
   * Used to bridge SyncPull/SyncPush to the project's connected Linear MCP
   * server (looked up via `MCP.Service.clients()`), avoiding a second
   * connection via API key.
   */
  static wrap(client: Client): LinearMcpClient {
    return Object.create(LinearMcpClient.prototype, {
      client: { value: client, writable: false },
      transport: { value: null, writable: false },
      connected: { value: true, writable: true },
    })
  }

  /** List available tools from the Linear MCP server. Fails if disconnected. */
  listTools(): Effect.Effect<Tool[], LinearMcpError> {
    const self = this
    return Effect.gen(function* () {
      if (!self.connected) return yield* new LinearMcpError({ message: "Client is disconnected" })
      return yield* Effect.tryPromise({
        try: () => self.client.listTools().then((r) => r.tools),
        catch: (e) => new LinearMcpError({ message: `Failed to list tools: ${String(e)}`, cause: e }),
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
      if (!self.connected) return yield* new LinearMcpError({ message: "Client is disconnected" })
      return yield* Effect.tryPromise({
        try: () => self.client.callTool({ name, arguments: args }, CallToolResultSchema),
        catch: (e) =>
          new LinearMcpError({ message: `Failed to call tool "${name}": ${String(e)}`, cause: e }),
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
