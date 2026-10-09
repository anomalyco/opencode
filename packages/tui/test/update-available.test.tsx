import { expect, mock, test } from "bun:test"
import path from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/fixture"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

const connectedProvider = { id: "test", name: "Test", source: "config", env: [], options: {}, models: {} }

async function startApp(state: string, kv: Record<string, unknown> = {}) {
  await Bun.write(path.join(state, "kv.json"), JSON.stringify(kv))
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  await mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const upgrades: { target: string }[] = []
  const calls = createFetch()
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === "/global/upgrade") {
      const body: { target: string } = await request.clone().json()
      upgrades.push(body)
      return json({ success: true, version: body.target })
    }
    if (url.pathname === "/config/providers") return json({ providers: [connectedProvider], default: {} })
    return calls.fetch(request)
  }) as typeof globalThis.fetch
  let api!: TuiPluginApi
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch,
      events: events.source,
      args: {},
      pluginHost: {
        async start(input) {
          api = input.api
          started()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(Global.layerWith({ state }))),
  )
  const waitFor = async (predicate: () => boolean, what: string) => {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > 2000) throw new Error(`timed out waiting for ${what}`)
      await Bun.sleep(10)
      await setup.renderOnce()
    }
  }
  await ready
  await waitFor(() => api.kv.ready, "kv.ready")

  return {
    setup,
    upgrades,
    api,
    waitFor,
    announce(version: string) {
      events.emit({
        directory: "global",
        payload: {
          id: `evt_update_${version}`,
          type: "installation.update-available",
          properties: { version },
        },
      })
    },
    frame() {
      return setup.captureCharFrame()
    },
    async settle() {
      await Bun.sleep(100)
      await setup.renderOnce()
    },
    async stop() {
      api.keymap.dispatchCommand("app.exit")
      await task
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
}

test("Enter on a v2 release notice does not upgrade", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path)
  try {
    app.announce("2.0.25")
    await app.waitFor(() => app.frame().includes("v2.0.25"), "v2.0.25")
    app.setup.mockInput.pressEnter()
    await app.settle()

    expect(app.upgrades).toEqual([])
    expect(app.api.ui.dialog.open).toBe(false)
    expect(app.frame()).toContain("OpenCode v2 is available")
    expect(app.frame()).toContain("not compatible with v1")
    expect(app.frame()).toContain("https://opencode.ai/v2/docs/migrate-v1")
    expect(app.api.kv.get<string>("v2_notice_version")).toBe("2.0.25")
    expect(app.api.kv.get("skipped_version")).toBeUndefined()
  } finally {
    await app.stop()
  }
})

test("the update dialog starts on Skip", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path)
  try {
    app.announce("1.19.0")
    await app.waitFor(() => app.frame().includes("update now?"), "update now?")
    app.setup.mockInput.pressEnter()
    await app.settle()

    expect(app.upgrades).toEqual([])
    expect(app.api.kv.get<string>("skipped_version")).toBe("1.19.0")
    expect(app.api.ui.dialog.open).toBe(false)
  } finally {
    await app.stop()
  }
})

test("choosing Confirm on the update dialog upgrades", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path)
  try {
    app.announce("1.19.0")
    await app.waitFor(() => app.frame().includes("update now?"), "update now?")
    app.setup.mockInput.pressArrow("right")
    app.setup.mockInput.pressEnter()
    await app.settle()

    expect(app.upgrades).toEqual([{ target: "1.19.0" }])
  } finally {
    await app.stop()
  }
})

test("each v2 release is announced once", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path, { v2_notice_version: "2.0.25" })
  try {
    app.announce("2.0.25")
    await app.settle()

    expect(app.frame()).not.toContain("v2.0.25")
    expect(app.api.ui.dialog.open).toBe(false)

    app.announce("2.0.26")
    await app.waitFor(() => app.frame().includes("v2.0.26"), "v2.0.26")
    expect(app.api.kv.get<string>("v2_notice_version")).toBe("2.0.26")
    expect(app.upgrades).toEqual([])
  } finally {
    await app.stop()
  }
})

test("a skipped v2 release does not hide 1.x updates", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path, { skipped_version: "2.0.25" })
  try {
    app.announce("1.19.0")
    await app.waitFor(() => app.frame().includes("update now?"), "update now?")

    expect(app.api.ui.dialog.open).toBe(true)
  } finally {
    await app.stop()
  }
})

test("other confirm dialogs still start on Confirm", async () => {
  await using tmp = await tmpdir()
  const app = await startApp(tmp.path)
  try {
    const choices: string[] = []
    app.api.ui.dialog.replace(() =>
      app.api.ui.DialogConfirm({
        title: "Plugin",
        message: "Continue?",
        onConfirm: () => choices.push("confirm"),
        onCancel: () => choices.push("cancel"),
      }),
    )
    await app.waitFor(() => app.frame().includes("Continue?"), "Continue?")
    app.setup.mockInput.pressEnter()
    await app.settle()

    expect(choices).toEqual(["confirm"])
  } finally {
    await app.stop()
  }
})
