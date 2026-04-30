import { test, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// --- Mock infrastructure -----------------------------------------------------

interface MockCallToolBehavior {
  // Errors to throw on successive calls. After the array is exhausted, calls
  // succeed with `successResult`.
  throwQueue: Error[]
  // Total invocations across all clients with this name (includes retries).
  invocations: number
  successResult: unknown
}

const callToolBehaviors = new Map<string, MockCallToolBehavior>()

// Each Client construction increments this. We use it to count reconnects:
// a fresh Client is created during reconnect → createAndStore → create.
let clientCreateCount = 0
let lastCreatedClientName: string | undefined

class MockTransport {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url?: any, _opts?: any) {}
  async start() {}
  async close() {}
  async finishAuth() {}
}

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockTransport,
}))
void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {
    constructor() {
      super("Unauthorized")
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    private _name: string | undefined
    transport: any

    constructor(_opts: any) {
      clientCreateCount++
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      this._name = lastCreatedClientName
    }

    setNotificationHandler(_schema: unknown, _handler: (...args: any[]) => any) {}

    async listTools() {
      return {
        tools: [
          {
            name: "do_thing",
            description: "does a thing",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }
    }

    async listPrompts() {
      return { prompts: [] }
    }
    async listResources() {
      return { resources: [] }
    }

    async callTool(_req: unknown, _schema: unknown, _opts: unknown) {
      const key = this._name ?? "default"
      const behavior = callToolBehaviors.get(key)
      if (!behavior) throw new Error(`No callTool behavior set for "${key}"`)
      behavior.invocations++
      const next = behavior.throwQueue.shift()
      if (next) throw next
      return behavior.successResult
    }

    async close() {}
  },
}))

beforeEach(() => {
  callToolBehaviors.clear()
  clientCreateCount = 0
  lastCreatedClientName = undefined
})

// Import after mocks
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

function withInstance(
  config: Record<string, unknown>,
  fn: (mcp: MCPNS.Interface) => Effect.Effect<void, unknown, never>,
) {
  return async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: config,
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Effect.runPromise(MCP.Service.use(fn).pipe(Effect.provide(MCP.defaultLayer)))
        await Instance.dispose()
      },
    })
  }
}

// ============================================================================
// Test: a single Session-not-found error triggers reconnect + retry success
// ============================================================================

test(
  "tool call recovers from a one-shot 'Session not found' error",
  withInstance(
    { "remote-srv": { type: "remote", url: "https://example.com/mcp", oauth: false } },
    (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "remote-srv"
      callToolBehaviors.set("remote-srv", {
        throwQueue: [new Error('Error POSTing to endpoint: {"error":"Session not found"}')],
        invocations: 0,
        successResult: { content: [{ type: "text", text: "ok" }] },
      })

      yield* mcp.add("remote-srv", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const initialClientCount = clientCreateCount
      const tools = yield* mcp.tools()
      const toolKey = Object.keys(tools).find((k) => k.includes("do_thing"))!
      expect(toolKey).toBeDefined()

      const result = yield* Effect.promise(() =>
        // The AI SDK calls execute() with two args (input, options). We pass undefined to mimic.
        (tools[toolKey] as any).execute({}, undefined as any),
      )

      // Tool returned the success value after recovery
      expect(result).toEqual({ content: [{ type: "text", text: "ok" }] })

      const behavior = callToolBehaviors.get("remote-srv")!
      // Two invocations: original (threw) + retry on the new client
      expect(behavior.invocations).toBe(2)

      // Reconnect created exactly one new Client (no infinite loop)
      expect(clientCreateCount - initialClientCount).toBe(1)
    }),
  ),
)

// ============================================================================
// Test: persistent Session-not-found surfaces after exactly one retry
// ============================================================================

test(
  "tool call propagates after one retry when session error persists",
  withInstance(
    { "stuck-srv": { type: "remote", url: "https://example.com/mcp", oauth: false } },
    (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "stuck-srv"
      callToolBehaviors.set("stuck-srv", {
        throwQueue: [
          new Error('Error POSTing to endpoint: {"error":"Session not found"}'),
          new Error('Error POSTing to endpoint: {"error":"Session not found"}'),
          // A third in case the no-loop guarantee fails — surface that as a clear test failure.
          new Error('Error POSTing to endpoint: {"error":"Session not found"}'),
        ],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("stuck-srv", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const tools = yield* mcp.tools()
      const toolKey = Object.keys(tools).find((k) => k.includes("do_thing"))!

      const result = yield* Effect.promise(() =>
        (tools[toolKey] as any)
          .execute({}, undefined as any)
          .then(() => ({ ok: true }))
          .catch((err: Error) => ({ ok: false, message: err.message })),
      )

      expect((result as any).ok).toBe(false)
      expect((result as any).message).toMatch(/session\s*not\s*found/i)

      const behavior = callToolBehaviors.get("stuck-srv")!
      // Exactly two invocations: original + one retry. No further retries.
      expect(behavior.invocations).toBe(2)
    }),
  ),
)

// ============================================================================
// Test: non-session-error errors propagate immediately (no reconnect attempt)
// ============================================================================

test(
  "non-session errors are not treated as recoverable",
  withInstance(
    { "fail-srv": { type: "remote", url: "https://example.com/mcp", oauth: false } },
    (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "fail-srv"
      callToolBehaviors.set("fail-srv", {
        throwQueue: [new Error("Bad request: invalid arguments")],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("fail-srv", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const initialClientCount = clientCreateCount
      const tools = yield* mcp.tools()
      const toolKey = Object.keys(tools).find((k) => k.includes("do_thing"))!

      const outcome = yield* Effect.promise(() =>
        (tools[toolKey] as any)
          .execute({}, undefined as any)
          .then(() => ({ ok: true }))
          .catch((err: Error) => ({ ok: false, message: err.message })),
      )

      expect((outcome as any).ok).toBe(false)
      expect((outcome as any).message).toMatch(/Bad request/i)

      // Exactly one invocation; no reconnect attempted.
      expect(callToolBehaviors.get("fail-srv")!.invocations).toBe(1)
      expect(clientCreateCount - initialClientCount).toBe(0)
    }),
  ),
)
