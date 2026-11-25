import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { mkdir } from "node:fs/promises"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_message_navigation",
  title: "Message navigation",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const other = { ...session, id: "ses_message_navigation_other", title: "Other session" }
const model = { providerID: "fixture", id: "fixture" }
// Each prompt is tall enough that the transcript scrolls and one message sits at the viewport edge.
const messages: SessionMessageInfo[] = Array.from({ length: 10 }, (_, index) => [
  {
    type: "user" as const,
    id: `user-${index}`,
    text: `Message ${String(index).padStart(2, "0")}\nbody one\nbody two\nbody three`,
    time: { created: index * 10 },
  },
  {
    type: "assistant" as const,
    id: `assistant-${index}`,
    agent: "build",
    model,
    finish: "stop" as const,
    time: { created: index * 10 + 1, completed: index * 10 + 2 },
    content: [{ type: "text" as const, text: `Reply ${index}` }],
  },
]).flat()

type App = Awaited<ReturnType<typeof createAppFixture>>
type Scroll = () => ScrollBoxRenderable

async function withTabs(run: (app: App, scroll: Scroll) => Promise<void>) {
  await using state = await tmpdir()
  await mkdir(`${state.path}/test/tui`, { recursive: true })
  await Bun.write(
    `${state.path}/test/tui/tabs.json`,
    JSON.stringify({
      global: { tabs: [{ sessionID: session.id }, { sessionID: other.id }], unread: {} },
      cwd: {},
    }),
  )
  await using app = await createAppFixture({
    width: 100,
    height: 30,
    state: state.path,
    args: { sessionID: session.id },
    config: {
      animations: false,
      tabs: { enabled: true, scope: "global" },
      keybinds: {
        "session.messages_last_user": "ctrl+shift+l",
        "session.message.user.previous": "ctrl+shift+u",
        "session.message.user.next": "ctrl+shift+n",
      },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session, other], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${other.id}`) return json({ data: other })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${other.id}/message`)
        return json({
          data: [{ type: "user", id: "msg_other", text: "Other session marker", time: { created: 0 } }],
          cursor: {},
        })
      if (url.pathname.endsWith("/inbox") || url.pathname.endsWith("/permission")) return json({ data: [] })
    },
  })
  await app.ready
  await waitForHighlightedFrame(app, (frame) => frame.includes("Message 09"))
  await app.waitForVisualIdle({ quietFrames: 3 })
  const scroll: Scroll = () => {
    const find = (node: Renderable): ScrollBoxRenderable | undefined =>
      node instanceof ScrollBoxRenderable && node.getRenderable("user-0")
        ? node
        : node.getChildren().map(find).find(Boolean)
    const value = find(app.renderer.root)
    if (!value) throw new Error("Missing transcript scrollbox")
    return value
  }
  await run(app, scroll)
}

const rowOf = (app: App, text: string) =>
  app
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes(text))

const topPrompt = (app: App, scroll: Scroll) => {
  const lines = app.captureCharFrame().split("\n")
  for (let y = scroll().viewport.y; y < lines.length; y++) {
    const match = lines[y]?.match(/Message (\d+)/)
    if (match) return Number(match[1])
  }
  return -1
}

const previous = async (app: App) => {
  app.mockInput.pressKey("u", { ctrl: true, shift: true })
  await app.waitForVisualIdle({ quietFrames: 3 })
}

const next = async (app: App) => {
  app.mockInput.pressKey("n", { ctrl: true, shift: true })
  await app.waitForVisualIdle({ quietFrames: 3 })
}

const jumpToFifth = async (app: App, scroll: Scroll) => {
  // Start from the last user message so the setup does not depend on the viewport fallback.
  app.mockInput.pressKey("l", { ctrl: true, shift: true })
  await app.waitForVisualIdle({ quietFrames: 3 })
  for (let step = 0; step < 5; step++) await previous(app)
  await waitForHighlightedFrame(app, (frame) => frame.includes("Message 04"))
  expect(rowOf(app, "Message 04")).toBe(scroll().viewport.y + 1)
}

const switchAwayAndBack = async (app: App) => {
  app.mockInput.pressKey("2", { ctrl: true })
  await app.waitForFrame((frame) => frame.includes("Other session marker"))
  app.mockInput.pressKey("1", { ctrl: true })
  await app.waitForVisualIdle({ quietFrames: 3 })
}

const wheel = async (app: App, scroll: Scroll, direction: "up" | "down") => {
  await app.mockMouse.scroll(scroll().viewport.x + 2, scroll().viewport.y + 2, direction)
  await app.waitForVisualIdle({ quietFrames: 3 })
}

const nudge = async (app: App, scroll: Scroll, delta: number) => {
  scroll().scrollTo(Math.max(0, scroll().scrollTop + delta))
  await app.waitForVisualIdle({ quietFrames: 3 })
}

test("previous user message steps from the restored current message after a tab switch", async () => {
  await withTabs(async (app, scroll) => {
    await jumpToFifth(app, scroll)
    // Move the viewport edge into the fifth prompt, so the viewport fallback would repeat it.
    await nudge(app, scroll, 2)
    await switchAwayAndBack(app)
    await waitForHighlightedFrame(app, (frame) => frame.includes("Reply 4"))

    await previous(app)
    await waitForHighlightedFrame(app, (frame) => frame.includes("Message 03"))
    expect(rowOf(app, "Message 03")).toBe(scroll().viewport.y + 1)
  })
}, 30000)

test("next user message steps from the restored current message after a tab switch", async () => {
  await withTabs(async (app, scroll) => {
    await jumpToFifth(app, scroll)
    // Move the viewport edge above the fifth prompt, so the viewport fallback would return it.
    await nudge(app, scroll, -2)
    await switchAwayAndBack(app)
    await waitForHighlightedFrame(app, (frame) => frame.includes("Message 04"))

    await next(app)
    await waitForHighlightedFrame(app, (frame) => frame.includes("Message 05"))
    expect(rowOf(app, "Message 05")).toBe(scroll().viewport.y + 1)
  })
}, 30000)

test("scrolling clears the remembered message before a tab switch", async () => {
  await withTabs(async (app, scroll) => {
    await jumpToFifth(app, scroll)

    const node = scroll().getRenderable("user-8")
    if (!node) throw new Error("Missing prompt renderable 8")
    scroll().scrollTo(scroll().scrollTop + node.y - scroll().viewport.y + 2)
    await app.waitForVisualIdle({ quietFrames: 3 })
    await wheel(app, scroll, "down")

    await switchAwayAndBack(app)
    await previous(app)
    await app.waitForVisualIdle({ quietFrames: 3 })

    // The cached fifth would have moved to Message 03. After a scroll, navigation follows the viewport.
    expect(topPrompt(app, scroll)).toBeGreaterThan(3)
  })
}, 30000)
