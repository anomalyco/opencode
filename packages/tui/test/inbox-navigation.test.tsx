import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { session } from "./fixture/local"
import { directory, json } from "./fixture/tui-client"

test("open inbox sessions in different locations by mouse and by keyboard", async () => {
  const sessions = [
    { ...session("ses_inbox_local"), title: "Local work" },
    { ...session("ses_inbox_other"), title: "Other work", location: { directory: "/tmp/another-project" } },
  ]
  await using app = await createAppFixture({
    width: 114,
    height: 30,
    config: { animations: false, session: { inbox: true }, tabs: { enabled: true } },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
      const item = sessions.find((s) => url.pathname === `/api/session/${s.id}`)
      if (item) return json({ data: item })
      if (/^\/api\/session\/[^/]+\/(message|inbox)$/.test(url.pathname)) return json({ data: [], cursor: {} })
      if (url.pathname === "/api/location") {
        const target = url.searchParams.get("directory") ?? directory
        return json({ directory: target, project: { id: "project", directory: target, canonical: target } })
      }
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("Other work") && frame.includes("Local work"))
  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("Other work"))
  await app.mockMouse.click(lines[y]!.indexOf("Other work"), y)
  await app.waitForFrame((frame) => frame.includes("▸ Other work"))

  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Open inbox session")
  await app.waitForFrame((frame) => frame.includes("Open inbox session"))
  app.mockInput.pressEnter()
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  await app.mockInput.typeText("Local work")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("▸ Local work"))
  expect(app.captureCharFrame()).not.toContain("▸ Other work")
})
