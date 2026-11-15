export type ClientMcpOptions = {
  /** Base URL of the opencode server, for example `http://127.0.0.1:4096`. Its query params are kept. */
  readonly url: string
  /** Client name, `[a-zA-Z0-9_-]+`. Tools are exposed to the model as `<name>_<tool>`. */
  readonly name: string
  /** Sent as `location[directory]`. */
  readonly directory?: string
  /** Handshake headers, such as `authorization`. Browsers cannot send them; use a ticket in `url` instead. */
  readonly headers?: Record<string, string>
  readonly tools: ReadonlyArray<ClientMcpTool>
  readonly WebSocket?: typeof WebSocket
}

export type ClientMcpTool = {
  /** `[a-zA-Z0-9_-]+` */
  readonly name: string
  readonly description?: string
  /** JSON Schema for the arguments; `type: "object"` is always set. Arguments are not validated here. */
  readonly inputSchema?: Record<string, unknown>
  readonly handler: (
    args: Record<string, unknown>,
    ctx: ClientMcpToolContext,
  ) => ClientMcpToolResult | Promise<ClientMcpToolResult>
}

export type ClientMcpToolContext = {
  /** The opencode session that issued the call. */
  readonly sessionID?: string
}

export type ClientMcpToolResult = {
  readonly content: ReadonlyArray<
    | { readonly type: "text"; readonly text: string }
    | { readonly type: "image"; readonly data: string; readonly mimeType: string }
  >
  readonly isError?: boolean
}

export type ClientMcpConnection = {
  close(): Promise<void>
}

type Message = {
  readonly id?: unknown
  readonly method?: unknown
  readonly params?: {
    readonly protocolVersion?: unknown
    readonly name?: unknown
    readonly arguments?: Record<string, unknown>
    readonly _meta?: Record<string, unknown>
  }
}

const SESSION_ID_META_KEY = "ai.opencode/sessionID"
const PROTOCOL_VERSION = "2025-11-25"
const RECONNECT_MIN = 500
const RECONNECT_MAX = 10_000

/**
 * Exposes tools to the opencode server: opens a WebSocket to `/api/experimental/client-mcp` and answers MCP
 * JSON-RPC over it (one message per text frame), so the opencode server is the MCP client. Reconnects with
 * backoff until `close()`.
 */
export function connectClientMcp(options: ClientMcpOptions): ClientMcpConnection {
  const state: { disposed: boolean; delay: number; timer?: ReturnType<typeof setTimeout>; socket?: WebSocket } = {
    disposed: false,
    delay: RECONNECT_MIN,
  }

  const connect = () => {
    if (state.disposed) return
    const Socket = options.WebSocket ?? WebSocket
    const socket = options.headers
      ? // Bun and Node accept a `{ headers }` init as the second argument; the DOM typings only know protocols.
        new Socket(endpoint(options), { headers: options.headers } as unknown as string[])
      : new Socket(endpoint(options))
    state.socket = socket
    socket.addEventListener("message", (event) => {
      if (state.disposed || typeof event.data !== "string") return
      const message = parse(event.data)
      if (!message) return
      // Reset backoff only once the opencode server finished initializing, so a failed attach keeps backing off.
      if (message.method === "notifications/initialized") state.delay = RECONNECT_MIN
      // Notifications and responses need no reply.
      if ((typeof message.id !== "string" && typeof message.id !== "number") || typeof message.method !== "string")
        return
      void respond(options, message.method, message.params).then((reply) =>
        send(socket, { jsonrpc: "2.0", id: message.id, ...reply }),
      )
    })
    socket.addEventListener("close", () => {
      if (state.socket === socket) state.socket = undefined
      if (state.disposed) return
      state.timer = setTimeout(connect, state.delay)
      state.delay = Math.min(state.delay * 2, RECONNECT_MAX)
    })
  }

  connect()

  return {
    async close() {
      state.disposed = true
      clearTimeout(state.timer)
      state.socket?.close(1000)
    },
  }
}

async function respond(options: ClientMcpOptions, method: string, params: Message["params"]) {
  switch (method) {
    case "initialize":
      return {
        result: {
          // The opencode server only offers versions it supports, so echo its choice.
          protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: options.name, version: "1.0.0" },
        },
      }
    case "ping":
      return { result: {} }
    case "tools/list":
      return {
        result: {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: { type: "object", ...tool.inputSchema },
          })),
        },
      }
    case "tools/call": {
      const tool = options.tools.find((tool) => tool.name === params?.name)
      if (!tool) return { error: { code: -32602, message: `Unknown tool: ${String(params?.name)}` } }
      const meta = params?._meta?.[SESSION_ID_META_KEY]
      return Promise.resolve()
        .then(() => tool.handler(params?.arguments ?? {}, { sessionID: typeof meta === "string" ? meta : undefined }))
        .then(
          (result) => ({ result }),
          (error) => ({
            result: {
              content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
              isError: true,
            },
          }),
        )
    }
  }
  return { error: { code: -32601, message: `Method not found: ${method}` } }
}

function send(socket: WebSocket, message: object) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

function parse(text: string): Message | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function endpoint(options: ClientMcpOptions) {
  const base = new URL(options.url)
  if (!base.pathname.endsWith("/")) base.pathname += "/"
  const url = new URL("api/experimental/client-mcp", base)
  url.search = base.search
  if (options.directory) url.searchParams.set("location[directory]", options.directory)
  url.searchParams.set("name", options.name)
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:"
  return url
}
