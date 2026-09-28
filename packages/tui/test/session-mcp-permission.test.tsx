import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each(["hydrated", "live", "stale"])(
  "a Code Mode MCP request is visible and can be approved in the full TUI (%s)",
  async (mode) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const session = {
      id: "ses_test",
      title: "MCP permission",
      projectID: "proj_test",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const permission = {
      id: "per_mcp",
      sessionID: session.id,
      action: "local_echo",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      source: { type: "tool" as const, messageID: "msg_execute", id: "call_outer" },
    }
    const messages: SessionMessageInfo[] = [
      { id: "msg_user", type: "user", text: "Run local echo", time: { created: 0 } },
      {
        id: "msg_execute",
        type: "assistant",
        agent: "build",
        model: { providerID: "demo", id: "demo-model" },
        content: [
          {
            type: "tool",
            id: "call_outer",
            name: "execute",
            state: {
              status: "running",
              input: { code: "return await tools.local.echo({})" },
              metadata: { toolCalls: [{ tool: "local.echo", status: "running" }] },
            },
            time: { created: 1, ran: 1 },
          },
        ],
        time: { created: 1 },
      },
    ]
    const events = createEventStream()
    const listed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let reply: unknown
    const calls = createFetch(async (url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/session/ses_test") return json({ data: session })
      if (url.pathname === "/api/session/ses_test/message") return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === "/api/session/ses_test/inbox") return json({ data: [] })
      if (url.pathname === "/api/session/ses_test/permission") {
        listed.resolve()
        if (mode === "stale") await release.promise
        return json({ data: mode === "hydrated" ? [permission] : [] })
      }
      if (request.method === "POST" && url.pathname.includes("permission")) {
        reply = await request.json()
        return new Response(null, { status: 204 })
      }
      return undefined
    }, events)
    const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false, tabs: { mode: "off" } }), update: async () => ({}) },
        packages: { prepare: async () => ({ directory: "" }) },
        args: { sessionID: session.id },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await listed.promise
      if (mode !== "stale") await setup.waitForFrame((frame) => frame.includes("Run local echo"))
      events.emit({ id: "evt_ask", created: 2, type: "permission.asked", data: permission })
      await setup.waitForFrame((frame) => frame.includes("local_echo") && frame.includes("Allow"))
      release.resolve()
      await setup.waitForVisualIdle()
      expect(setup.captureCharFrame()).toContain("Allow once")
      setup.mockInput.pressEnter()
      await setup.waitFor(() => reply !== undefined)
      expect(reply).toMatchObject({ decision: "once" })
    } finally {
      release.resolve()
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
)
