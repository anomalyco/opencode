import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const session = {
  id: "ses_shell_stopped",
  title: "Stopped shell",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const model = { providerID: "fixture", id: "fixture" }
const steps = Array.from({ length: 15 }, (_, index) => `step ${index + 1}`).join("\n")
const notice = "[full output saved to /tmp/sh_stopped.out]\n\nCommand interrupted by the user (shell ID: sh_stopped)."
const shell = (id: string, command: string, state: object) => ({
  type: "tool" as const,
  id,
  name: "shell",
  time: { created: 1, completed: 2 },
  state: { input: { command }, ...state },
})
const messages = [
  { type: "user", id: "user-1", text: "Run them", time: { created: 0 } },
  {
    type: "assistant",
    id: "assistant-1",
    agent: "build",
    model,
    finish: "stop",
    time: { created: 1, completed: 3 },
    content: [
      shell("call-completed", "seq-completed", {
        status: "completed",
        content: [{ type: "text", text: steps }],
        metadata: { exit: 0, truncated: false },
      }),
      // How a call the user stopped settles: its output, then the notice its metadata names.
      shell("call-stopped", "seq-stopped", {
        status: "error",
        error: { type: "tool.execution", message: `${steps}\n\n${notice}` },
        metadata: { interrupted: true, truncated: false, shellID: "sh_stopped", notice },
      }),
      { type: "text", text: "Both ran" },
    ],
  },
] as SessionMessageInfo[]

test("a call the user stopped shows its output once, clipped like a finished call's, then the notice once", async () => {
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
    await setup.waitForFrame((frame) => frame.includes("Both ran"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    const frame = setup.captureCharFrame()
    const card = (command: string, next: string) => frame.slice(frame.indexOf(command), frame.indexOf(next))
    const completed = card("$ seq-completed", "$ seq-stopped")
    const stopped = card("$ seq-stopped", "Both ran")
    const body = (text: string) => text.split("\n").slice(1).join("\n")
    // The same clipped tail as the finished call.
    const tail = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim().replace(/[│┃]/g, "").trim())
        .filter((line) => /^step \d+$|earlier lines/.test(line))
    expect(tail(stopped)).toEqual(tail(completed))
    expect(tail(stopped)[0]).toMatch(/earlier lines/)
    // Each line of output once; the notice once.
    expect(body(stopped).match(/step 15\b/g)).toHaveLength(1)
    expect(stopped.match(/Command interrupted by the user/g)).toHaveLength(1)
    expect(stopped.match(/full output saved to/g)).toHaveLength(1)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
