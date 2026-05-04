import { test, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

// --- Overview ---------------------------------------------------------------
//
// This file mocks an MCP server and reproduces the transport-level failure
// modes that a real MCP server hits when it is *restarted* on the same port,
// *down*, or kills an in-flight request. The goal is to prove end-to-end that
// `tool.execute()` in `src/mcp/index.ts` transparently reconnects and retries
// exactly once on transport errors, and does NOT retry on business errors.
//
// Contrast with `session-error.test.ts`: that file uses a plain
// `new Error("Session not found")` string, which is a weaker signal. Here we
// feed the exact shapes `isTransportError` recognises — a stub
// `StreamableHTTPError` (for HTTP 4xx/5xx from a restarted server) and plain
// Errors carrying a Bun/Node socket `code`.

// --- Stub StreamableHTTPError ----------------------------------------------
//
// We must construct a class that `src/mcp/transport-error.ts` will see as
// `StreamableHTTPError` via `instanceof`. To do that we mock the SDK module
// below and re-export THIS class under that name; the errors we throw in
// tests are then `new StubStreamableHTTPError(...)`, which is the same class
// that `transport-error.ts` imports once the mock is active.
class StubStreamableHTTPError extends Error {
  readonly code: number | undefined
  constructor(code: number | undefined, message: string) {
    super(message)
    this.code = code
  }
}

// --- Mock infrastructure ----------------------------------------------------

interface MockCallToolBehavior {
  // Errors to throw on successive calls. After the array drains, calls succeed
  // with `successResult`.
  throwQueue: Error[]
  // Total invocations across all Client instances bound to this name
  // (original call + any retries after reconnect).
  invocations: number
  successResult: unknown
}

const callToolBehaviors = new Map<string, MockCallToolBehavior>()

// Each Client construction bumps this. We use it to observe whether a
// reconnect actually happened (reconnect path: getMcpConfig -> createAndStore
// -> new Client).
let clientCreateCount = 0
let lastCreatedClientName: string | undefined

// Queue of errors to inject on the NEXT transport.start(). We use this to
// simulate a server that is still down during the reconnect attempt.
let transportStartFailQueue: Error[] = []

class MockTransport {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url?: any, _opts?: any) {}
  async start() {
    const next = transportStartFailQueue.shift()
    if (next) throw next
  }
  async close() {}
  async finishAuth() {}
}

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockTransport,
  // Re-export the stub so `src/mcp/transport-error.ts`'s `instanceof` check
  // resolves to the same class we throw in the tests below.
  StreamableHTTPError: StubStreamableHTTPError,
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
  transportStartFailQueue = []
  lastCreatedClientName = undefined
})

// Imports AFTER mocks, so src/mcp/* picks up the mocked SDK modules.
const { MCP } = await import("../../src/mcp/index")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { WithInstance } = await import("../../src/project/with-instance")
const { tmpdir } = await import("../fixture/fixture")
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

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

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const mcp = yield* service
            yield* fn(mcp)
          }),
        )
      },
    })
  }
}

// Helper: fetch the wrapped tool and invoke it the way the AI SDK does.
function execTool(tools: Record<string, unknown>) {
  const key = Object.keys(tools).find((k) => k.includes("do_thing"))!
  expect(key).toBeDefined()
  return (tools[key] as any).execute({}, undefined as any) as Promise<unknown>
}

// ============================================================================
// HTTP-layer restart: 404 "Session not found" after the server respawned
// ============================================================================

test(
  "restart window: StreamableHTTPError 404 stale session → reconnect + retry succeeds",
  withInstance({ "restart-404": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "restart-404"
      callToolBehaviors.set("restart-404", {
        throwQueue: [new StubStreamableHTTPError(404, "Session 8f7c3d42 not found")],
        invocations: 0,
        successResult: { content: [{ type: "text", text: "ok" }] },
      })

      yield* mcp.add("restart-404", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const result = yield* Effect.promise(() => execTool(tools))

      expect(result).toEqual({ content: [{ type: "text", text: "ok" }] })
      // original call threw, retry on the fresh client succeeded
      expect(callToolBehaviors.get("restart-404")!.invocations).toBe(2)
      // exactly one reconnect (no loop)
      expect(clientCreateCount - baseline).toBe(1)
    }),
  ),
)

// ============================================================================
// HTTP-layer restart: 400 "No valid session ID provided" (probe-observed)
// ============================================================================

test(
  "restart window: StreamableHTTPError 400 no valid session → reconnect + retry succeeds",
  withInstance({ "restart-400": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "restart-400"
      callToolBehaviors.set("restart-400", {
        throwQueue: [new StubStreamableHTTPError(400, "Bad Request: No valid session ID provided")],
        invocations: 0,
        successResult: { content: [{ type: "text", text: "recovered" }] },
      })

      yield* mcp.add("restart-400", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const result = yield* Effect.promise(() => execTool(tools))

      expect(result).toEqual({ content: [{ type: "text", text: "recovered" }] })
      expect(callToolBehaviors.get("restart-400")!.invocations).toBe(2)
      expect(clientCreateCount - baseline).toBe(1)
    }),
  ),
)

// ============================================================================
// Socket-layer restart: Bun ConnectionRefused (port briefly not listening)
// ============================================================================

test(
  "restart window: Bun ConnectionRefused on callTool → reconnect + retry succeeds",
  withInstance({ "restart-refused": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "restart-refused"
      const refused = Object.assign(new Error("Unable to connect. Is the computer able to access the url?"), {
        code: "ConnectionRefused",
      })
      callToolBehaviors.set("restart-refused", {
        throwQueue: [refused],
        invocations: 0,
        successResult: { content: [{ type: "text", text: "back online" }] },
      })

      yield* mcp.add("restart-refused", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const result = yield* Effect.promise(() => execTool(tools))

      expect(result).toEqual({ content: [{ type: "text", text: "back online" }] })
      expect(callToolBehaviors.get("restart-refused")!.invocations).toBe(2)
      expect(clientCreateCount - baseline).toBe(1)
    }),
  ),
)

