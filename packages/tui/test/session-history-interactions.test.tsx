import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { TestRecorder } from "@opentui/core/testing"
import type { SessionMessageInfo } from "@opencode/client"
import { mkdir } from "node:fs/promises"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"

const modes = [
  "waiting",
  "streaming",
  "stream-race",
  "streaming-bottom",
  "resize",
  "tab",
  "tab-publish",
  "end",
  "end-publish",
  "home",
  "home-publish",
  "failure",
  "reconnect",
  "close",
  "group-boundary",
  "merged-boundary",
  "disclosure",
] as const

// These whole-app cases share the package's budget for a cold app import and reconnect.
test.each(modes.flatMap((mode) => [100, 48].map((width) => ({ mode, width }))))(
  "pending history preserves the reader: $mode, $width columns",
  async ({ mode, width }) => {
    await using state = await tmpdir()
    const session = {
      id: "ses_history_interactions",
      title: "History interactions",
      projectID: "project",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const other = { ...session, id: "ses_history_other", title: "Other session" }
    const id = (turn: number, role: number) => `msg_${String(turn).padStart(6, "0")}_${role}`
    const messages: SessionMessageInfo[] = Array.from({ length: 60 }, (_, turn) => [
      { type: "user" as const, id: id(turn, 0), text: `History prompt ${turn}`, time: { created: turn * 10 } },
      {
        type: "assistant" as const,
        id: id(turn, 1),
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        finish: "stop" as const,
        time: { created: turn * 10 + 1, completed: turn * 10 + 2 },
        content:
          ["group-boundary", "merged-boundary", "disclosure"].includes(mode) && turn >= 30 && turn <= 40
            ? [
                {
                  type: "reasoning" as const,
                  text: `**History thought ${turn}**\n\nThought body ${turn}`,
                  time: { created: turn * 10 + 1, completed: turn * 10 + 2 },
                },
              ]
            : [{ type: "text" as const, text: `History answer ${turn}` }],
      },
    ])
      .flat()
      .filter(
        (message) =>
          mode !== "merged-boundary" ||
          message.type !== "user" ||
          Number(message.id.split("_")[1]) < 30 ||
          Number(message.id.split("_")[1]) > 40,
      )
    await mkdir(`${state.path}/test/tui`, { recursive: true })
    await Bun.write(
      `${state.path}/test/tui/tabs.json`,
      JSON.stringify({
        global: { tabs: [{ sessionID: session.id }, { sessionID: other.id }], unread: {} },
        cwd: {},
      }),
    )
    const release = Promise.withResolvers<void>()
    const requested = Promise.withResolvers<void>()
    const reconnected = Promise.withResolvers<void>()
    const rejected = Promise.withResolvers<void>()
    const pages: number[] = []
    let initial = 0
    let failed = false
    await using app = await createAppFixture({
      width,
      height: 30,
      state: state.path,
      args: { sessionID: session.id },
      config: { animations: false, tabs: { enabled: true, scope: "global" } },
      fetch: async (url) => {
        if (url.pathname === "/api/session") return json({ data: [session, other], cursor: {} })
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${other.id}`) return json({ data: other })
        if (url.pathname === `/api/session/${other.id}/message`)
          return json({
            data: [{ type: "user", id: "msg_other", text: "OTHER SESSION MARKER", time: { created: 0 } }],
            cursor: {},
          })
        if (url.pathname === `/api/session/${session.id}/message`) {
          const cursor = url.searchParams.get("cursor")
          const end = Number(cursor ?? messages.length)
          const start = cursor
            ? Math.max(0, end - Number(url.searchParams.get("limit")))
            : mode === "merged-boundary"
              ? 70
              : mode === "group-boundary" || mode === "disclosure"
                ? 81
                : 80
          if (!cursor) {
            initial++
            if (initial > 1) reconnected.resolve()
          }
          if (cursor) {
            pages.push(end)
            requested.resolve()
            await release.promise
            if (mode === "failure" && !failed) {
              failed = true
              rejected.resolve()
              return json({ message: "fixture offline" }, { status: 503 })
            }
          }
          return json({ data: messages.slice(start, end).toReversed(), cursor: start ? { next: String(start) } : {} })
        }
        if (url.pathname.endsWith("/inbox") || url.pathname.endsWith("/permission")) return json({ data: [] })
      },
    })
    const find = (node: Renderable): ScrollBoxRenderable | undefined =>
      node instanceof ScrollBoxRenderable && node.getRenderable(id(59, 0))
        ? node
        : node.getChildren().map(find).find(Boolean)
    const anchor = () =>
      app
        .captureCharFrame()
        .split("\n")
        .flatMap((line, y) => {
          const match = line.match(/History prompt \d+/)
          return match ? [{ text: match[0], y }] : []
        })[0]
    const stream = () =>
      app.events.emit({
        id: "evt_history_stream",
        created: 1000,
        type: "session.text.delta",
        data: {
          sessionID: session.id,
          assistantMessageID: id(59, 1),
          ordinal: 0,
          delta: "\nSTREAM ONE\nSTREAM TWO\nSTREAM THREE\nSTREAM FOUR",
        },
      })
    try {
      await app.ready
      await waitForHighlightedFrame(app, (frame) => frame.includes("History answer 59"))
      await app.waitForVisualIdle({ quietFrames: 3 })
      const scroll = find(app.renderer.root)
      if (!scroll) throw new Error("Missing transcript")
      for (let tick = 0; tick < 300 && (pages.length === 0 || scroll.scrollTop > scroll.viewport.height); tick++) {
        await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
        await app.renderOnce()
      }
      await requested.promise
      if (mode === "disclosure" || mode === "merged-boundary") {
        for (let tick = 0; tick < 300 && !app.captureCharFrame().includes("Thought:"); tick++) {
          await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
          await app.renderOnce()
        }
        await waitForHighlightedFrame(app, (frame) => frame.includes("Thought:"))
      }
      await app.waitForVisualIdle({ quietFrames: 3 })
      const before = anchor()
      expect(before).toBeDefined()
      const recorder = new TestRecorder(app.renderer)
      recorder.rec()
      const thoughtLine = () =>
        app
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Thought") && !line.includes("Thought body"))
      const thought = thoughtLine()

      if (mode === "close") {
        app.renderer.destroy()
        release.resolve()
        return
      }
      if (mode === "resize") {
        app.resize(width === 100 ? 48 : 100, 24)
        await app.waitForVisualIdle({ quietFrames: 3 })
      }
      if (mode === "disclosure") {
        await app.mockMouse.click(8, thought)
        await waitForHighlightedFrame(app, (frame) => frame.includes("Thought body 40"))
        expect(thoughtLine()).toBe(thought)
      }
      if (mode === "streaming") {
        const height = scroll.scrollHeight
        stream()
        await app.waitForFrame(() => scroll.scrollHeight > height)
        expect(anchor()).toEqual(before)
      }
      if (mode === "tab") {
        app.mockInput.pressKey("2", { ctrl: true })
        await app.waitForFrame((frame) => frame.includes("OTHER SESSION MARKER"))
      }
      if (mode === "end" || mode === "streaming-bottom") {
        app.mockInput.pressKey("END")
        await waitForHighlightedFrame(app, (frame) => frame.includes("History answer 59"))
        if (mode === "streaming-bottom") {
          stream()
          await waitForHighlightedFrame(app, (frame) => frame.includes("STREAM FOUR"))
        }
      }
      if (mode === "home") app.mockInput.pressKey("HOME")
      if (mode === "reconnect") {
        app.events.disconnect()
        await reconnected.promise
        await app.waitForVisualIdle({ quietFrames: 3 })
      }
      const held = anchor()
      let navigatedOnPublish = false
      if (mode.endsWith("-publish")) {
        const afterLayout = scroll.afterLayout.bind(scroll)
        scroll.afterLayout = (continuation) => {
          afterLayout(continuation)
          if (navigatedOnPublish) return
          navigatedOnPublish = true
          if (mode === "tab-publish") app.mockInput.pressKey("2", { ctrl: true })
          if (mode !== "tab-publish") app.mockInput.pressKey(mode === "end-publish" ? "END" : "HOME")
        }
      }
      release.resolve()
      if (mode === "stream-race") stream()
      if (mode === "failure") {
        await rejected.promise
        await app.waitForVisualIdle({ quietFrames: 3 })
        expect(anchor()).toEqual(held)
        for (let tick = 0; tick < 100 && pages.length < 2; tick++) {
          await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
          await app.renderOnce()
        }
      }
      if (mode === "tab" || mode === "tab-publish") {
        await app.waitForFrame((frame) => frame.includes("OTHER SESSION MARKER"))
        await app.waitForVisualIdle({ quietFrames: 3 })
        expect(app.captureCharFrame()).toContain("OTHER SESSION MARKER")
        expect(app.captureCharFrame()).not.toContain("History prompt")
        app.mockInput.pressKey("1", { ctrl: true })
        await app.waitForFrame((frame) => frame.includes(before!.text))
      }
      if (mode === "home" || mode === "home-publish") {
        await app.waitForFrame(
          (frame) => frame.includes("History prompt 0") && !frame.includes("Loading session history"),
        )
      }
      if (!["home", "home-publish", "reconnect", "end", "end-publish", "streaming-bottom"].includes(mode))
        await app.waitFor(() => !!find(app.renderer.root)?.getRenderable(id(mode === "merged-boundary" ? 25 : 30, 0)))
      await app.waitForVisualIdle({ quietFrames: 3 })
      recorder.stop()
      if (["waiting", "streaming", "stream-race", "group-boundary", "merged-boundary"].includes(mode)) {
        expect(anchor()).toEqual(before)
        expect(
          recorder.recordedFrames.every((sample) => {
            const lines = sample.frame.split("\n")
            return lines[before!.y]?.includes(before!.text)
          }),
        ).toBe(true)
      }
      if (mode === "resize") expect(anchor()).toEqual(held)
      if (mode === "disclosure") {
        expect(thoughtLine()).toBe(thought)
        expect(app.captureCharFrame()).toContain("Thought body 40")
        expect(recorder.recordedFrames.every((sample) => sample.frame.split("\n")[thought]?.includes("Thought"))).toBe(
          true,
        )
      }
      if (mode === "tab" || mode === "tab-publish") expect(anchor()).toEqual(before)
      if (mode === "end" || mode === "end-publish" || mode === "streaming-bottom") {
        const current = find(app.renderer.root)!
        expect(current.scrollTop).toBe(Math.max(0, current.scrollHeight - current.viewport.height))
        expect(app.captureCharFrame()).not.toContain("Jump to latest")
      }
      if (mode.endsWith("-publish")) expect(navigatedOnPublish).toBe(true)
      if (mode === "group-boundary" || mode === "disclosure") expect(pages).toEqual([81, 61])
      if (mode === "merged-boundary") expect(pages).toEqual([70])
      if (mode === "failure") expect(pages).toEqual([80, 80])
      if (mode === "reconnect") {
        expect(initial).toBeGreaterThanOrEqual(2)
        expect(app.captureCharFrame()).not.toContain("Unable to connect")
        app.mockInput.pressKey("END")
        await waitForHighlightedFrame(app, (frame) => frame.includes("History answer 59"))
      }
    } finally {
      release.resolve()
    }
  },
  30000,
)
