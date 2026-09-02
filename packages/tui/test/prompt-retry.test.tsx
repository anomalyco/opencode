import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each(["steer", "queue"] as const)(
  "retains and retries an unconfirmed %s with the original ID",
  async (delivery) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 80, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const retrying = Promise.withResolvers<void>()
    const exhausted = Promise.withResolvers<void>()
    const accepted = Promise.withResolvers<void>()
    const events = createEventStream()
    const sessionID = `ses_retry_${delivery}`
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const bodies: string[] = []
    const calls = createFetch(async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Prompt retry",
            agent: "build",
            model: { providerID: "demo", id: "model" },
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const text = await request.text()
        bodies.push(text)
        if (bodies.length <= 4) return new Response(null, { status: 503 })
        const body = JSON.parse(text)
        const item = { type: "user" as const, payload: { text: body.text }, delivery }
        events.emit({
          id: "evt_accepted",
          created: 10,
          type: "session.inbox.enqueued",
          durable: { aggregateID: sessionID, seq: 1, version: 1 },
          data: { sessionID, inboxID: body.id, item },
        })
        return json({ data: { id: body.id, sessionID, timeCreated: 10, ...item } })
      }
      return undefined
    }, events)
    const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({ animations: false, keybinds: { "prompt.queue": "f6" } }),
          update: async () => ({}),
        },
        packages: { resolve: async () => undefined },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: { sessionID },
        log: (_level, message, tags) => {
          if (message !== "prompt submission") return
          if (tags.outcome === "retrying") retrying.resolve()
          if (tags.outcome === "failed") exhausted.resolve()
          if (tags.outcome === "accepted") accepted.resolve()
        },
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await ready.promise
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText("Please keep this prompt")
      if (delivery === "queue") setup.mockInput.pressKey("F6")
      else setup.mockInput.pressEnter()
      await retrying.promise
      await setup.waitForFrame((frame) => frame.includes("Retrying send"))
      await exhausted.promise
      const failed = await setup.waitForFrame((frame) => frame.includes("Send not confirmed"))
      expect(failed).toContain("Please keep this prompt")
      const input = setup.renderer.currentFocusedRenderable
      expect(input).toBeInstanceOf(TextareaRenderable)
      if (!(input instanceof TextareaRenderable)) throw new Error("composer is not focused")
      expect(input.plainText).toBe("")
      expect(bodies).toHaveLength(4)

      const lines = failed.split("\n")
      const row = lines.findIndex((line) => line.includes("retry") && line.includes("cancel"))
      await setup.mockMouse.click(lines[row].indexOf("retry"), row)
      await accepted.promise
      await setup.waitForFrame((frame) => !frame.includes("Send not confirmed") && !frame.includes("Retrying send"))
      expect(bodies).toHaveLength(5)
      expect(new Set(bodies).size).toBe(1)
      expect(JSON.parse(bodies[0]).delivery).toBe(delivery)
      expect(input.plainText).toBe("")
    } finally {
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
)
