import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

async function readBody(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) return input.clone().json().catch(() => undefined)
  if (typeof init?.body === "string") return JSON.parse(init.body)
  return undefined
}

async function waitFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, fn: (frame: string) => boolean) {
  const start = Date.now()
  while (true) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (fn(frame)) return frame
    if (Date.now() - start > 15_000) throw new Error("timed out waiting for frame:\n" + frame)
    await Bun.sleep(25)
  }
}

// The Windows path: many terminals there deliver ctrl+v as a key event instead
// of a bracketed paste, so dialog prompts must read the clipboard themselves —
// the clipboard-reading prompt.paste command only targets the main session
// prompt. Walks /connect -> Other -> API key, pastes the key with ctrl+v, and
// asserts the stored credential (newlines from the Windows clipboard stripped,
// since ApiMethod stores the value verbatim).
test("ctrl+v pastes the clipboard into the connect API key prompt", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const base = createFetch(undefined, events)
  const auth: { providerID: string; body: unknown }[] = []

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = (input instanceof Request ? input.method : (init?.method ?? "GET")).toUpperCase()
    if (method === "PUT" && url.pathname.startsWith("/auth/")) {
      auth.push({ providerID: decodeURIComponent(url.pathname.slice("/auth/".length)), body: await readBody(input, init) })
      return json({})
    }
    if (method === "POST" && url.pathname === "/instance/dispose") return json({})
    return base.fetch(input, init)
  }) as typeof globalThis.fetch

  let api: TuiPluginApi | undefined
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
      clipboard: { read: async () => ({ data: "sk-pasted\r\n", mime: "text/plain" }) },
      args: {},
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

  try {
    api!.keymap.dispatchCommand("provider.connect")
    await waitFrame(setup, (f) => f.includes("Connect a provider"))
    setup.mockInput.pressEnter() // "Other" is the only option with no providers registered

    await waitFrame(setup, (f) => f.includes("Provider id"))
    await setup.mockInput.typeText("credx")
    setup.mockInput.pressEnter()

    await waitFrame(setup, (f) => f.includes("API key"))
    setup.mockInput.pressKey("v", { ctrl: true })
    await waitFrame(setup, (f) => f.includes("sk-pasted"))
    setup.mockInput.pressEnter()

    const start = Date.now()
    while (auth.length === 0) {
      await setup.renderOnce()
      if (Date.now() - start > 15_000) throw new Error("timed out waiting for the credential write")
      await Bun.sleep(25)
    }
    expect(auth).toEqual([{ providerID: "credx", body: { type: "api", key: "sk-pasted" } }])
  } finally {
    api?.keymap.dispatchCommand("app.exit")
    await task
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
}, 60_000)
