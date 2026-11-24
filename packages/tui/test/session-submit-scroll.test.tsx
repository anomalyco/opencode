import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test.each([
  { setting: undefined, kept: false },
  { setting: "keep" as const, kept: true },
])("sending a prompt while scrolled up with session.submit_scroll $setting", async ({ setting, kept }) => {
  const sessionID = "ses_submit_scroll"
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `History message ${String(index).padStart(4, "0")}`,
    time: { created: index },
  }))
  const prompted = Promise.withResolvers<string>()
  await using app = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" }, session: { submit_scroll: setting } },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Submit scroll fixture",
            agent: "build",
            model: { providerID: "demo", id: "model" },
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = await request.json()
        prompted.resolve(body.id)
        return json({
          data: { id: body.id, sessionID, type: "user", time: { created: 100 }, payload: { text: body.text } },
        })
      }
      return undefined
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("History message 0039") && frame.includes("Demo Model"))
  const find = (root: Renderable): ScrollBoxRenderable | undefined =>
    root instanceof ScrollBoxRenderable && root.getRenderable("message-39")
      ? root
      : root.getChildren().map(find).find(Boolean)
  const scroll = find(app.renderer.root)
  if (!scroll) throw new Error("Session scrollbox not found")
  for (let tick = 0; tick < 3; tick++) await app.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
  await app.waitForFrame((frame) => frame.includes("Jump to latest"))
  await app.waitForVisualIdle({ quietFrames: 3 })
  const before = scroll.scrollTop
  expect(before).toBeLessThan(scroll.scrollHeight - scroll.viewport.height)

  await app.mockInput.typeText("Follow-up prompt")
  app.mockInput.pressEnter()
  const id = await prompted.promise
  await app.waitFor(() => !!scroll.getRenderable(id))
  // Outlasts the delayed jump to the bottom, which starts when the prompt is sent.
  await app.waitForVisualIdle({ quietFrames: 3 })

  if (kept) {
    expect(scroll.scrollTop).toBe(before)
    expect(app.captureCharFrame()).toContain("Jump to latest")
    return
  }
  expect(scroll.scrollTop).toBe(Math.max(0, scroll.scrollHeight - scroll.viewport.height))
  expect(app.captureCharFrame()).toContain("Follow-up prompt")
  expect(app.captureCharFrame()).not.toContain("Jump to latest")
})
