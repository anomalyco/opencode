import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

test.each([44, 100])("message navigation preserves the tail-window anchor at width %s", async (width) => {
  const session = {
    id: "ses_navigation_window",
    title: "Navigation window",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages: SessionMessageInfo[] = Array.from({ length: 30 }, (_, index) => [
    { type: "user" as const, id: `user-${index}`, text: `Prompt ${index}`, time: { created: index * 10 } },
    {
      type: "assistant" as const,
      id: `answer-${index}`,
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop" as const,
      time: { created: index * 10 + 1, completed: index * 10 + 2 },
      content: [{ type: "text" as const, text: `Reply ${index}\n\n${"A line of the response.\n".repeat(6)}` }],
    },
  ]).flat()
  await using setup = await createAppFixture({
    width,
    height: 30,
    args: { sessionID: session.id },
    config: {
      animations: false,
      tabs: { enabled: false },
      keybinds: {
        "session.message.user.previous": "ctrl+shift+p",
        "session.message.user.next": "ctrl+shift+n",
        "session.last": "ctrl+shift+b",
        "session.line.up": "F6",
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
  await setup.ready
  await waitForHighlightedFrame(setup, (frame) => frame.includes("Reply 29"))
  const find = (node: Renderable): ScrollBoxRenderable | undefined =>
    node instanceof ScrollBoxRenderable && node.getRenderable("user-29")
      ? node
      : node.getChildren().map(find).find(Boolean)
  const scroll = find(setup.renderer.root)
  if (!scroll) throw new Error("Missing transcript scrollbox")
  expect(scroll.getRenderable("user-0") !== undefined).toBe(false)
  const anchor = scroll.getRenderable("user-28")
  if (!anchor) throw new Error("Missing mounted prompt 28")
  scroll.scrollTo(scroll.scrollTop + anchor.y - scroll.viewport.y + 1)
  await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
  scroll.scrollTo(scroll.scrollTop + anchor.y - scroll.viewport.y + 1)
  await setup.waitForFrame(() => anchor.y === scroll.viewport.y - 1)
  setup.mockInput.pressKey("p", { ctrl: true, shift: true })
  await setup.waitForFrame(() => scroll.getRenderable("user-0") !== undefined)
  await setup.waitForFrame(() => scroll.getRenderable("user-28")?.y === scroll.viewport.y)
  expect(scroll.getRenderable("user-28")?.y).toBe(scroll.viewport.y)
  setup.mockInput.pressKey("p", { ctrl: true, shift: true })
  await setup.waitForFrame(() => scroll.getRenderable("user-27")?.y === scroll.viewport.y)
  setup.mockInput.pressKey("n", { ctrl: true, shift: true })
  await setup.waitForFrame(() => scroll.getRenderable("user-28")?.y === scroll.viewport.y)
  setup.mockInput.pressKey("b", { ctrl: true, shift: true })
  await setup.waitForFrame(
    () => !scroll.getRenderable("user-0") && scroll.scrollTop === scroll.scrollHeight - scroll.viewport.height,
  )
  expect(scroll.getRenderable("user-28")!.y).toBeLessThan(scroll.viewport.y)
  expect(scroll.getRenderable("user-29")!.y).toBeGreaterThan(scroll.viewport.y)
  setup.mockInput.pressKey("p", { ctrl: true, shift: true })
  await setup.waitForFrame(() => scroll.getRenderable("user-28")?.y === scroll.viewport.y)
  setup.mockInput.pressKey("b", { ctrl: true, shift: true })
  await setup.waitForFrame(
    () => !scroll.getRenderable("user-0") && scroll.scrollTop === scroll.scrollHeight - scroll.viewport.height,
  )
  scroll.scrollTo(scroll.scrollTop + anchor.y - scroll.viewport.y + 1)
  await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
  scroll.scrollTo(scroll.scrollTop + anchor.y - scroll.viewport.y + 1)
  await setup.waitForFrame(() => anchor.y === scroll.viewport.y - 1)
  // Keep mounting pending while a manual scroll cancels the requested jump.
  setup.renderer.pause()
  setup.mockInput.pressKey("p", { ctrl: true, shift: true })
  setup.mockInput.pressKey("F6")
  setup.mockInput.pressKey("F6")
  for (let index = 0; index < 8; index++) await setup.renderOnce()
  expect(anchor.y).toBe(scroll.viewport.y + 1)
})
