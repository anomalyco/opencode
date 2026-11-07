import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { directory, json } from "./fixture/tui-client"

test.each([
  { label: "default", keybinds: {}, down: "\u001b[6~", up: "\u001b[5~" },
  { label: "custom", keybinds: { "session.page.down": "f7", "session.page.up": "f8" }, down: "F7", up: "F8" },
])("$label page keys scroll the side answer without closing it", async ({ keybinds, down, up }) => {
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: "ses_btw",
    title: "Side question",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = Array.from({ length: 30 }, (_, i) => ({
    id: `message-${i}`,
    type: "user",
    text: `History message ${i}`,
    time: { created: i },
  }))
  await using setup = await createAppFixture({
    args: { sessionID: session.id },
    config: { animations: false, keybinds },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/generate`)
        return json({ data: { text: Array.from({ length: 60 }, (_, i) => `Answer line ${i + 1}`).join("\n\n") } })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("History message 29"))
  await setup.mockInput.typeText("/btw test question")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("test question") && frame.includes("copy"))
  await waitForHighlightedFrame(setup, (frame) => frame.includes("Answer line 1"))

  // The answer's scrollbox contains the rendered response, not the session transcript.
  const findAnswer = (node: Renderable): ScrollBoxRenderable | undefined => {
    if (node instanceof ScrollBoxRenderable && node.scrollHeight > node.viewport.height) {
      if (node.getChildren().some((child) => child.id !== undefined)) return node
    }
    return node.getChildren().toReversed().map(findAnswer).find(Boolean)
  }
  const answer = findAnswer(setup.renderer.root)
  if (!answer) throw new Error("Answer scrollbox not found")
  setup.mockInput.pressKey(down)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("test question")
  expect(answer.scrollTop).toBeGreaterThan(0)
  setup.mockInput.pressKey(up)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("test question")
  expect(answer.scrollTop).toBe(0)
  if (down === "F7") {
    setup.mockInput.pressKey("\u001b[6~")
    await setup.renderOnce()
    expect(answer.scrollTop).toBeGreaterThan(0)
  }
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("test question"))
  setup.mockInput.pressKey(up)
  await setup.waitForFrame((frame) => !frame.includes("History message 29"))
  expect(setup.captureCharFrame()).toContain("History message")
})
