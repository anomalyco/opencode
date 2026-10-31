import { expect, test } from "bun:test"
import { InputRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each([60, 120])("subagent transcript navigation at width %s", async (width) => {
  const sessions = [
    { id: "parent", title: "Parent" },
    { id: "child", title: "Child", parentID: "parent" },
    { id: "sibling", title: "Sibling", parentID: "parent" },
  ].map((session) => ({
    ...session,
    agent: "build",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }))
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `History message ${String(index).padStart(4, "0")}`,
    time: { created: index },
  }))
  await using setup = await createAppFixture({
    width,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: "child" },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
      if (url.pathname === "/api/session/active")
        return json({ data: { child: { type: "running" }, sibling: { type: "running" } } })
      const session = sessions.find((session) => url.pathname === `/api/session/${session.id}`)
      if (session) return json({ data: session })
      const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/)?.[1]
      if (sessionID)
        return json({
          data: messages.map((message) => ({ ...message, text: `${sessionID} ${message.text}` })).toReversed(),
          cursor: {},
        })
      if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("History message 0019") && frame.includes("Subagents"))
  const scroll = findTranscript(setup.renderer.root)
  if (!scroll) throw new Error("Session transcript not found")
  expect(scroll.scrollTop).toBeGreaterThan(0)

  const bottom = scroll.scrollTop
  // MockInput has no named PageUp/PageDown constants; send their terminal sequences.
  await setup.mockInput.pressKeys(["\x1b[5~"])
  await setup.waitFor(() => scroll.scrollTop < bottom)

  setup.mockInput.pressKey("HOME")
  await setup.waitForFrame((frame) => frame.includes("History message 0000"))
  expect(scroll.scrollTop).toBe(0)

  await setup.mockInput.pressKeys(["\x1b[6~"])
  await setup.waitFor(() => scroll.scrollTop > 0)
  const paged = scroll.scrollTop
  await setup.mockInput.pressKeys(["\x1b[5~"])
  await setup.waitFor(() => scroll.scrollTop < paged)

  setup.mockInput.pressKey("END")
  await setup.waitForFrame((frame) => frame.includes("History message 0019"))
  await setup.waitFor(() => scroll.scrollTop === scroll.scrollHeight - scroll.viewport.height)
  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("History message 0000"))
  expect(scroll.scrollTop).toBe(0)

  await setup.mockInput.pressKeys(["\x1b[6~"])
  await setup.waitFor(() => scroll.scrollTop > 0)
  setup.mockInput.pressKey("o", { ctrl: true })
  await setup.waitForFrame(
    (frame) => frame.includes("Search sessions") && setup.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  const beforeDialog = scroll.scrollTop
  setup.mockInput.pressKey("END")
  await setup.waitForVisualIdle({ quietFrames: 3 })
  expect(scroll.scrollTop).toBe(beforeDialog)
  expect(setup.captureCharFrame()).toContain("Search sessions")
  setup.mockInput.pressKey("HOME")
  await setup.waitForVisualIdle({ quietFrames: 3 })
  expect(scroll.scrollTop).toBe(beforeDialog)
  expect(setup.captureCharFrame()).toContain("Search sessions")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Search sessions"))

  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("sibling History message 0019"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => frame.includes("parent History message 0019"))
  setup.mockInput.pressKey("HOME")
  await setup.waitForFrame((frame) => frame.includes("parent History message 0000"))
  setup.mockInput.pressKey("END")
  await setup.waitForFrame((frame) => frame.includes("parent History message 0019"))
})

function findTranscript(root: Renderable): ScrollBoxRenderable | undefined {
  if (root instanceof ScrollBoxRenderable && root.getRenderable("message-19")) return root
  return root.getChildren().map(findTranscript).find(Boolean)
}
