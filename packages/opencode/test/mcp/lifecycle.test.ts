import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, mock, beforeEach } from "bun:test"
import { ListRootsRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

// --- Mock infrastructure ---

// Per-client state for controlling mock behavior
interface MockClientState {
  capabilities: { tools?: object; prompts?: object; resources?: object }
  capabilitiesShouldThrow: boolean
  instructions?: string
  tools: Array<{ name: string; description?: string; inputSchema: object; outputSchema?: object }>
  listToolsCalls: number
  listPromptsCalls: number
  listResourcesCalls: number
  listResourceTemplatesCalls: number
  getPromptTimeout?: number
  readResourceTimeout?: number
  requestCalls: number
  listToolsShouldFail: boolean
  listToolsError: string
  listPromptsShouldFail: boolean
  listResourcesShouldFail: boolean
  prompts: Array<{ name: string; description?: string }>
  resources: Array<{ name: string; uri: string; description?: string }>
  resourceTemplates: Array<{ name: string; uriTemplate: string; description?: string }>
  toolPages: Record<
    string,
    {
      tools: Array<{ name: string; description?: string; inputSchema: object; outputSchema?: object }>
      nextCursor?: string
    }
  >
  promptPages: Record<string, { prompts: Array<{ name: string; description?: string }>; nextCursor?: string }>
  resourcePages: Record<
    string,
    { resources: Array<{ name: string; uri: string; description?: string }>; nextCursor?: string }
  >
  resourceTemplatePages: Record<
    string,
    { resourceTemplates: Array<{ name: string; uriTemplate: string; description?: string }>; nextCursor?: string }
  >
  closed: boolean
  clientOptions?: { capabilities?: { roots?: { listChanged?: boolean } } }
  requestHandlers: Map<unknown, (...args: any[]) => Promise<any>>
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
// Captures the opts passed to each MockStdioTransport, keyed by lastCreatedClientName
const stdioOptsByName = new Map<string, any>()

function getOrCreateClientState(name?: string): MockClientState {
  const key = name ?? "default"
  let state = clientStates.get(key)
  if (!state) {
    state = {
      capabilities: { tools: {}, prompts: {}, resources: {} },
      capabilitiesShouldThrow: false,
      tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
      listToolsCalls: 0,
      listPromptsCalls: 0,
      listResourcesCalls: 0,
      listResourceTemplatesCalls: 0,
      requestCalls: 0,
      listToolsShouldFail: false,
      listToolsError: "listTools failed",
      listPromptsShouldFail: false,
      listResourcesShouldFail: false,
      prompts: [],
      resources: [],
      resourceTemplates: [],
      toolPages: {},
      promptPages: {},
      resourcePages: {},
      resourceTemplatePages: {},
      closed: false,
      requestHandlers: new Map(),
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
  constructor(opts: any) {
    if (lastCreatedClientName) stdioOptsByName.set(lastCreatedClientName, opts)
  }
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

    constructor(_info: any, options?: MockClientState["clientOptions"]) {
      clientCreateCount++
      this._state = getOrCreateClientState(lastCreatedClientName)
      this._state.clientOptions = options
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      // After successful connect, bind to the last-created client name
      this._state = getOrCreateClientState(lastCreatedClientName)
    }

    setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) {
      this._state.requestHandlers.set(schema, handler)
    }

    setNotificationHandler(schema: unknown, handler: (...args: any[]) => any) {
      this._state?.notificationHandlers.set(schema, handler)
    }

    getServerCapabilities() {
      if (this._state?.capabilitiesShouldThrow) throw new Error("capability discovery failed")
      return this._state?.capabilities
    }

    getInstructions() {
      return this._state?.instructions
    }

    async listTools(params?: { cursor?: string }) {
      if (this._state) this._state.listToolsCalls++
      if (this._state?.listToolsShouldFail) {
        throw new Error(this._state.listToolsError)
      }
      const page = this._state?.toolPages[params === undefined ? "initial" : (params.cursor ?? "")]
      if (page) return page
      return { tools: this._state?.tools ?? [] }
    }

    async request(
      request: { method: string; params?: { cursor?: string } },
      schema: { parse: (value: unknown) => unknown },
    ) {
      if (this._state) this._state.requestCalls++
      if (request.method === "tools/list") {
        return schema.parse(
          this._state?.toolPages[request.params === undefined ? "initial" : (request.params.cursor ?? "")] ?? {
            tools: this._state?.tools ?? [],
          },
        )
      }
      throw new Error(`unsupported request: ${request.method}`)
    }

    async listPrompts(params?: { cursor?: string }) {
      if (this._state) this._state.listPromptsCalls++
      if (this._state?.listPromptsShouldFail) {
        throw new Error("listPrompts failed")
      }
      const page = this._state?.promptPages[params === undefined ? "initial" : (params.cursor ?? "")]
      if (page) return page
      return { prompts: this._state?.prompts ?? [] }
    }

    async listResources(params?: { cursor?: string }) {
      if (this._state) this._state.listResourcesCalls++
      if (this._state?.listResourcesShouldFail) {
        throw new Error("listResources failed")
      }
      const page = this._state?.resourcePages[params === undefined ? "initial" : (params.cursor ?? "")]
      if (page) return page
      return { resources: this._state?.resources ?? [] }
    }

    async listResourceTemplates(params?: { cursor?: string }) {
      if (this._state) this._state.listResourceTemplatesCalls++
      const page = this._state?.resourceTemplatePages[params === undefined ? "initial" : (params.cursor ?? "")]
      if (page) return page
      return { resourceTemplates: this._state?.resourceTemplates ?? [] }
    }

    async getPrompt(_params: unknown, options?: { timeout?: number }) {
      if (this._state) this._state.getPromptTimeout = options?.timeout
      return { messages: [] }
    }

    async readResource(params: { uri: string }, options?: { timeout?: number }) {
      if (this._state) this._state.readResourceTimeout = options?.timeout
      return { contents: [{ uri: params.uri, text: "test" }] }
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

const it = testEffect(LayerNode.compile(MCP.node))

function statusName(status: Record<string, MCPNS.Status> | MCPNS.Status, server: string) {
  if ("status" in status) return status.status
  return status[server]?.status
}

it.instance(
  "advertises and lists the instance directory as its root",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        lastCreatedClientName = "roots"
        yield* mcp.add("roots", { type: "local", command: ["echo", "test"] })

        const state = getOrCreateClientState("roots")
        expect(state.clientOptions?.capabilities?.roots).toEqual({})
        expect(state.clientOptions?.capabilities?.roots?.listChanged).toBeUndefined()

        const handler = state.requestHandlers.get(ListRootsRequestSchema)
        expect(handler).toBeDefined()
        const result = yield* Effect.promise(() => handler?.() ?? Promise.reject(new Error("roots handler missing")))
        expect(result).toEqual({ roots: [{ uri: pathToFileURL(directory).href }] })
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "local mcp cwd resolves relative paths against instance directory",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        lastCreatedClientName = "rel-cwd"
        yield* mcp.add("rel-cwd", { type: "local", command: ["echo", "test"], cwd: "plugins/sub" })
        expect(stdioOptsByName.get("rel-cwd")?.cwd).toBe(path.resolve(directory, "plugins/sub"))
      }),
    ),
  { config: { mcp: {} } },
)

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

it.instance(
  "instructions() returns connected server instructions with tool names",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "guide-server"
        const serverState = getOrCreateClientState("guide-server")
        serverState.instructions = "Use lookup before mutate."

        yield* mcp.add("guide-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(yield* mcp.instructions()).toContainEqual({
          name: "guide-server",
          instructions: "Use lookup before mutate.",
          tools: ["guide-server_test_tool"],
        })
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "instructions() omits empty and disconnected server instructions",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "temporary-server"
        getOrCreateClientState("temporary-server").instructions = "Temporary guidance."

        yield* mcp.add("temporary-server", {
          type: "local",
          command: ["echo", "test"],
        })
        yield* mcp.disconnect("temporary-server")

        lastCreatedClientName = "blank-server"
        getOrCreateClientState("blank-server").instructions = "   "

        yield* mcp.add("blank-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const instructions = yield* mcp.instructions()
        expect(instructions.some((item) => item.name === "temporary-server")).toBe(false)
        expect(instructions.some((item) => item.name === "blank-server")).toBe(false)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "follows cursors when listing tools, prompts, and resources",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "paged-server"
        const serverState = getOrCreateClientState("paged-server")
        serverState.toolPages = {
          initial: {
            tools: [{ name: "tool-one", inputSchema: { type: "object", properties: {} } }],
            nextCursor: "tools-2",
          },
          "tools-2": { tools: [{ name: "tool-two", inputSchema: { type: "object", properties: {} } }] },
        }
        serverState.promptPages = {
          initial: { prompts: [{ name: "prompt-one" }], nextCursor: "prompts-2" },
          "prompts-2": { prompts: [{ name: "prompt-two" }] },
        }
        serverState.resourcePages = {
          initial: { resources: [{ name: "resource-one", uri: "test://one" }], nextCursor: "resources-2" },
          "resources-2": { resources: [{ name: "resource-two", uri: "test://two" }] },
        }
        serverState.resourceTemplatePages = {
          initial: {
            resourceTemplates: [{ name: "template-one", uriTemplate: "test://one/{id}" }],
            nextCursor: "resource-templates-2",
          },
          "resource-templates-2": { resourceTemplates: [{ name: "template-two", uriTemplate: "test://two/{id}" }] },
        }

        yield* mcp.add("paged-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(Object.keys(yield* mcp.tools())).toEqual(["paged-server_tool-one", "paged-server_tool-two"])
        expect(Object.keys(yield* mcp.prompts())).toEqual(["paged-server:prompt-one", "paged-server:prompt-two"])
        expect(Object.keys(yield* mcp.resources())).toEqual(["paged-server:test://one", "paged-server:test://two"])
        expect(Object.keys(yield* mcp.resourceTemplates())).toEqual([
          "paged-server:test://one/{id}",
          "paged-server:test://two/{id}",
        ])
        expect(serverState.listToolsCalls).toBe(2)
        expect(serverState.listPromptsCalls).toBe(2)
        expect(serverState.listResourcesCalls).toBe(2)
        expect(serverState.listResourceTemplatesCalls).toBe(2)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "stops listing when a server repeats a cursor",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "looping-server"
        const serverState = getOrCreateClientState("looping-server")
        serverState.toolPages = {
          initial: { tools: [], nextCursor: "repeat" },
          repeat: { tools: [], nextCursor: "repeat" },
        }

        yield* mcp.add("looping-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(serverState.listToolsCalls).toBe(2)
        expect(yield* mcp.tools()).toEqual({})
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "follows empty cursors",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "empty-cursor-server"
        const serverState = getOrCreateClientState("empty-cursor-server")
        serverState.promptPages = {
          initial: { prompts: [{ name: "prompt-one" }], nextCursor: "" },
          "": { prompts: [{ name: "prompt-two" }] },
        }

        yield* mcp.add("empty-cursor-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(Object.keys(yield* mcp.prompts())).toEqual([
          "empty-cursor-server:prompt-one",
          "empty-cursor-server:prompt-two",
        ])
        expect(serverState.listPromptsCalls).toBe(2)
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

        const handler = serverState.notificationHandlers.get(ToolListChangedNotificationSchema)
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
  "returns failed and closes the client when SDK initialization throws",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "defective-server"
        const serverState = getOrCreateClientState("defective-server")
        serverState.capabilitiesShouldThrow = true

        const result = yield* mcp.add("defective-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(result.status, "defective-server")).toBe("failed")
        expect((yield* mcp.status())["defective-server"]).toEqual({
          status: "failed",
          error: "capability discovery failed",
        })
        expect(serverState.closed).toBe(true)
      }),
    ),
  { config: { mcp: {} } },
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
        serverState.resources = [
          { name: "my-resource", uri: "file:///test.txt", description: "A test resource" },
          { name: "my-resource", uri: "ui://component-state", description: "A second resource with same name" },
        ]

        yield* mcp.add("resource-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const resources = yield* mcp.resources()
        expect(Object.keys(resources)).toEqual([
          "resource-server:file:///test.txt",
          "resource-server:ui://component-state",
        ])
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
  "uses per-server timeouts for prompt and resource requests",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "timeout-server"
        const serverState = getOrCreateClientState("timeout-server")

        yield* mcp.add("timeout-server", {
          type: "local",
          command: ["echo", "test"],
          timeout: 2500,
        })
        yield* mcp.getPrompt("timeout-server", "test")
        yield* mcp.readResource("timeout-server", "test://resource")

        expect(serverState.getPromptTimeout).toBe(2500)
        expect(serverState.readResourceTimeout).toBe(2500)
      }),
    ),
  { config: { mcp: {}, experimental: { mcp_timeout: 5000 } } },
)