// ============================================================================
// In-flight killed by restart: `fetch failed` + cause.code=ECONNRESET
// ============================================================================

test(
  "in-flight killed: fetch failed + cause ECONNRESET → reconnect + retry succeeds",
  withInstance({ "restart-reset": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "restart-reset"
      const reset = new Error("fetch failed", {
        cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      })
      callToolBehaviors.set("restart-reset", {
        throwQueue: [reset],
        invocations: 0,
        successResult: { content: [{ type: "text", text: "resumed" }] },
      })

      yield* mcp.add("restart-reset", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const result = yield* Effect.promise(() => execTool(tools))

      expect(result).toEqual({ content: [{ type: "text", text: "resumed" }] })
      expect(callToolBehaviors.get("restart-reset")!.invocations).toBe(2)
      expect(clientCreateCount - baseline).toBe(1)
    }),
  ),
)

// ============================================================================
// Restart but server still stuck: reconnect succeeds, next callTool still 404
// → retry exactly once, then propagate. No infinite loop.
// ============================================================================

test(
  "persistent restart failure: 404 on every call → one retry then propagate",
  withInstance({ "stuck-restart": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "stuck-restart"
      callToolBehaviors.set("stuck-restart", {
        throwQueue: [
          new StubStreamableHTTPError(404, "Session not found"),
          new StubStreamableHTTPError(404, "Session not found"),
          // a 3rd in case the no-loop guarantee ever breaks
          new StubStreamableHTTPError(404, "Session not found"),
        ],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("stuck-restart", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const outcome = yield* Effect.promise(() =>
        execTool(tools)
          .then(() => ({ ok: true as const }))
          .catch((err: Error) => ({ ok: false as const, message: err.message })),
      )

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.message).toMatch(/session\s*not\s*found/i)
      // Exactly two invocations: original + one retry, no more.
      expect(callToolBehaviors.get("stuck-restart")!.invocations).toBe(2)
      // Reconnect happened exactly once.
      expect(clientCreateCount - baseline).toBe(1)
    }),
  ),
)

// ============================================================================
// Server permanently down: reconnect itself fails (transport.start throws)
// → original transport error propagates, no retry attempted.
// ============================================================================

test(
  "server down: reconnect attempt fails → original transport error propagates without retry",
  withInstance({ "down-srv": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "down-srv"
      callToolBehaviors.set("down-srv", {
        throwQueue: [new StubStreamableHTTPError(404, "Session not found")],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("down-srv", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      // createAndStore tries StreamableHTTP first and falls back to SSE on
      // failure — queue up enough failures to defeat BOTH attempts so the
      // reconnect fully fails and the original error is what propagates.
      const refused = () => Object.assign(new Error("Unable to connect"), { code: "ConnectionRefused" })
      transportStartFailQueue.push(refused(), refused(), refused(), refused())

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const outcome = yield* Effect.promise(() =>
        execTool(tools)
          .then(() => ({ ok: true as const }))
          .catch((err: Error) => ({ ok: false as const, message: err.message })),
      )

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.message).toMatch(/session\s*not\s*found/i)
      // Original call ran once; reconnect failed so retry was never issued.
      expect(callToolBehaviors.get("down-srv")!.invocations).toBe(1)
      // Reconnect DID attempt a fresh Client (bumping the counter) even though
      // it failed — the important bit is we didn't loop and didn't retry.
      expect(clientCreateCount - baseline).toBeGreaterThanOrEqual(1)
    }),
  ),
)

// ============================================================================
// Business error must NOT be treated as a transport error: no reconnect, no
// retry, error surfaces as-is.
// ============================================================================

test(
  "business error (non-transport) → propagates immediately, zero reconnect",
  withInstance({ "biz-err": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "biz-err"
      callToolBehaviors.set("biz-err", {
        throwQueue: [new Error("tool 'do_thing' not found")],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("biz-err", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const outcome = yield* Effect.promise(() =>
        execTool(tools)
          .then(() => ({ ok: true as const }))
          .catch((err: Error) => ({ ok: false as const, message: err.message })),
      )

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.message).toMatch(/not found/i)
      expect(callToolBehaviors.get("biz-err")!.invocations).toBe(1)
      expect(clientCreateCount - baseline).toBe(0)
    }),
  ),
)

// ============================================================================
// Auth errors (401/403) are not transport errors either — they belong to the
// OAuth flow. Must surface without touching the reconnect path.
// ============================================================================

test(
  "401 unauthorized is not a transport error → propagates, zero reconnect",
  withInstance({ "auth-err": { type: "remote", url: "https://example.com/mcp", oauth: false } }, (mcp) =>
    Effect.gen(function* () {
      lastCreatedClientName = "auth-err"
      callToolBehaviors.set("auth-err", {
        throwQueue: [new StubStreamableHTTPError(401, "unauthorized")],
        invocations: 0,
        successResult: undefined,
      })

      yield* mcp.add("auth-err", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
      })

      const baseline = clientCreateCount
      const tools = yield* mcp.tools()
      const outcome = yield* Effect.promise(() =>
        execTool(tools)
          .then(() => ({ ok: true as const }))
          .catch((err: Error) => ({ ok: false as const, message: err.message })),
      )

      expect(outcome.ok).toBe(false)
      if (!outcome.ok) expect(outcome.message).toMatch(/unauthorized/i)
      expect(callToolBehaviors.get("auth-err")!.invocations).toBe(1)
      expect(clientCreateCount - baseline).toBe(0)
    }),
  ),
)
