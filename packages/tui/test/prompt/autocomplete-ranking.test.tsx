import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { takeDraft } from "../../src/component/prompt/draft-stash"

function rowOf(frame: string, text: string) {
  return frame.split("\n").findIndex((row) => row.includes(text))
}

// The first autocomplete row is the top-ranked slash command.
function firstSlashRow(frame: string) {
  const rows = frame.split("\n")
  const index = rows.findIndex((row) => row.includes("┃ /"))
  return index >= 0 ? rows[index] : ""
}

async function runApp(setup: Awaited<ReturnType<typeof createTestRenderer>>) {
  // The draft stash is module-global; clear any draft left by a previous test.
  takeDraft("dummy")
  const events = createEventStream()
  const calls = createFetch((url) => {
    const session = {
      id: "dummy",
      title: "Demo session",
      projectID: "project",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({}), update: async () => ({}) },
      packages: { resolve: async () => undefined },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID: "dummy" },
      log: () => {},
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
  )
  return { task, server }
}

test("slash autocomplete ranks resume first for /res", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  setup.renderer.start()
  const { task, server } = await runApp(setup)
  try {
    await setup.waitForFrame((frame) => frame.includes("shift+tab agents"))
    await setup.mockInput.typeText("/res")
    const frame = await setup.waitForFrame((frame) => firstSlashRow(frame).includes("/sessions"))
    const sessions = rowOf(frame, "/sessions")
    const next = rowOf(frame, "/new")
    expect(sessions).toBeGreaterThanOrEqual(0)
    expect(next).toBeGreaterThanOrEqual(0)
    expect(sessions).toBeLessThan(next)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})

test("slash autocomplete ranks models first for /m", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  setup.renderer.start()
  const { task, server } = await runApp(setup)
  try {
    await setup.waitForFrame((frame) => frame.includes("shift+tab agents"))
    await setup.mockInput.typeText("/m")
    const frame = await setup.waitForFrame((frame) => firstSlashRow(frame).includes("/models"))
    const models = rowOf(frame, "/models")
    const mcps = rowOf(frame, "/mcps")
    expect(models).toBeGreaterThanOrEqual(0)
    expect(mcps).toBeGreaterThanOrEqual(0)
    expect(models).toBeLessThan(mcps)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
