import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  "bottom",
  "scrolled",
  "cancel",
  "scroll-cancel",
  "up-cancel",
  "mouse-cancel",
  "page-cancel",
  "failure",
  "mixed",
  "close",
  "resize-cancel",
  "settling",
  "settling-scrolled",
  "settling-reveal",
  "prepend",
  "prepend-navigation",
  "prepend-failure",
])("Home loads a stable, bounded beginning (%s)", async (mode) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_test",
    title: "Long history",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = Array.from({ length: 400 }, (_, index) =>
    mode === "mixed" && index % 2
      ? {
          id: `message-${index}`,
          type: "assistant",
          agent: "build",
          model: { providerID: "demo", id: "demo-model" },
          content: [{ type: "text", text: `History message ${String(index).padStart(4, "0")}` }],
          finish: "stop",
          time: { created: index, completed: index + 1 },
        }
      : {
          id: `message-${index}`,
          type: "user",
          text: `History message ${String(index).padStart(4, "0")}`,
          time: { created: index },
        },
  )
  const pages: { end: number; limit: number }[] = []
  const release = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const prior = Promise.withResolvers<void>()
  const aborted = Promise.withResolvers<void>()
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/ses_test") return json({ data: session })
    if (url.pathname === "/api/session/ses_test/message") {
      const end = Number(url.searchParams.get("cursor") ?? messages.length)
      const limit = Number(url.searchParams.get("limit"))
      const start = Math.max(0, end - limit)
      pages.push({ end, limit })
      if (end < messages.length) {
        request.signal.addEventListener("abort", () => aborted.resolve(), { once: true })
        await (mode.startsWith("prepend") && limit === 20 ? prior.promise : release.promise)
      }
      if (end === 0) await finish.promise
      if (mode === "failure" && end === 0 && pages.filter((page) => page.end === 0).length === 1)
        return json({ message: "offline" }, { status: 503 })
      if (mode === "prepend-failure" && limit === 200) return json({ message: "offline" }, { status: 503 })
      return json({ data: messages.slice(start, end).toReversed(), cursor: end ? { next: String(start) } : {} })
    }
    if (url.pathname === "/api/session/ses_test/inbox") return json({ data: [] })
    if (url.pathname === "/api/session/ses_test/permission") return json({ data: [] })
    return undefined
  }, events)
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
          keybinds: {
            "session.line.up": "f6",
            "session.page.down": "f7",
            "session.page.up": "f8",
            "session.message.previous": "f9",
          },
        }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID: "ses_test" },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("History message 0399"))
    const findScrollBox = (root: Renderable): ScrollBoxRenderable | undefined =>
      root instanceof ScrollBoxRenderable && root.getRenderable("message-399")
        ? root
        : root.getChildren().map(findScrollBox).find(Boolean)
    const scroll = findScrollBox(setup.renderer.root)
    if (!scroll) throw new Error("session transcript scrollbox was not found")
    const mounted = () => scroll.getChildren().filter((child) => child.id?.startsWith("message-"))
    const maximum = () => Math.max(0, scroll.scrollHeight - scroll.viewport.height)
    if (mode === "scrolled" || mode === "cancel" || mode === "settling-scrolled") {
      setup.mockInput.pressKey("F6")
      await setup.waitForFrame((frame) => frame.includes("Jump to latest"))
    }
    if (mode === "page-cancel" || mode.startsWith("prepend")) {
      scroll.scrollTo(0)
      await setup.waitForFrame((frame) => frame.includes("History message 0380"))
    }
    await setup.waitForVisualIdle()
    const visible = () =>
      JSON.stringify(
        setup
          .captureCharFrame()
          .split("\n")
          .flatMap((line, y) => {
            const message = line.match(/History message (\d{4})/)
            // Markdown fills asynchronously; stable user rows are the viewport anchors.
            if (mode === "mixed" && message && messages[Number(message[1])]?.type === "assistant") return []
            return message ? [{ line: message[0], x: message.index, y }] : []
          }),
      )
    const before = visible()
    const frames = [before]
    const mountCounts: number[] = []
    let navigated = false
    const capture = () => {
      if (visible() !== frames.at(-1)) frames.push(visible())
      if (mode !== "settling-reveal" || scroll.getRenderable("message-0")) mountCounts.push(mounted().length)
      if (
        mode.startsWith("settling") &&
        !navigated &&
        setup.captureCharFrame().includes("History message 0000") &&
        setup.captureCharFrame().includes("Loading session history")
      ) {
        navigated = true
        setup.mockInput.pressKey("F7")
      }
    }
    setup.renderer.on("frame", capture)

    if (mode.startsWith("prepend")) {
      setup.mockInput.pressKey(mode === "prepend-navigation" ? "F9" : "F8")
      await setup.waitFor(() => pages.length === 2)
      setup.mockInput.pressKey("HOME")
      await setup.waitForFrame((frame) => frame.includes("Loading session history"))
      prior.resolve()
      await setup.waitFor(() => pages.some((page) => page.end === 360 && page.limit === 200))
      await setup.waitForVisualIdle()
      expect(visible()).toBe(before)
      expect(setup.captureCharFrame()).toContain("Loading session history")
      expect(pages).toEqual([
        { end: 400, limit: 20 },
        { end: 380, limit: 20 },
        { end: 360, limit: 200 },
      ])
      release.resolve()
      finish.resolve()
      if (mode === "prepend-failure") {
        await setup.waitForFrame((frame) => !frame.includes("Loading session history"))
        expect(visible()).toBe(before)
        expect(mounted()).toHaveLength(40)
        return
      }
      await setup.waitForFrame(
        (frame) => frame.includes("History message 0000") && !frame.includes("Loading session history"),
      )
      expect(mounted()).toHaveLength(60)
      expect(pages).toHaveLength(5)
      return
    }
    setup.mockInput.pressKey("HOME")
    await setup.waitForFrame((frame) => frame.includes("Loading session history…"))
    setup.mockInput.pressKey("HOME")
    await setup.waitForVisualIdle()
    expect(pages).toEqual([
      { end: 400, limit: 20 },
      { end: 380, limit: 200 },
    ])
    expect(frames).toEqual([before])

    if (mode === "close" || mode === "resize-cancel") {
      if (mode === "close") setup.renderer.destroy()
      if (mode === "resize-cancel") {
        setup.resize(60, 22)
        await setup.waitForFrame(
          (frame) => frame.includes("History message 0399") && !frame.includes("Loading session history"),
        )
      }
      await aborted.promise
      release.resolve()
      finish.resolve()
      if (mode === "close") await task
      if (mode === "resize-cancel") await setup.waitForVisualIdle({ quietFrames: 4 })
      expect(pages).toHaveLength(2)
      return
    }
    if (mode === "mixed") {
      release.resolve()
      finish.resolve()
      await setup.waitForFrame(
        (frame) => frame.includes("History message 0000") && !frame.includes("Loading session history"),
      )
      await setup.waitForVisualIdle()
      expect(frames).toEqual([before, visible()])
      expect(setup.captureCharFrame()).toContain("History message 0001")
      expect(mounted().map((child) => child.id)).toEqual(messages.slice(0, 40).map((message) => message.id))
      expect(scroll.scrollTop).toBe(0)
      expect(Math.max(...mountCounts)).toBeLessThanOrEqual(60)
      return
    }
    if (mode.startsWith("settling")) {
      release.resolve()
      finish.resolve()
      await setup.waitFor(() => navigated)
      await setup.waitForVisualIdle()
      expect(mounted().map((child) => child.id)).toEqual(messages.slice(0, 60).map((message) => message.id))
      expect(scroll.scrollTop).toBeGreaterThan(0)
      setup.mockInput.pressKey("END")
      await setup.waitForFrame((frame) => frame.includes("History message 0399") && !frame.includes("Jump to latest"))
      await setup.waitFor(() => scroll.scrollTop === maximum())
      if (mode === "settling-reveal") {
        scroll.scrollTo(0)
        await setup.waitForFrame((frame) => frame.includes("History message 0360"))
        setup.mockInput.pressKey("F8")
      }
      navigated = false
      setup.mockInput.pressKey("HOME")
      await setup.waitFor(() => navigated)
      await setup.waitForVisualIdle()
      expect(mounted().map((child) => child.id)).toEqual(messages.slice(0, 60).map((message) => message.id))
      expect(scroll.scrollTop).toBeGreaterThan(0)
      expect(scroll.scrollTop).toBeLessThanOrEqual(scroll.height)
      expect(Math.max(...mountCounts)).toBeLessThanOrEqual(60)
      expect(pages).toHaveLength(4)
      return
    }
    if (mode === "page-cancel") {
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame((frame) => !frame.includes("Loading session history"))
      release.resolve()
      finish.resolve()
      await setup.waitFor(() => Boolean(scroll.getRenderable("message-360")))
      await setup.waitForVisualIdle()
      expect(setup.captureCharFrame()).toContain("History message 0379")
      expect(mounted()).toHaveLength(40)
      expect(pages).toEqual([
        { end: 400, limit: 20 },
        { end: 380, limit: 200 },
        { end: 380, limit: 20 },
      ])
      return
    }
    if (mode === "failure") {
      release.resolve()
      finish.resolve()
      await setup.waitForFrame((frame) => !frame.includes("Loading session history"))
      events.emit({
        id: "evt_live",
        created: 400,
        type: "session.inbox.enqueued",
        durable: { aggregateID: "ses_test", seq: 1, version: 1 },
        data: {
          sessionID: "ses_test",
          inboxID: "message-live",
          item: { type: "user", payload: { text: "Live message after failure" }, delivery: "steer" },
        },
      })
      await setup.waitForFrame((frame) => frame.includes("Live message after failure"))
      expect(mounted()).toHaveLength(21)
      setup.mockInput.pressKey("HOME")
      await setup.waitForFrame(
        (frame) => frame.includes("History message 0000") && !frame.includes("Loading session history"),
      )
      expect(mounted()).toHaveLength(60)
      return
    }
    if (mode === "up-cancel" || mode === "mouse-cancel") {
      if (mode === "up-cancel") setup.mockInput.pressKey("F6")
      if (mode === "mouse-cancel") await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
      await setup.waitForFrame(
        (frame) => frame.includes("Jump to latest") && !frame.includes("Loading session history"),
      )
      await setup.waitForVisualIdle()
      const cancelled = visible()
      release.resolve()
      finish.resolve()
      await setup.waitForVisualIdle({ quietFrames: 4 })
      expect(visible()).toBe(cancelled)
      expect(mounted()).toHaveLength(20)
      expect(pages).toHaveLength(2)
      return
    }
    if (mode.endsWith("cancel")) {
      setup.mockInput.pressKey(mode === "cancel" ? "END" : "F7")
      await setup.waitForFrame(
        (frame) =>
          frame.includes("History message 0399") &&
          !frame.includes("Loading session history") &&
          !frame.includes("Jump to latest"),
      )
      await setup.waitFor(() => scroll.scrollTop === maximum())
      expect(scroll.scrollTop).toBe(maximum())
      release.resolve()
      finish.resolve()
      await setup.waitForVisualIdle({ quietFrames: 4 })
      expect(scroll.scrollTop).toBe(maximum())
      expect(mounted()).toHaveLength(20)
      expect(pages).toHaveLength(2)
      expect(setup.captureCharFrame()).not.toContain("History message 0000")
      setup.renderer.off("frame", capture)
      setup.mockInput.pressKey("HOME")
    }
    if (!mode.endsWith("cancel")) {
      release.resolve()
      await setup.waitFor(() => pages.some((page) => page.end === 0))
      await setup.waitForVisualIdle()
      expect(frames).toEqual([before])
      finish.resolve()
    }
    await setup.waitForFrame(
      (frame) => frame.includes("History message 0000") && !frame.includes("Loading session history"),
    )
    await setup.waitForVisualIdle()
    if (!mode.endsWith("cancel")) expect(frames).toEqual([before, visible()])
    setup.renderer.off("frame", capture)
    expect(Math.max(...mountCounts)).toBeLessThanOrEqual(60)
    expect(mounted().map((child) => child.id)).toEqual(messages.slice(0, 60).map((message) => message.id))
    expect(scroll.scrollTop).toBe(0)
    expect(pages).toEqual([
      { end: 400, limit: 20 },
      ...(mode.endsWith("cancel") ? [{ end: 380, limit: 200 }] : []),
      { end: 380, limit: 200 },
      { end: 180, limit: 200 },
      { end: 0, limit: 200 },
    ])

    // Forward paging must reveal the cached middle, not stop at the bounded head.
    scroll.scrollTo(scroll.scrollHeight)
    await setup.waitForFrame((frame) => frame.includes("History message 0059"))
    setup.mockInput.pressKey("F7")
    await setup.waitForFrame((frame) => frame.includes("History message 0060"))
    expect(mounted().map((child) => child.id)).toEqual(messages.slice(0, 120).map((message) => message.id))
    setup.mockInput.pressKey("F8")
    await setup.waitForFrame(
      (frame) => frame.includes("History message 0059") && !frame.includes("History message 0060"),
    )

    setup.mockInput.pressKey("END")
    await setup.waitForFrame((frame) => frame.includes("History message 0399") && !frame.includes("Jump to latest"))
    await setup.waitFor(() => scroll.scrollTop === maximum())
    expect(scroll.scrollTop).toBe(maximum())
    setup.mockInput.pressKey("HOME")
    await setup.waitForFrame(
      (frame) => frame.includes("History message 0000") && !frame.includes("Loading session history"),
    )
    setup.mockInput.pressKey("HOME")
    await setup.waitForVisualIdle()
    expect(scroll.scrollTop).toBe(0)
    expect(mounted()).toHaveLength(60)
    expect(pages).toHaveLength(mode.endsWith("cancel") ? 5 : 4)
  } finally {
    prior.resolve()
    release.resolve()
    finish.resolve()
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
