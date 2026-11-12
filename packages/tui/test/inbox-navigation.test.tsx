import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
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
  await app.mockInput.typeText("work")
  app.mockInput.pressArrow("up")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("▸ Local work"))
  expect(app.captureCharFrame()).not.toContain("▸ Other work")
})

test("section headers fold without stealing prompt arrows outside the section", async () => {
  const question = session("ses_question")
  const permission = session("ses_permission")
  await using app = await createAppFixture({
    width: 76,
    height: 26,
    config: { animations: false, session: { inbox: true } },
    fetch: (url) => {
      if (url.pathname === "/api/session")
        return json({
          data: [
            { ...permission, title: "Check a very long session title" },
            { ...question, title: "Decide" },
          ],
          cursor: {},
        })
      if (url.pathname === "/api/form")
        return json({ data: [{ id: "form", sessionID: question.id, title: "Answer", fields: [] }] })
      if (url.pathname === "/api/permission/request")
        return json({ data: [{ id: "request", sessionID: permission.id, action: "read", resources: ["a"] }] })
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("▾ Needs attention 2") && frame.includes("Answer question"))
  const lines = app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.slice(0, 32))
  const y = lines.findIndex((line) => line.includes("Needs attention"))
  expect(lines[y + 1]).toMatch(/Ch.*Review permission/)
  expect(lines[y + 2]).toMatch(/Decide.*Answer question/)
  const colors = app
    .captureSpans()
    .lines.slice(y + 1, y + 3)
    .map((line) => line.spans.find((span) => /Review permission|Answer question/.test(span.text))?.fg.toInts())
  expect(colors[0]).toBeDefined()
  expect(colors[1]).toBeDefined()
  expect(colors[0]).not.toEqual(colors[1])
  await app.mockMouse.click(6, y)
  await app.waitForFrame((frame) => frame.includes("▸ Needs attention 2") && !frame.includes("Answer question"))
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("Review permission"))
  await app.mockMouse.moveTo(6, y + 1)
  app.mockInput.pressArrow("left")
  await app.waitForFrame((frame) => frame.includes("▸ Needs attention 2"))
  await app.mockMouse.moveTo(60, y)
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await app.mockInput.typeText("ac")
  app.mockInput.pressArrow("left")
  await app.mockInput.typeText("b")
  app.mockInput.pressArrow("right")
  await app.waitForFrame((frame) => frame.includes("abc") && frame.includes("▸ Needs attention 2"))
})
