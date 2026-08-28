import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each(["bottom", "scrolled", "cancel", "scroll-cancel", "up-cancel", "mouse-cancel", "failure"])(
  "Home loads a stable, bounded beginning (%s)",
  async (mode) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const session = {
      id: "dummy",
      title: "Long history",
      projectID: "project",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const messages = Array.from({ length: 400 }, (_, index) => ({
      id: `message-${index}`,
      type: "user",
      text: `History message ${String(index).padStart(4, "0")}`,
      time: { created: index },
    }))
    const pages: { end: number; limit: number }[] = []
    const release = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const events = createEventStream()
    const calls = createFetch(async (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/session/dummy") return json({ data: session })
      if (url.pathname === "/api/session/dummy/message") {
        const end = Number(url.searchParams.get("cursor") ?? messages.length)
        const limit = Number(url.searchParams.get("limit"))
        const start = Math.max(0, end - limit)
        pages.push({ end, limit })
        if (end < messages.length) await release.promise
        if (end === 0) await finish.promise
        if (mode === "failure" && end === 0 && pages.filter((page) => page.end === 0).length === 1)
          return json({ message: "offline" }, { status: 503 })
        return json({ data: messages.slice(start, end).toReversed(), cursor: end ? { next: String(start) } : {} })
      }
      if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
      if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
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
            keybinds: { "session.line.up": "f6", "session.page.down": "f7", "session.page.up": "f8" },
          }),
          update: async () => ({}),
        },
        packages: { resolve: async () => undefined },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        args: { sessionID: "dummy" },
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
      const mounted = () => scroll.getChildren().filter((child) => child.id.startsWith("message-"))
      const maximum = () => Math.max(0, scroll.scrollHeight - scroll.viewport.height)
      if (mode === "scrolled" || mode === "cancel") {
        setup.mockInput.pressKey("F6")
        await setup.waitForFrame((frame) => frame.includes("Jump to latest"))
      }
      await setup.waitForVisualIdle()
      const visible = () =>
        JSON.stringify(
          setup
            .captureCharFrame()
            .split("\n")
            .flatMap((line, y) => (line.includes("History message") ? [{ line: line.trimEnd(), y }] : [])),
        )
      const before = visible()
      const frames = [before]
      const mountCounts: number[] = []
      const capture = () => {
        if (visible() !== frames.at(-1)) frames.push(visible())
        mountCounts.push(mounted().length)
      }
      setup.renderer.on("frame", capture)

      setup.mockInput.pressKey("HOME")
      await setup.waitForFrame((frame) => frame.includes("Loading session history..."))
      setup.mockInput.pressKey("HOME")
      await setup.waitForVisualIdle()
      expect(pages).toEqual([
        { end: 400, limit: 20 },
        { end: 380, limit: 200 },
      ])
      expect(frames).toEqual([before])

      if (mode === "failure") {
        release.resolve()
        finish.resolve()
        await setup.waitForFrame((frame) => !frame.includes("Loading session history"))
        events.emit({
          id: "evt_live",
          created: 400,
          type: "session.inbox.enqueued",
          durable: { aggregateID: "dummy", seq: 1, version: 1 },
          data: {
            sessionID: "dummy",
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
      release.resolve()
      finish.resolve()
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      await task.finally(() => server.stop(true))
    }
  },
)
