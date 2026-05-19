import { expect, mock, beforeEach } from "bun:test"
import { Effect, Exit } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

// --- Mock infrastructure ---

// Per-client state for controlling mock behavior
interface MockClientState {
  tools: Array<{ name: string; description?: string; inputSchema: object; outputSchema?: object }>
  listToolsCalls: number
  requestCalls: number
  listToolsShouldFail: boolean
  listToolsError: string
  listPromptsShouldFail: boolean
  listResourcesShouldFail: boolean
  prompts: Array<{ name: string; description?: string }>
  resources: Array<{ name: string; uri: string; description?: string }>
  closed: boolean
  notificationHandlers: Map<unknown, (...args: any[]) => any>
}

const clientStates = new Map<string, MockClientState>()
let lastCreatedClientName: string | undefined
let connectShouldFail = false
let connectShouldHang = false
let connectError = "Mock transport cannot connect"
// Tracks how many Client instances were created (detects leaks)
let clientCreateCount = 0
// Tracks how many times transport.close() is called across all mock transports
let transportCloseCount = 0

function getOrCreateClientState(name?: string): MockClientState {
  const key = name ?? "default"
  let state = clientStates.get(key)
  if (!state) {
    state = {
      tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
      listToolsCalls: 0,
      requestCalls: 0,
      listToolsShouldFail: false,
      listToolsError: "listTools failed",
      listPromptsShouldFail: false,
      listResourcesShouldFail: false,
      prompts: [],
      resources: [],
      closed: false,
      notificationHandlers: new Map(),
    }
    clientStates.set(key, state)
  }
  return state
}

// Mock transport that succeeds or fails based on connectShouldFail / connectShouldHang
class MockStdioTransport {
  stderr: null = null
  pid = 12345
  // oxlint-disable-next-line no-useless-constructor
  constructor(_opts: any) {}
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
}

class MockStreamableHTTP {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url: URL, _opts?: any) {}
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
  async finishAuth() {}
}

class MockSSE {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url: URL, _opts?: any) {}
  async start() {
    if (connectShouldHang) return new Promise<void>(() => {}) // never resolves
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
}

void mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}))

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTP,
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSSE,
}))

void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {
    constructor() {
      super("Unauthorized")
    }
  },
}))

// Mock Client that delegates to per-name MockClientState
void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    _state!: MockClientState
    transport: any

    constructor(_opts: any) {
      clientCreateCount++
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      // After successful connect, bind to the last-created client name
      this._state = getOrCreateClientState(lastCreatedClientName)
    }

    setNotificationHandler(schema: unknown, handler: (...args: any[]) => any) {
      this._state?.notificationHandlers.set(schema, handler)
    }

    async listTools() {
      if (this._state) this._state.listToolsCalls++
      if (this._state?.listToolsShouldFail) {
        throw new Error(this._state.listToolsError)
      }
      return { tools: this._state?.tools ?? [] }
    }

    async request(request: { method: string }, schema: { parse: (value: unknown) => unknown }) {
      if (this._state) this._state.requestCalls++
      if (request.method === "tools/list") return schema.parse({ tools: this._state?.tools ?? [] })
      throw new Error(`unsupported request: ${request.method}`)
    }

    async listPrompts() {
      if (this._state?.listPromptsShouldFail) {
        throw new Error("listPrompts failed")
      }
      return { prompts: this._state?.prompts ?? [] }
    }

    async listResources() {
      if (this._state?.listResourcesShouldFail) {
        throw new Error("listResources failed")
      }
      return { resources: this._state?.resources ?? [] }
    }

    async close() {
      if (this._state) this._state.closed = true
    }
  },
}))

beforeEach(() => {
  clientStates.clear()
  lastCreatedClientName = undefined
  connectShouldFail = false
  connectShouldHang = false
  connectError = "Mock transport cannot connect"
  clientCreateCount = 0
  transportCloseCount = 0
})

// Import after mocks
const { MCP } = await import("../../src/mcp/index")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")

const it = testEffect(MCP.defaultLayer)

function statusName(status: Record<string, MCPNS.Status> | MCPNS.Status, server: string) {
  if ("status" in status) return status.status
  return status[server]?.status
}

// ========================================================================
// Test: tools() are cached after connect
// ========================================================================

