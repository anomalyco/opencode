import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../../fixture/tui-sdk"

const sessionID = "ses_overlay_app"

const session = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_test",
  title: "Overlay session",
  directory,
  version: "0.0.0-test",
  time: { created: 1, updated: 1 },
}

const agents = [
  { name: "build", mode: "primary" as const, native: true, permission: {}, options: {} },
  { name: "plan", mode: "primary" as const, native: true, permission: {}, options: {} },
]

type OverlayCall = { sessionID: string; enabled: boolean }

async function boot() {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const overlay: OverlayCall[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/agent") return json(agents)
    if (url.pathname === "/session") return json([session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) return json([])
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    const match = /^\/permission\/session\/([^/]+)\/overlay$/.exec(url.pathname)
    if (match) {
      const body = (await request.json()) as { enabled: boolean }
      overlay.push({ sessionID: match[1], enabled: body.enabled })
      return json(body.enabled)
    }
    return undefined
  })

  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  const { run } = await import("../../../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: events.source,
      args: { continue: true },
      pluginHost: {
        async start(input) {
          api = input.api
          started()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )
  await ready

  return {
    overlay,
    async frame() {
      await setup.renderOnce()
      await setup.renderOnce()
      return setup.captureCharFrame()
    },
    cycle() {
      api?.keymap.dispatchCommand("agent.cycle")
    },
    async waitFor(fn: () => boolean, timeout = 8_000) {
      const start = Date.now()
      while (!fn()) {
        if (Date.now() - start > timeout) throw new Error("timed out waiting for overlay condition")
        await this.frame()
        await Bun.sleep(20)
      }
    },
    async stop() {
      api?.keymap.dispatchCommand("app.exit")
      await task.catch(() => {})
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

test("cycling into and out of auto-approve moves the server overlay with it", async () => {
  const app = await boot()
  try {
    await app.waitFor(() => true)
    expect(app.overlay).toHaveLength(0)

    // build/normal -> plan/normal -> build/review
    app.cycle()
    app.cycle()
    await app.waitFor(() => app.overlay.length === 1)
    expect(app.overlay[0]).toEqual({ sessionID, enabled: true })

    // build/review -> build/normal
    app.cycle()
    await app.waitFor(() => app.overlay.length === 2)
    expect(app.overlay[1]).toEqual({ sessionID, enabled: false })
  } finally {
    await app.stop()
  }
}, 30_000)
