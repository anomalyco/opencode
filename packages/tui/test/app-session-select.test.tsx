import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

type PublishBody = { type: string; properties?: { sessionID?: string } }

function parsePublishes(bodies: (string | undefined)[]) {
  const out: PublishBody[] = []
  for (const body of bodies) {
    if (!body) continue
    try {
      out.push(JSON.parse(body) as PublishBody)
    } catch {}
  }
  return out
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("publishes tui.session.select when the TUI navigates to a session route", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session")
      return json([
        {
          id: "dummy",
          title: "Demo session",
          slug: "dummy",
          projectID: "project",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        },
        {
          id: "other",
          title: "Other session",
          slug: "other",
          projectID: "project",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        },
      ])
  })

  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        // continue: true seeds the initial route as { type: "session", sessionID: "dummy" }
        args: { continue: true },
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(Global.defaultLayer)),
    )

    await ready
    await setup.renderOnce()
    await setup.renderOnce()

    // Initial mount should publish for "dummy"
    await wait(() => calls.tuiPublish.some((r) => r.body?.includes('"dummy"')))

    // Navigate to a different session via the plugin API (in-TUI navigation path)
    api?.route.navigate("session", { sessionID: "other" })
    await setup.renderOnce()
    await wait(() => calls.tuiPublish.some((r) => r.body?.includes('"other"')))

    // Inbound tui.session.select for "back-to-dummy" — should NOT be re-published
    const beforeInbound = calls.tuiPublish.length
    events.emit({
      directory,
      project: "proj_test",
      payload: {
        type: "tui.session.select",
        properties: { sessionID: "dummy" },
      } as any,
    })
    await setup.renderOnce()
    await Bun.sleep(20)
    await setup.renderOnce()

    const publishes = parsePublishes(calls.tuiPublish.map((r) => r.body))
    const sessionIds = publishes.filter((p) => p.type === "tui.session.select").map((p) => p.properties?.sessionID)

    expect(sessionIds).toContain("dummy")
    expect(sessionIds).toContain("other")
    // No echo from the inbound select event
    expect(calls.tuiPublish.length).toBe(beforeInbound)

    api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