it.instance(
  "tools() reuses cached tool definitions after connect",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "my-server"
        const serverState = getOrCreateClientState("my-server")
        serverState.tools = [
          { name: "do_thing", description: "does a thing", inputSchema: { type: "object", properties: {} } },
        ]

        // First: add the server successfully
        const addResult = yield* mcp.add("my-server", {
          type: "local",
          command: ["echo", "test"],
        })
        expect((addResult.status as any)["my-server"]?.status ?? (addResult.status as any).status).toBe("connected")

        expect(serverState.listToolsCalls).toBe(1)

        const toolsA = yield* mcp.tools()
        const toolsB = yield* mcp.tools()
        expect(Object.keys(toolsA).length).toBeGreaterThan(0)
        expect(Object.keys(toolsB).length).toBeGreaterThan(0)
        expect(serverState.listToolsCalls).toBe(1)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: tool change notifications refresh the cache
// ========================================================================

it.instance(
  "tool change notifications refresh cached tool definitions",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "status-server"
        const serverState = getOrCreateClientState("status-server")

        yield* mcp.add("status-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const before = yield* mcp.tools()
        expect(Object.keys(before).some((key) => key.includes("test_tool"))).toBe(true)
        expect(serverState.listToolsCalls).toBe(1)

        serverState.tools = [
          { name: "next_tool", description: "next", inputSchema: { type: "object", properties: {} } },
        ]

        const handler = Array.from(serverState.notificationHandlers.values())[0]
        expect(handler).toBeDefined()
        yield* Effect.promise(() => handler?.())

        const after = yield* mcp.tools()
        expect(Object.keys(after).some((key) => key.includes("next_tool"))).toBe(true)
        expect(Object.keys(after).some((key) => key.includes("test_tool"))).toBe(false)
        expect(serverState.listToolsCalls).toBe(2)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: connect() / disconnect() lifecycle
// ========================================================================

it.instance(
  "disconnect sets status to disabled and removes client",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "disc-server"
        getOrCreateClientState("disc-server")

        yield* mcp.add("disc-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const statusBefore = yield* mcp.status()
        expect(statusBefore["disc-server"]?.status).toBe("connected")

        yield* mcp.disconnect("disc-server")

        const statusAfter = yield* mcp.status()
        expect(statusAfter["disc-server"]?.status).toBe("disabled")

        const tools = yield* mcp.tools()
        const serverTools = Object.keys(tools).filter((k) => k.startsWith("disc-server"))
        expect(serverTools.length).toBe(0)
      }),
    ),
  {
    config: {
      mcp: {
        "disc-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

it.instance(
  "connect() after disconnect() re-establishes the server",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "reconn-server"
        const serverState = getOrCreateClientState("reconn-server")
        serverState.tools = [
          { name: "my_tool", description: "a tool", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("reconn-server", {
          type: "local",
          command: ["echo", "test"],
        })

        yield* mcp.disconnect("reconn-server")
        expect((yield* mcp.status())["reconn-server"]?.status).toBe("disabled")

        yield* mcp.connect("reconn-server")
        expect((yield* mcp.status())["reconn-server"]?.status).toBe("connected")

        const tools = yield* mcp.tools()
        expect(Object.keys(tools).some((k) => k.includes("my_tool"))).toBe(true)
      }),
    ),
  {
    config: {
      mcp: {
        "reconn-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// Test: add() closes existing client before replacing
// ========================================================================

it.instance(
  "add() closes the old client when replacing a server",
  // Don't put the server in config — add it dynamically so we control
  // exactly which client instance is "first" vs "second".
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "replace-server"
        const firstState = getOrCreateClientState("replace-server")

        yield* mcp.add("replace-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(firstState.closed).toBe(false)

        // Create new state for second client
        clientStates.delete("replace-server")
        const secondState = getOrCreateClientState("replace-server")

        // Re-add should close the first client
        yield* mcp.add("replace-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(firstState.closed).toBe(true)
        expect(secondState.closed).toBe(false)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: state init with mixed success/failure
// ========================================================================

it.instance(
  "init connects available servers even when one fails",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        // Set up good server
        const goodState = getOrCreateClientState("good-server")
        goodState.tools = [{ name: "good_tool", description: "works", inputSchema: { type: "object", properties: {} } }]

        // Set up bad server - will fail on listTools during create()
        const badState = getOrCreateClientState("bad-server")
        badState.listToolsShouldFail = true

        // Add good server first
        lastCreatedClientName = "good-server"
        yield* mcp.add("good-server", {
          type: "local",
          command: ["echo", "good"],
        })

        // Add bad server - should fail but not affect good server
        lastCreatedClientName = "bad-server"
        yield* mcp.add("bad-server", {
          type: "local",
          command: ["echo", "bad"],
        })

        const status = yield* mcp.status()
        expect(status["good-server"]?.status).toBe("connected")
        expect(status["bad-server"]?.status).toBe("failed")

        // Good server's tools should still be available
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).some((k) => k.includes("good_tool"))).toBe(true)
      }),
    ),
  {
    config: {
      mcp: {
        "good-server": {
          type: "local",
          command: ["echo", "good"],
        },
        "bad-server": {
          type: "local",
          command: ["echo", "bad"],
        },
      },
    },
  },
)

it.instance(
  "falls back when MCP output schema refs fail SDK tool discovery",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "stitch-like-server"
        const serverState = getOrCreateClientState("stitch-like-server")
        serverState.listToolsShouldFail = true
        serverState.listToolsError = "can't resolve reference #/$defs/ScreenInstance from id #"
        serverState.tools = [
          {
            name: "render_screen",
            description: "renders a screen",
            inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
            outputSchema: { type: "object", properties: { screen: { $ref: "#/$defs/ScreenInstance" } } },
          },
        ]

        const addResult = yield* mcp.add("stitch-like-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(addResult.status, "stitch-like-server")).toBe("connected")

        const tools = yield* mcp.tools()
        expect(Object.keys(tools).some((key) => key.includes("render_screen"))).toBe(true)
        expect(serverState.listToolsCalls).toBe(1)
        expect(serverState.requestCalls).toBe(1)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "does not fall back for non-schema MCP tool discovery errors",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "broken-server"
        const serverState = getOrCreateClientState("broken-server")
        serverState.listToolsShouldFail = true
        serverState.listToolsError = "transport closed"

        const addResult = yield* mcp.add("broken-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(addResult.status, "broken-server")).toBe("failed")
        expect(serverState.listToolsCalls).toBe(1)
        expect(serverState.requestCalls).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: disabled server via config
// ========================================================================

it.instance(
  "disabled server is marked as disabled without attempting connection",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const countBefore = clientCreateCount

        yield* mcp.add("disabled-server", {
          type: "local",
          command: ["echo", "test"],
          enabled: false,
        } as any)

        // No client should have been created
        expect(clientCreateCount).toBe(countBefore)

        const status = yield* mcp.status()
        expect(status["disabled-server"]?.status).toBe("disabled")
      }),
    ),
  {
    config: {
      mcp: {
        "disabled-server": {
          type: "local",
          command: ["echo", "test"],
          enabled: false,
        },
      },
    },
  },
)

// ========================================================================
// Test: prompts() and resources()
// ========================================================================

it.instance(
  "prompts() returns prompts from connected servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-server"
        const serverState = getOrCreateClientState("prompt-server")
        serverState.prompts = [{ name: "my-prompt", description: "A test prompt" }]

        yield* mcp.add("prompt-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const prompts = yield* mcp.prompts()
        expect(Object.keys(prompts).length).toBe(1)
        const key = Object.keys(prompts)[0]
        expect(key).toContain("prompt-server")
        expect(key).toContain("my-prompt")
      }),
    ),
  {
    config: {
      mcp: {
        "prompt-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

it.instance(
  "resources() returns resources from connected servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "resource-server"
        const serverState = getOrCreateClientState("resource-server")
        serverState.resources = [{ name: "my-resource", uri: "file:///test.txt", description: "A test resource" }]

        yield* mcp.add("resource-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const resources = yield* mcp.resources()
        expect(Object.keys(resources).length).toBe(1)
        const key = Object.keys(resources)[0]
        expect(key).toContain("resource-server")
        expect(key).toContain("my-resource")
      }),
    ),
  {
    config: {
      mcp: {
        "resource-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

it.instance(
  "prompts() skips disconnected servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-disc-server"
        const serverState = getOrCreateClientState("prompt-disc-server")
        serverState.prompts = [{ name: "hidden-prompt", description: "Should not appear" }]

        yield* mcp.add("prompt-disc-server", {
          type: "local",
          command: ["echo", "test"],
        })

        yield* mcp.disconnect("prompt-disc-server")

        const prompts = yield* mcp.prompts()
        expect(Object.keys(prompts).length).toBe(0)
      }),
    ),
  {
    config: {
      mcp: {
        "prompt-disc-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// Test: connect() on nonexistent server
// ========================================================================

it.instance(
  "connect() on nonexistent server does not throw",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        // Should not throw
        yield* mcp.connect("nonexistent")
        const status = yield* mcp.status()
        expect(status["nonexistent"]).toBeUndefined()
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: disconnect() on nonexistent server
// ========================================================================

it.instance(
  "disconnect() on nonexistent server does not throw",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        yield* mcp.disconnect("nonexistent")
        // Should complete without error
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: tools() with no MCP servers configured
// ========================================================================

it.instance(
  "tools() returns empty when no MCP servers are configured",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).length).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: connect failure during create()
// ========================================================================

it.instance(
  "server that fails to connect is marked as failed",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "fail-connect"
        getOrCreateClientState("fail-connect")
        connectShouldFail = true
        connectError = "Connection refused"

        yield* mcp.add("fail-connect", {
          type: "local",
          command: ["echo", "test"],
        })

        const status = yield* mcp.status()
        expect(status["fail-connect"]?.status).toBe("failed")
        if (status["fail-connect"]?.status === "failed") {
          expect(status["fail-connect"].error).toContain("Connection refused")
        }

        // No tools should be available
        const tools = yield* mcp.tools()
        expect(Object.keys(tools).length).toBe(0)
      }),
    ),
  {
    config: {
      mcp: {
        "fail-connect": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// Bug #5: McpOAuthCallback.cancelPending uses wrong key
// ========================================================================

it.live("McpOAuthCallback.cancelPending is keyed by mcpName but pendingAuths uses oauthState", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => McpOAuthCallback.waitForCallback("abc123hexstate", "my-mcp-server")),
    (callback) =>
      Effect.gen(function* () {
        McpOAuthCallback.cancelPending("my-mcp-server")

        const exit = yield* Effect.tryPromise({
          try: () => callback,
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting for OAuth cancellation")),
          }),
          Effect.exit,
        )

        expect(Exit.isFailure(exit)).toBe(true)
      }),
    () => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore),
  ),
)

// ========================================================================
// Test: multiple tools from same server get correct name prefixes
// ========================================================================

it.instance(
  "tools() prefixes tool names with sanitized server name",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "my.special-server"
        const serverState = getOrCreateClientState("my.special-server")
        serverState.tools = [
          { name: "tool-a", description: "Tool A", inputSchema: { type: "object", properties: {} } },
          { name: "tool.b", description: "Tool B", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("my.special-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const tools = yield* mcp.tools()
        const keys = Object.keys(tools)

        // Server name dots should be replaced with underscores
        expect(keys.some((k) => k.startsWith("my_special-server_"))).toBe(true)
        // Tool name dots should be replaced with underscores
        expect(keys.some((k) => k.endsWith("tool_b"))).toBe(true)
        expect(keys.length).toBe(2)
      }),
    ),
  {
    config: {
      mcp: {
        "my.special-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// Test: transport leak — local stdio timeout (#19168)
// ========================================================================

it.instance(
  "local stdio transport is closed when connect times out (no process leak)",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "hanging-server"
        getOrCreateClientState("hanging-server")
        connectShouldHang = true

        const addResult = yield* mcp.add("hanging-server", {
          type: "local",
          command: ["node", "fake.js"],
          timeout: 100,
        })

        const serverStatus = (addResult.status as any)["hanging-server"] ?? addResult.status
        expect(serverStatus.status).toBe("failed")
        expect(serverStatus.error).toContain("timed out")
        // Transport must be closed to avoid orphaned child process
        expect(transportCloseCount).toBeGreaterThanOrEqual(1)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: transport leak — remote timeout (#19168)
// ========================================================================

it.instance(
  "remote transport is closed when connect times out",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "hanging-remote"
        getOrCreateClientState("hanging-remote")
        connectShouldHang = true

        const addResult = yield* mcp.add("hanging-remote", {
          type: "remote",
          url: "http://localhost:9999/mcp",
          timeout: 100,
          oauth: false,
        })

        const serverStatus = (addResult.status as any)["hanging-remote"] ?? addResult.status
        expect(serverStatus.status).toBe("failed")
        // Transport must be closed to avoid leaked HTTP connections
        expect(transportCloseCount).toBeGreaterThanOrEqual(1)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Test: transport leak — failed remote transports not closed (#19168)
// ========================================================================

it.instance(
  "failed remote transport is closed before trying next transport",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "fail-remote"
        getOrCreateClientState("fail-remote")
        connectShouldFail = true
        connectError = "Connection refused"

        const addResult = yield* mcp.add("fail-remote", {
          type: "remote",
          url: "http://localhost:9999/mcp",
          timeout: 5000,
          oauth: false,
        })

        const serverStatus = (addResult.status as any)["fail-remote"] ?? addResult.status
        expect(serverStatus.status).toBe("failed")
        // Both StreamableHTTP and SSE transports should be closed
        expect(transportCloseCount).toBeGreaterThanOrEqual(2)
      }),
    ),
  { config: { mcp: {} } },
)
