import { test, expect, mock, beforeEach } from "bun:test"
import { Effect } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"

const transportCalls: Array<{ fetch?: unknown }> = []

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(_url: URL, options?: { fetch?: unknown }) {
      transportCalls.push({ fetch: options?.fetch })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    constructor(_url: URL, options?: { fetch?: unknown }) {
      transportCalls.push({ fetch: options?.fetch })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

beforeEach(() => {
  transportCalls.length = 0
})

const { MCP } = await import("../../src/mcp/index")
const { AppRuntime } = await import("../../src/effect/app-runtime")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const service = MCP.Service as unknown as Effect.Effect<MCPNS.Interface, never, never>

function addServer(name: string, insecure?: boolean) {
  return Effect.gen(function* () {
    const mcp = yield* service
    yield* mcp
      .add(name, { type: "remote", url: "https://example.com/mcp", oauth: false, insecure })
      .pipe(Effect.catch(() => Effect.void))
  })
}

test("insecure: true passes custom fetch to transports", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => AppRuntime.runPromise(addServer("insecure-server", true)),
  })

  expect(transportCalls.length).toBeGreaterThanOrEqual(1)
  for (const call of transportCalls) {
    expect(typeof call.fetch).toBe("function")
  }
})

test("insecure not set does not pass custom fetch", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: () => AppRuntime.runPromise(addServer("secure-server")),
  })

  expect(transportCalls.length).toBeGreaterThanOrEqual(1)
  for (const call of transportCalls) {
    expect(call.fetch).toBeUndefined()
  }
})
