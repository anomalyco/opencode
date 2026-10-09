import { expect, test } from "bun:test"
import { createTestRenderer, TestRecorder } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

type Setup = Awaited<ReturnType<typeof createTestRenderer>>

const session = {
  id: "ses_activity_anchor",
  title: "Activity anchor",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const model = { providerID: "fixture", id: "fixture" }
// Turn N runs N + 2 commands, so every Low summary label is unique.
const messages: SessionMessageInfo[] = Array.from({ length: 6 }, (_, turn) => [
  { type: "user" as const, id: `user-${turn}`, text: `Turn ${turn} prompt`, time: { created: turn * 10 } },
  {
    type: "assistant" as const,
    id: `assistant-${turn}`,
    agent: "build",
    model,
    finish: "stop" as const,
    time: { created: turn * 10 + 1, completed: turn * 10 + 3 },
    content: [
      ...Array.from({ length: turn + 2 }, (_, index) => ({
        type: "tool" as const,
        id: `shell-${turn}-${index}`,
        name: "shell",
        time: { created: turn * 10 + 1, completed: turn * 10 + 2 },
        state: {
          status: "completed" as const,
          input: { command: `echo turn ${turn} step ${index}` },
          content: [{ type: "text" as const, text: `turn ${turn} step ${index} output` }] as [
            { type: "text"; text: string },
          ],
          metadata: {},
        },
      })),
      { type: "text" as const, text: `Turn ${turn} answer` },
    ],
  },
]).flat()
// A turn still running its commands, so its summary ends the transcript.
const running: SessionMessageInfo[] = [
  { type: "user", id: "user-running", text: "Running prompt", time: { created: 100 } },
  {
    type: "assistant",
    id: "assistant-running",
    agent: "build",
    model,
    time: { created: 101 },
    content: Array.from({ length: 1 }, (_, index) => ({
      type: "tool" as const,
      id: `shell-running-${index}`,
      name: "shell",
      time: { created: 101, completed: 102 },
      state: {
        status: "completed" as const,
        input: { command: `echo running step ${index}` },
        content: [{ type: "text" as const, text: `running step ${index} output` }] as [{ type: "text"; text: string }],
        metadata: {},
      },
    })),
  },
]

async function withSession(run: (setup: Setup) => Promise<void>, history = messages) {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: history.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run: runApp } = await import("../src/app")
  const task = Effect.runPromise(
    runApp({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, session: { verbosity: "low" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes(history === messages ? "Turn 5 answer" : "1 command"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    await run(setup)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}

const lines = (frame: string) => frame.split("\n")
const rowOf = (frame: string, label: string) => lines(frame).findIndex((line) => line.includes(label))

/** Clicks the summary and returns its row in every frame rendered afterwards. */
async function toggle(setup: Setup, label: string) {
  const row = rowOf(setup.captureCharFrame(), label)
  expect(row).toBeGreaterThan(0)
  // Stay outside OpenTUI's 500ms multi-click window so a second toggle is not a word selection.
  await Bun.sleep(550)
  const recorder = new TestRecorder(setup.renderer)
  recorder.rec()
  await setup.mockMouse.click(8, row)
  await setup.waitForVisualIdle({ quietFrames: 3 })
  recorder.stop()
  expect(recorder.recordedFrames.length).toBeGreaterThan(0)
  return { row, frames: [...new Set(recorder.recordedFrames.map((frame) => rowOf(frame.frame, label)))] }
}

test.each([0, 1, 3])(
  "low activity details open below a summary that keeps its row, %i wheel steps from the bottom",
  async (steps) => {
    await withSession(async (setup) => {
      await Array.from({ length: steps }).reduce<Promise<void>>(
        (previous) => previous.then(() => setup.mockMouse.scroll(30, 10, "up")),
        Promise.resolve(),
      )
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const commands = [7, 6, 5, 4].find((count) => {
        const row = rowOf(setup.captureCharFrame(), `${count} commands`)
        return row > 4 && row < 18
      })
      expect(commands).toBeDefined()
      const label = `${commands} commands`
      const turn = commands! - 2

      const expand = await toggle(setup, label)
      expect(expand.frames).toEqual([expand.row])
      const expanded = lines(setup.captureCharFrame())
      expect(expanded[expand.row]).toContain(`− ${label}`)
      expect(expanded.slice(expand.row + 1).join("\n")).toContain(`echo turn ${turn} step 0`)
      expect(expanded.slice(0, expand.row).join("\n")).not.toContain(`echo turn ${turn} step`)

      const collapse = await toggle(setup, label)
      expect(collapse.frames).toEqual([expand.row])
      expect(lines(setup.captureCharFrame())[expand.row]).toContain(`+ ${label}`)
    })
  },
  20000,
)

test("a low activity summary that ends the transcript opens like v2 at the bottom", async () => {
  await withSession(
    async (setup) => {
      const label = "1 command"
      const expand = await toggle(setup, label)
      const expanded = lines(setup.captureCharFrame())
      const row = expanded.findIndex((line) => line.includes(`− ${label}`))
      expect(row).toBeLessThan(expand.row)
      expect(expanded.slice(row + 1).join("\n")).toContain("running step 0 output")
      expect(expanded.join("\n")).not.toContain("Jump to latest")

      const collapse = await toggle(setup, label)
      expect(collapse.frames.at(-1)).toBe(expand.row)
      expect(lines(setup.captureCharFrame())[expand.row]).toContain(`+ ${label}`)
    },
    [...messages, ...running],
  )
}, 20000)
