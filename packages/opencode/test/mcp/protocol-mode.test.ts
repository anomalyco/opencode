import { expect, mock, beforeEach, afterAll } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import * as RealMcpClient from "@modelcontextprotocol/client"

// Captures what the real v2 Client actually receives, so these tests assert
// against the real contract (ClientOptions.versionNegotiation, ConnectOptions.prior)
// rather than against this file's own assumptions about it.
const clientConstructions: Array<{ options: unknown }> = []
const connectCalls: Array<{ options: unknown }> = []

class MockStdioTransport {
  constructor(_opts: unknown) {}
  async start() {}
  async close() {}
}

class MockClient {
  constructor(_info: unknown, options: unknown) {
    clientConstructions.push({ options })
  }
  setRequestHandler() {}
  setNotificationHandler() {}
  async connect(_transport: unknown, options?: unknown) {
    connectCalls.push({ options })
  }
  getServerCapabilities() {
    return { tools: {} }
  }
  getDiscoverResult() {
    return undefined
  }
  getNegotiatedProtocolVersion() {
    return undefined
  }
  async listTools() {
    return { tools: [] }
  }
  async close() {}
}

// fork(mcp-dual-era-client B1/B2): consolidated mock, see headers.test.ts's
// comment for why v2's single-package export requires this over v1's
// per-subpath mocking.
await mock.module("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: MockStdioTransport,
}))

await mock.module("@modelcontextprotocol/client", () => ({
  ...RealMcpClient,
  Client: MockClient,
}))

beforeEach(() => {
  clientConstructions.length = 0
  connectCalls.length = 0
})

// fork(mcp-dual-era-client D2): mock.module() mutates the module registry
// for the rest of the bun:test process — without restoring it here, any
// later-running file (alphabetically after this one) that needs the REAL
// @modelcontextprotocol/client would silently get this file's mock instead.
afterAll(() => {
  mock.restore()
})

const { MCP } = await import("../../src/mcp/index")
const it = testEffect(MCP.defaultLayer)

const localConfig = (name: string, protocolMode?: "legacy" | "auto" | "modern") => ({
  mcp: {
    [name]: {
      type: "local" as const,
      command: ["echo", "test"],
      ...(protocolMode ? { protocolMode } : {}),
    },
  },
})

it.instance(
  "defaults to auto when nothing is configured",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"] })
        expect(clientConstructions.at(-1)?.options).toMatchObject({ versionNegotiation: { mode: "auto" } })
      }),
    ),
  { config: localConfig("srv") },
)

it.instance(
  "per-server protocolMode: legacy",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"], protocolMode: "legacy" })
        expect(clientConstructions.at(-1)?.options).toMatchObject({ versionNegotiation: { mode: "legacy" } })
      }),
    ),
  { config: localConfig("srv", "legacy") },
)

it.instance(
  "per-server protocolMode: modern pins the latest protocol revision",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"], protocolMode: "modern" })
        const options = clientConstructions.at(-1)?.options as { versionNegotiation?: { mode?: unknown } }
        expect(options.versionNegotiation?.mode).toEqual({ pin: RealMcpClient.LATEST_PROTOCOL_VERSION })
      }),
    ),
  { config: localConfig("srv", "modern") },
)

it.instance(
  "falls back to experimental.mcp_protocol_mode when the server sets nothing",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"] })
        expect(clientConstructions.at(-1)?.options).toMatchObject({ versionNegotiation: { mode: "legacy" } })
      }),
    ),
  { config: { ...localConfig("srv"), experimental: { mcp_protocol_mode: "legacy" } } },
)

it.instance(
  "a per-server protocolMode overrides the experimental global default",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"], protocolMode: "auto" })
        expect(clientConstructions.at(-1)?.options).toMatchObject({ versionNegotiation: { mode: "auto" } })
      }),
    ),
  { config: { ...localConfig("srv", "auto"), experimental: { mcp_protocol_mode: "legacy" } } },
)

it.instance(
  "reconnecting a server adopts the cached PriorDiscovery instead of renegotiating",
  () =>
    MCP.Service.use((mcp) =>
      Effect.gen(function* () {
        yield* mcp.add("srv", { type: "local", command: ["echo", "test"] })
        expect(connectCalls[0]?.options).toBeUndefined()

        yield* mcp.disconnect("srv")
        yield* mcp.connect("srv")

        // MockClient.getDiscoverResult() returns undefined -> legacy era cached
        expect(connectCalls[1]?.options).toEqual({ prior: { kind: "legacy" } })
      }),
    ),
  { config: localConfig("srv") },
)
