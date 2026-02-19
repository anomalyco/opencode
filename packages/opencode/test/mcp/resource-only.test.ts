import { test, expect, mock, beforeEach } from "bun:test"

// Track created clients to inspect status after connection
let lastServerCapabilities: Record<string, unknown> = {}

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdio {
    stderr = null
    async start() {}
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    #capabilities: Record<string, unknown>

    constructor() {
      this.#capabilities = lastServerCapabilities
    }

    async connect() {}
    async close() {}

    getServerCapabilities() {
      return this.#capabilities
    }

    setNotificationHandler() {}
  },
}))

beforeEach(() => {
  lastServerCapabilities = {}
})

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

async function addAndGetStatus(name: string, command: string[]) {
  const result = await MCP.add(name, { type: "local", command })
  const status = result.status as Record<string, { status: string }> | undefined
  return status?.[name]?.status
}

test("resource-only server connects successfully", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      lastServerCapabilities = { resources: {} }
      expect(await addAndGetStatus("resource-server", ["echo"])).toBe("connected")
    },
  })
})

test("server with no capabilities connects successfully", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      lastServerCapabilities = {}
      expect(await addAndGetStatus("empty-server", ["echo"])).toBe("connected")
    },
  })
})

test("server with tools and resources connects successfully", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      lastServerCapabilities = { tools: {}, resources: {} }
      expect(await addAndGetStatus("full-server", ["echo"])).toBe("connected")
    },
  })
})
