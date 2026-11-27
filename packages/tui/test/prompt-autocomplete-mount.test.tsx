import { expect, test } from "bun:test"
import { TextBufferRenderable, type Renderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("the hidden autocomplete popup mounts no option rows", async () => {
  const session = {
    id: "ses_autocomplete_mount",
    title: "Autocomplete",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" } },
    args: { sessionID: session.id },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    },
  })
  // Counts mounted text renderables, hidden or not, so the hidden popup's rows show up.
  const count = (node: Renderable, text: string): number =>
    (node instanceof TextBufferRenderable && node.plainText.includes(text) ? 1 : 0) +
    node.getChildren().reduce((total, child) => total + count(child, text), 0)
  const mounted = (text: string) => count(setup.renderer.root, text)
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.waitForVisualIdle({ quietFrames: 3 })
  expect(mounted("Switch theme")).toBe(0)

  await setup.mockInput.typeText("/theme")
  await setup.waitForFrame((frame) => frame.includes("Switch theme"))
  expect(mounted("Switch theme")).toBe(1)

  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Switch theme"))
  expect(mounted("Switch theme")).toBe(0)

  setup.mockInput.pressBackspace()
  await setup.waitForFrame((frame) => frame.includes("Switch theme"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Themes"))
})
