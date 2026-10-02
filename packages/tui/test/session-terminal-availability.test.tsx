import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

// Each case uses its own session so a prompt draft left by one case cannot satisfy another.
test.each([
  { id: "ses_terminal_reported", reported: true, offered: true },
  { id: "ses_terminal_unsupported", reported: false, offered: false },
  { id: "ses_terminal_unreported", reported: undefined, offered: true },
])("offers persistent terminals when the server reports $reported", async (input) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 120, height: 36, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: input.id,
    title: "Terminal support fixture",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const message = { id: "message-0", type: "user", text: "Terminal support message", time: { created: 0 } }
  const requests: string[] = []
  const calls = createFetch((url) => {
    requests.push(url.pathname)
    if (url.pathname === "/api/info")
      return json({ version: "test", pid: 0, urls: [], paths: { tmp: "/tmp" }, persistentPty: input.reported })
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [message], cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    return undefined
  }, createEventStream())
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { mode: "off" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Terminal support message"))
    await setup.waitFor(() => requests.includes("/api/info"))
    await setup.waitForVisualIdle()
    await setup.mockInput.typeText("/terminal")
    if (input.offered) {
      await setup.waitForFrame((frame) => frame.includes("New terminal"))
      return
    }
    await setup.waitForVisualIdle()
    expect(setup.captureCharFrame()).not.toContain("New terminal")
    expect(requests).not.toContain(`/api/experimental/session/${session.id}/terminal`)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
