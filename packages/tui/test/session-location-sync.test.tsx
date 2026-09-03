import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  { width: 70, endpoint: "agent", initial: true },
  { width: 120, endpoint: "agent", initial: false },
  { width: 100, endpoint: "model", initial: false },
  { width: 100, endpoint: "mcp", initial: false },
  { width: 100, endpoint: "location", initial: true },
  { width: 100, endpoint: "location", initial: false },
])("session sync offers truthful recovery (%o)", async ({ width, endpoint, initial }) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const sessionID = `ses_location_sync_${endpoint}_${width}`
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  let agents = 0
  let failures = 0
  let healthy = !initial
  let recovered = 0
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          title: "Location sync fixture",
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
    if (url.pathname === "/api/worktree/project") return json([{ directory: "/other" }])
    if (url.pathname === "/api/worktree/project/refresh") return new Response(null, { status: 204 })
    if (url.pathname === `/api/${endpoint}` && !healthy) {
      if (endpoint === "agent") agents++
      failures++
      return json({ message: "Service temporarily unavailable" }, { status: 500 })
    }
    if (url.pathname === `/api/${endpoint}` && failures > 0) recovered++
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent") {
      agents++
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    }
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
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
      args: { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    const title = endpoint === "location" ? "Could not load session location" : "Session data sync failed"
    if (!initial) {
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText("Keep this draft")
      await setup.waitForFrame((frame) => frame.includes("Keep this draft"))
      healthy = false
      events.disconnect()
    }
    const editor = setup.renderer.currentFocusedEditor
    await setup.waitFor(() => failures > 0, { maxPasses: 120 })
    // Also settle on the old panel so this remains an assertion failure on the base revision.
    await setup.waitForFrame((frame) => frame.includes("Session location unavailable") || frame.includes(title))
    await setup.waitForVisualIdle()
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("Choose another directory to continue this session.")
    expect(frame).toContain(title)
    // Undeclared HTTP 500 bodies are deliberately not decoded by the generated client.
    expect(frame).toContain("UnexpectedStatus")
    expect(frame).toContain("Retry")
    if (endpoint !== "location") {
      expect(agents).toBeGreaterThan(0)
      expect(frame).not.toContain("Choose directory")
      if (!initial) {
        expect(setup.renderer.currentFocusedEditor).toBe(editor)
        expect(editor?.plainText).toBe("Keep this draft")
      }
    }
    if (endpoint === "location") {
      expect(frame).toContain("Choose directory")
      const lines = frame.split("\n")
      const row = lines.findIndex((line) => line.includes("Choose directory"))
      await setup.mockMouse.click(lines[row]!.indexOf("Choose directory"), row)
      await setup.waitForFrame((frame) => frame.includes("Move session") && frame.includes("/other"))
      setup.mockInput.pressEscape()
      await setup.waitForFrame((frame) => !frame.includes("Move session") && frame.includes(title))
    }

    const retry = async () => {
      const lines = setup.captureCharFrame().split("\n")
      const row = lines.findIndex((line) => line.includes("Retry"))
      expect(row).toBeGreaterThanOrEqual(0)
      await setup.mockMouse.click(lines[row]!.indexOf("Retry"), row)
    }
    const before = failures
    await retry()
    await setup.waitFor(() => failures > before)
    await setup.waitForFrame((frame) => frame.includes(title))
    healthy = true
    await retry()
    await setup.waitFor(() => recovered > 0)
    await setup.waitForFrame((frame) => frame.includes("Demo Model") && !frame.includes(title))
    expect(agents).toBeGreaterThan(0)
    expect(setup.captureCharFrame()).not.toContain("Choose directory")
    if (!initial && endpoint !== "location") {
      expect(setup.renderer.currentFocusedEditor).toBe(editor)
      expect(editor?.plainText).toBe("Keep this draft")
      await setup.mockInput.typeText(" after retry")
      await setup.waitForFrame((frame) => frame.includes("Keep this draft after retry"))
    }
  } finally {
    setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
