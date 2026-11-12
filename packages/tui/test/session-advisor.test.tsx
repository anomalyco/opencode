import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const session = {
  id: "ses_advisor_rows",
  title: "Advisor rows",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const model = { providerID: "fixture", id: "fixture" }
const advisor = (id: string, state: object) => ({
  type: "tool" as const,
  id,
  name: "advisor",
  time: { created: 1, completed: 2 },
  state: { input: {}, ...state },
})
const messages = [
  { type: "user", id: "user-1", text: "Check with the advisor", time: { created: 0 } },
  {
    type: "assistant",
    id: "assistant-1",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 1, completed: 3 },
    content: [
      advisor("call-running", { status: "running", metadata: { model: "fixture/advisor", mode: "full" } }),
      advisor("call-reviewed", {
        status: "completed",
        content: [{ type: "text", text: "Use the existing helper" }],
        input: { question: "Recursion or iteration?" },
        metadata: { model: "fixture/advisor", mode: "full", status: "reviewed" },
      }),
      advisor("call-declined", {
        status: "completed",
        content: [{ type: "text", text: "The advisor had nothing to add." }],
        input: { question: "Q", context: "C" },
        metadata: { model: "fixture/advisor", mode: "secure", status: "declined" },
      }),
      advisor("call-error", {
        status: "error",
        error: { type: "tool.execution", message: "Advisor unavailable: model not found. Continue without advice." },
      }),
      { type: "text", text: "Work is done" },
    ],
  },
] as SessionMessageInfo[]

test("advisor tool rows show running, reviewed, declined and unavailable states", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 60, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, session: { verbosity: "high" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Work is done"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Advising")
    expect(frame).toContain("Advisor reviewed · ")
    expect(frame).toContain("Advisor declined · ")
    expect(frame).toContain("Advisor unavailable")

    // Each row opens a dropdown of the exchange: what the advisor was shown and what came back.
    const click = async (text: string) => {
      const row = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes(text))
      expect(row).toBeGreaterThan(0)
      await setup.mockMouse.click(8, row)
      await setup.waitForVisualIdle({ quietFrames: 3 })
    }
    await click("Advisor reviewed · ")
    expect(setup.captureCharFrame()).toContain("Shared the whole conversation.")
    expect(setup.captureCharFrame()).toContain("Recursion or iteration?")
    expect(setup.captureCharFrame()).toContain("Use the existing helper")
    await click("Advisor declined · ")
    expect(setup.captureCharFrame()).toContain("Shared only this brief, not the conversation:")
    expect(setup.captureCharFrame()).toContain("The advisor had nothing to add.")
    await click("Advisor unavailable")
    expect(setup.captureCharFrame()).toContain("model not found. Continue without advice.")
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
