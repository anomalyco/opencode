import { expect, spyOn, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }

function render(state: string) {
  return createAppFixture({
    state,
    config: { animations: false, tabs: { mode: "on" } },
    fetch: (url) => {
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/location") return json(location)
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }],
        })
    },
  })
}

test("ctrl+l repaints the screen at the current size", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)

  await setup.waitForVisualIdle()

  const resize = spyOn(setup.renderer, "resize")
  const [width, height] = [setup.renderer.terminalWidth, setup.renderer.terminalHeight]
  setup.mockInput.pressKey("l", { ctrl: true })
  await setup.flush()
  setup.mockInput.pressKey("l", { ctrl: true })
  await setup.flush()

  try {
    expect(resize).toHaveBeenCalledWith(width, height)
    expect(resize).toHaveBeenCalledTimes(2)
  } finally {
    resize.mockRestore()
  }
})

test("clear screen shows in the command palette", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)

  await setup.waitForVisualIdle()
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Commands"))
  await setup.mockInput.typeText("screen")
  const frame = await setup.waitForFrame((frame) => frame.includes("Clear screen"))

  expect(frame).toContain("Clear screen")
})
