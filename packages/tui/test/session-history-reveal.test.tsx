import { expect, test } from "bun:test"
import { createTestRenderer, TestRecorder } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"

// The whole-app fixture needs the package's 30-second budget for its cold app import.
test.each([100, 48].flatMap((width) => [false, true].map((child) => ({ width, child }))))(
  "scrolling up into older history never flashes: $width columns, child=$child",
  async ({ width, child }) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width, height: 30, kittyKeyboard: true })
    await setup.renderer.setupTerminal()
    setup.renderer.start()
    const session = {
      id: "ses_history_reveal",
      title: "History reveal",
      projectID: "proj_test",
      parentID: child ? "ses_history_parent" : undefined,
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const parent = { ...session, id: "ses_history_parent", parentID: undefined, title: "Parent fixture" }
    const model = { providerID: "fixture", id: "fixture" }
    const messages: SessionMessageInfo[] = Array.from({ length: 60 }, (_, turn) => [
      { type: "user" as const, id: `user-${turn}`, text: `Turn ${turn} prompt`, time: { created: turn * 10 } },
      {
        type: "assistant" as const,
        id: `answer-${turn}`,
        agent: "build",
        model,
        finish: "stop" as const,
        time: { created: turn * 10 + 1, completed: turn * 10 + 2 },
        content: [{ type: "text" as const, text: `Turn ${turn} answer` }],
      },
    ]).flat()
    // The first page (turns 40-59) overfills the mounted tail, so scrolling up first mounts its hidden
    // rows, then loads turns 30-39 from the server. Both insert rows above the reader.
    const calls = createFetch((url) => {
      if (url.pathname === "/api/session") return json({ data: child ? [parent, session] : [session], cursor: {} })
      if (url.pathname === `/api/session/${parent.id}`) return json({ data: parent })
      if (
        url.pathname === `/api/session/${parent.id}/message` ||
        url.pathname === `/api/session/${parent.id}/inbox` ||
        url.pathname === `/api/session/${parent.id}/permission`
      )
        return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) {
        const cursor = url.searchParams.get("cursor")
        const end = Number(cursor ?? messages.length)
        const start = Math.max(0, end - (cursor ? Number(url.searchParams.get("limit")) : 40))
        return json({ data: messages.slice(start, end).toReversed(), cursor: start ? { next: String(start) } : {} })
      }
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    }, createEventStream())
    const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false, tabs: { enabled: false } }), update: async () => ({}) },
        packages: { prepare: async () => ({ directory: "" }) },
        args: { sessionID: session.id },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await waitForHighlightedFrame(setup, (frame) => frame.includes("Turn 59 answer"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const recorder = new TestRecorder(setup.renderer)
      recorder.rec()
      for (let step = 0; step < 200 && !setup.captureCharFrame().includes("Turn 39 answer"); step++) {
        await setup.mockMouse.scroll(30, 10, "up")
        await setup.renderOnce()
      }
      await setup.waitForVisualIdle({ quietFrames: 3 })
      recorder.stop()

      // A wheel tick moves less than one turn, so the earliest turn on screen steps down by at most one
      // per frame. A frame drawn before the inserted rows are scrolled past shows their first turn, and
      // the next frame jumps back to the reader.
      const turns = recorder.recordedFrames.map((frame) =>
        Math.min(...[...frame.frame.matchAll(/Turn (\d+) (?:prompt|answer)/g)].map((match) => Number(match[1]))),
      )
      expect(turns.at(-1)).toBeLessThanOrEqual(39)
      expect(
        turns.filter((turn, index) => index > 0 && (turn > turns[index - 1] || turn < turns[index - 1] - 1)),
      ).toEqual([])
    } finally {
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
  30000,
)
