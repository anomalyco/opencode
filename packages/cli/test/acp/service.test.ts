import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode-ai/client/promise"
import { ACPService } from "../../src/acp/service"
import { ChildSessionUpdatesCapability } from "../../src/acp/event"

describe("acp service", () => {
  test("creates a v2 session, registers mcp, and publishes commands", async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = []
    const updates: Parameters<AgentSideConnection["sessionUpdate"]>[0][] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({
          method: request.method,
          path: url.pathname,
          body: request.method === "GET" ? undefined : await request.json().catch(() => undefined),
        })
        const location = { directory: "/workspace", project: { id: "global", directory: "/workspace" } }
        if (url.pathname === "/api/plugin/await-activation") return new Response(null, { status: 204 })
        if (url.pathname === "/api/model") return Response.json({ location, data: [model] })
        if (url.pathname === "/api/model/default") return Response.json({ location, data: model })
        if (url.pathname === "/api/agent") return Response.json({ location, data: [agent] })
        if (url.pathname === "/api/command")
          return Response.json({ location, data: [{ name: "review", template: "" }] })
        if (url.pathname === "/api/skill") return Response.json({ location, data: [skill] })
        if (url.pathname === "/api/preferences") return Response.json([])
        if (url.pathname === "/api/event")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('data: {"id":"evt_connected","type":"server.connected","data":{}}\n\n'),
                )
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          )
        if (url.pathname === "/api/session" && request.method === "POST") return Response.json({ data: session })
        if (url.pathname === "/api/mcp/docs" && request.method === "PUT") return new Response(null, { status: 204 })
        return new Response(null, { status: 404 })
      },
    })
    const service = ACPService.make({
      client: OpenCode.make({ baseUrl: server.url.toString() }),
      connection: {
        sessionUpdate: async (update) => {
          updates.push(update)
        },
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      },
    })

    try {
      const initialized = await service.initialize({
        protocolVersion: 1,
        clientCapabilities: { _meta: { [ChildSessionUpdatesCapability]: true } },
        clientInfo: { name: "test", version: "1" },
      })
      const result = await service.newSession({
        cwd: "/workspace",
        mcpServers: [{ name: "docs", command: "bun", args: ["docs.ts"], env: [{ name: "TOKEN", value: "x" }] }],
      })
      expect(result.sessionId).toBe("ses_acp")
      expect(initialized.agentCapabilities?._meta).toEqual({ [ChildSessionUpdatesCapability]: true })
      expect(result.configOptions?.map((option) => option.id)).toEqual(["model", "effort", "mode"])
      expect(requests).toContainEqual({
        method: "PUT",
        path: "/api/mcp/docs",
        body: {
          config: { type: "local", command: ["bun", "docs.ts"], environment: { TOKEN: "x" } },
        },
      })
      expect(updates.at(-1)).toMatchObject({
        sessionId: "ses_acp",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "review" }, { name: "verify", description: "Verify work" }],
        },
      })
    } finally {
      await server.stop(true)
    }
  })
})

const model = {
  id: "test-model",
  modelID: "test-model",
  providerID: "test",
  name: "Test Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "default" }, { id: "high" }],
  time: { released: 0 },
  cost: [],
  status: "active" as const,
  enabled: true,
  limit: { context: 100_000, output: 10_000 },
}

const agent = {
  id: "build",
  name: "Build",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary" as const,
  hidden: false,
  permissions: [],
}

const skill = {
  id: "verify",
  name: "verify",
  description: "Verify work",
  slash: true,
  location: "/skills/verify.md",
  content: "verify",
}

const session = {
  id: "ses_acp",
  projectID: "global",
  agent: "build",
  model: { providerID: "test", id: "test-model", variant: "default" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
  title: "New session",
  location: { directory: "/workspace" },
}
