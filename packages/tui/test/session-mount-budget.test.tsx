import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("an expanded group spends the mounting budget that older rows used", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_budget",
    title: "Budget",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const model = { providerID: "fixture", id: "fixture" }
  // 30 plain turns (3 rows each), then one turn whose single step makes 100 reads.
  const messages: SessionMessageInfo[] = [
    ...Array.from({ length: 30 }, (_, index) => [
      { type: "user" as const, id: `user-${index}`, text: `Turn ${index}`, time: { created: index * 10 } },
      {
        type: "assistant" as const,
        id: `answer-${index}`,
        agent: "build",
        model,
        finish: "stop" as const,
        time: { created: index * 10 + 1, completed: index * 10 + 2 },
        content: [{ type: "text" as const, text: `Answer ${index}` }],
      },
    ]).flat(),
    { type: "user", id: "user-explore", text: "Explore", time: { created: 1000 } },
    {
      type: "assistant",
      id: "answer-explore",
      agent: "build",
      model,
      finish: "stop",
      time: { created: 1001, completed: 1002 },
      content: Array.from({ length: 100 }, (_, index) => ({
        type: "tool" as const,
        id: `read-${index}`,
        name: "read",
        time: { created: 1001, completed: 1001 },
        state: {
          status: "completed" as const,
          input: { path: `${index}.ts` },
          content: [{ type: "text" as const, text: "ok" }] as [{ type: "text"; text: string }],
          metadata: {},
        },
      })),
    },
  ]
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
        get: async () => ({
          animations: false,
          tabs: { enabled: false },
          keybinds: { "session.messages_last_user": "ctrl+shift+u", "session.last": "ctrl+shift+l" },
        }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  const find = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable && node.getRenderable("user-explore")
      ? node
      : node.getChildren().map(find).find(Boolean)
  try {
    await setup.waitForFrame((frame) => frame.includes("Explored — 100 reads"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    const scroll = find(setup.renderer.root)
    if (!scroll) throw new Error("Missing transcript scrollbox")
    // Booleans keep a failure message from serializing the renderable graph.
    const mounted = (id: string) => scroll.getRenderable(id) !== undefined
    // Collapsed: 40 rows, the same as the former row budget. Turn 18 onward is mounted.
    expect(mounted("user-18")).toBe(true)
    expect(mounted("user-17")).toBe(false)

    const header = setup
      .captureCharFrame()
      .split("\n")
      .findIndex((line) => line.includes("Explored — 100 reads"))
    await setup.mockMouse.click(6, header)
    await setup.waitForFrame((frame) => frame.includes("Read 99.ts"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    // Expanded: the group's 101 rendered entries exceed the 40-entry tail on their own.
    expect(mounted("user-29")).toBe(false)
    expect(mounted("user-explore")).toBe(false)

    // Navigate back to the header (the view stayed pinned to the bottom), collapse, return.
    setup.mockInput.pressKey("u", { ctrl: true, shift: true })
    await setup.waitForFrame((frame) => frame.includes("Explored — 100 reads"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    await setup.mockMouse.click(
      6,
      setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("Explored — 100 reads")),
    )
    await setup.waitForVisualIdle({ quietFrames: 3 })
    setup.mockInput.pressKey("l", { ctrl: true, shift: true })
    await setup.waitForFrame((frame) => !frame.includes("Read 99.ts") && frame.includes("Explored — 100 reads"))
    await setup.waitForVisualIdle({ quietFrames: 3 })
    expect(mounted("user-18")).toBe(true)
    expect(mounted("user-17")).toBe(false)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 20000)