it.instance(
  "resource-only servers connect without listing tools",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "resource-only-server"
        const serverState = getOrCreateClientState("resource-only-server")
        serverState.capabilities = { resources: {} }
        serverState.resources = [{ name: "docs", uri: "docs://readme" }]

        const result = yield* mcp.add("resource-only-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(result.status, "resource-only-server")).toBe("connected")
        expect(serverState.listToolsCalls).toBe(0)
        expect(Object.keys(yield* mcp.tools())).toHaveLength(0)
        expect(Object.keys(yield* mcp.resources())).toEqual(["resource-only-server:docs://readme"])
        expect(serverState.listResourcesCalls).toBe(1)
        expect(serverState.listPromptsCalls).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "prompt-only servers connect without listing tools",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-only-server"
        const serverState = getOrCreateClientState("prompt-only-server")
        serverState.capabilities = { prompts: {} }
        serverState.prompts = [{ name: "review" }]

        const result = yield* mcp.add("prompt-only-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(result.status, "prompt-only-server")).toBe("connected")
        expect(serverState.listToolsCalls).toBe(0)
        expect(Object.keys(yield* mcp.tools())).toHaveLength(0)
        expect(Object.keys(yield* mcp.prompts())).toEqual(["prompt-only-server:review"])
        expect(serverState.listPromptsCalls).toBe(1)
        expect(serverState.listResourcesCalls).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "tools-only servers skip optional prompt and resource discovery",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "tools-only-server"
        const serverState = getOrCreateClientState("tools-only-server")
        serverState.capabilities = { tools: {} }

        const result = yield* mcp.add("tools-only-server", {
          type: "local",
          command: ["echo", "test"],
        })

        expect(statusName(result.status, "tools-only-server")).toBe("connected")
        expect(serverState.listToolsCalls).toBe(1)
        expect(Object.keys(yield* mcp.tools())).toEqual(["tools-only-server_test_tool"])
        expect(yield* mcp.prompts()).toEqual({})
        expect(yield* mcp.resources()).toEqual({})
        expect(serverState.listPromptsCalls).toBe(0)
        expect(serverState.listResourcesCalls).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
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
  "connect() on nonexistent server fails with NotFoundError",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const exit = yield* mcp.connect("nonexistent").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "MCP.NotFoundError", name: "nonexistent" })
        }
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
  "disconnect() on nonexistent server fails with NotFoundError",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const exit = yield* mcp.disconnect("nonexistent").pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "MCP.NotFoundError", name: "nonexistent" })
        }
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
