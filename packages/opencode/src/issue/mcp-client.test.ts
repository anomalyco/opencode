import { describe, expect, afterAll } from "bun:test"
import { Effect, Exit } from "effect"
import { LinearMcpClient } from "./mcp-client"
import { it } from "../../test/lib/effect"

const MOCK_TOOLS = [
  {
    name: "get_issue",
    description: "Retrieve detailed information about an issue by ID",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "list_issues",
    description: "List issues in the user's Linear workspace",
    inputSchema: {
      type: "object" as const,
      properties: { team: { type: "string" } },
    },
  },
  {
    name: "save_issue",
    description: "Create or update a Linear issue",
    inputSchema: {
      type: "object" as const,
      properties: { title: { type: "string" }, team: { type: "string" } },
    },
  },
]

function json(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", result, id })
}

function jsonErr(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id })
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const { method, id, params } = body as {
      method: string
      id: unknown
      params?: Record<string, unknown>
    }

    if (method === "initialize") {
      return json(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "linear-test", version: "1.0.0" },
      })
    }

    if (id === undefined || id === null) {
      return new Response(null, { status: 204 })
    }

    if (method === "tools/list") {
      return json(id, { tools: MOCK_TOOLS })
    }

    if (method === "tools/call") {
      const p = (params as Record<string, unknown> | undefined) ?? {}

      if (p.name === "bad_tool") {
        return jsonErr(id, -32602, "Tool not found: bad_tool")
      }

      if (p.name === "faulty") {
        return new Response("not json", { status: 500 })
      }

      return json(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, name: p.name, args: p.arguments }),
          },
        ],
        isError: false,
      })
    }

    return jsonErr(id, -32601, `Method not found: ${method}`)
  },
})

afterAll(() => {
  server.stop(true)
})

const base = () => `http://127.0.0.1:${server.port}/mcp`

describe("LinearMcpClient", () => {
  it.live(
    "create() connects and returns a ready client",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        const state = yield* client.status()
        expect(state).toBe("connected")
        yield* client.close()
      }),
    { timeout: 30_000 },
  )

  it.live(
    "listTools() returns tool definitions from server",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        const tools = yield* client.listTools()
        yield* client.close()
        expect(tools.length).toBe(3)
        expect(tools[0]!.name).toBe("get_issue")
        expect(tools[1]!.name).toBe("list_issues")
        expect(tools[2]!.name).toBe("save_issue")
      }),
    { timeout: 30_000 },
  )

  it.live(
    "callTool() invokes a tool and returns result",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        const result = yield* client.callTool("get_issue", { id: "ISS-1" })
        yield* client.close()
        const content = (result as { content: Array<{ type: string; text: string }> }).content
        expect(content.length).toBeGreaterThan(0)
        expect(JSON.parse(content[0]!.text).name).toBe("get_issue")
      }),
    { timeout: 30_000 },
  )

  it.live(
    "callTool() fails for unknown tool",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        const exit = yield* client.callTool("bad_tool", {}).pipe(Effect.exit)
        yield* client.close()
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "close() disconnects and status() returns disconnected",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        yield* client.close()
        expect(yield* client.status()).toBe("disconnected")
      }),
    { timeout: 30_000 },
  )

  it.live(
    "listTools() fails after close()",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        yield* client.close()
        const exit = yield* client.listTools().pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "callTool() fails after close()",
    () =>
      Effect.gen(function* () {
        const client = yield* LinearMcpClient.create({ url: base(), key: "test-key" })
        yield* client.close()
        const exit = yield* client.callTool("get_issue", { id: "1" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "create() fails with bad URL",
    () =>
      Effect.gen(function* () {
        const exit = yield* LinearMcpClient.create({
          url: "http://127.0.0.1:19999/nope",
          key: "test-key",
        }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { timeout: 30_000 },
  )

  it.live(
    "create() fails without API key",
    () =>
      Effect.gen(function* () {
        const exit = yield* LinearMcpClient.create({ url: base(), key: "" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    { timeout: 30_000 },
  )
})
