import { expect, spyOn, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each(["success", "failure", "home"])("Copy session ID from Ctrl+P (%s)", async (mode) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  Object.defineProperty(setup.renderer, "capabilities", { get: () => null })
  const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(mode === "success")
  const sessionID = "ses_copy_id"
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "proj_test",
          title: "Copy ID fixture",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
      return json({ data: [] })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: mode === "home" ? {} : { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    setup.mockInput.pressKey("p", { ctrl: true })
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
    await setup.mockInput.typeText("Copy session ID")
    if (mode === "home") {
      await setup.waitForVisualIdle()
      expect(setup.captureCharFrame()).not.toMatch(/Copy session ID\s+Session/)
      expect(copy).not.toHaveBeenCalled()
      return
    }
    await setup.waitForFrame((frame) => /Copy session ID\s+Session/.test(frame))
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((frame) =>
      frame.includes(mode === "success" ? "Session ID copied to clipboard!" : "Failed to copy session ID"),
    )
    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0]?.[0]).toBe(sessionID)
    expect(frame).not.toContain("Copy session ID")
    await setup.waitFor(
      () =>
        setup.renderer.currentFocusedEditor instanceof TextareaRenderable &&
        !(setup.renderer.currentFocusedEditor instanceof InputRenderable),
    )
  } finally {
    copy.mockRestore()
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
