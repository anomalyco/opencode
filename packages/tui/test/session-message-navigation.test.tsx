import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

test("user message navigation follows the visible scroll position after scrolling", async () => {
  const session = {
    id: "ses_message_navigation",
    title: "Message navigation",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages: SessionMessageInfo[] = []
  for (let turn = 0; turn < 16; turn++) {
    messages.push({ type: "user", id: `msg_user_${turn}`, text: `Prompt ${turn}`, time: { created: turn * 10 } })
    messages.push({
      type: "assistant",
      id: `msg_assistant_${turn}`,
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: turn * 10 + 1, completed: turn * 10 + 2 },
      content: [
        {
          type: "text",
          text:
            turn === 15
              ? "Answer 15\nEnd 15"
              : `Answer ${turn}\n${"A response line.\n".repeat(8)}End ${turn}`,
        },
      ],
    })
  }

  await using app = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: session.id },
    config: {
      animations: false,
      session: { scrollbar: true },
      keybinds: {
        "session.message.user.previous": "ctrl+shift+p",
        "session.message.user.next": "ctrl+shift+n",
      },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    },
  })

  await app.ready
  await waitForHighlightedFrame(app, (frame) => frame.includes("End 15"))
  await app.waitForVisualIdle({ quietFrames: 3 })

  const find = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable && node.getRenderable("msg_user_15")
      ? node
      : node.getChildren().map(find).find(Boolean)
  const scroll = find(app.renderer.root)
  if (!scroll) throw new Error("Missing transcript scrollbox")

  const promptLine = () => {
    const lines = app.captureCharFrame().split("\n")
    return lines.flatMap((line, y) => {
      const match = line.match(/Prompt (\d+)/)
      return match && y >= scroll.viewport.y ? [{ turn: Number(match[1]), y }] : []
    })[0]
  }
  const position = async (turn: number) => {
    const node = scroll.getRenderable(`msg_user_${turn}`)
    if (!node) throw new Error(`Missing prompt renderable ${turn}`)
    scroll.scrollTo(scroll.scrollTop + node.y - scroll.viewport.y + 2)
    await app.waitForVisualIdle({ quietFrames: 3 })
  }
  const wheel = async () => {
    await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "down")
    await app.waitForVisualIdle({ quietFrames: 3 })
  }
  const previous = async () => {
    app.mockInput.pressKey("p", { ctrl: true, shift: true })
    await app.waitForVisualIdle({ quietFrames: 3 })
  }
  const next = async () => {
    app.mockInput.pressKey("n", { ctrl: true, shift: true })
    await app.waitForVisualIdle({ quietFrames: 3 })
  }

  // Walk the navigation cursor up through earlier prompts, then scroll away with the wheel.
  for (let step = 0; step < 8; step++) await previous()

  await position(13)
  await wheel()
  expect(promptLine()?.turn).toBe(14)
  await next()
  expect(promptLine()?.turn).toBe(14)

  await position(12)
  await wheel()
  expect(promptLine()?.turn).toBe(13)
  await previous()
  expect(promptLine()?.turn).toBe(12)

  // Pressing the scrollbar track is a reader scroll too.
  const track = scroll._scrollState().bars[1].track
  await app.mockMouse.click(track.x, track.y)
  await app.waitForVisualIdle({ quietFrames: 3 })
  expect(promptLine()?.turn).toBe(0)
  await previous()
  expect(promptLine()?.turn).toBe(0)

  // The last prompt adds bottom slack so it can reach the top. Scrolling must not
  // remove that slack while the viewport still sits inside it, which would clamp down.
  app.mockInput.pressKey("END")
  await app.waitForVisualIdle({ quietFrames: 3 })
  await previous()
  await next()
  const slack = () => scroll.getRenderable("session-navigation-slack")?.height ?? 0
  expect(slack()).toBeGreaterThan(0)
  let lastTop = scroll.scrollTop
  await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
  await app.waitForVisualIdle({ quietFrames: 3 })
  // A wheel step smaller than the slack must move the viewport, not clear the slack and clamp it.
  expect(slack()).toBeGreaterThan(0)
  expect(scroll.scrollTop).toBeLessThanOrEqual(lastTop)
  lastTop = scroll.scrollTop
  for (let step = 0; step < 20 && slack() > 0; step++) {
    await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
    await app.waitForVisualIdle({ quietFrames: 2 })
    expect(scroll.scrollTop).toBeLessThanOrEqual(lastTop)
    lastTop = scroll.scrollTop
  }
  expect(slack()).toBe(0)
})
