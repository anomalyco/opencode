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
  await app.waitForFrame(
    (frame) =>
      !frame.includes("Search inbox sessions") &&
      frame.includes("Other work") &&
      app.renderer.currentFocusedEditor instanceof TextareaRenderable,
  )
  const prompt = app.renderer.currentFocusedEditor!
  const width = prompt.width
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("o")
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  expect(prompt.width).toBe(width)
  app.mockInput.pressArrow("up")
  app.mockInput.pressEnter()
  await app.waitForFrame(
    (frame) =>
      !frame.includes("Search inbox sessions") &&
      frame.includes("Local work") &&
      app.renderer.currentFocusedEditor instanceof TextareaRenderable,
  )
})

test("scroll through a long inbox without leaving the overlay", async () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    ...session(`ses_wheel_${index}`),
    title: `Wheel session ${index}`,
  }))
  await using app = await createAppFixture({
    width: 64,
    height: 15,
    config: { animations: false, session: { inbox: true } },
    fetch: (url) => (url.pathname === "/api/session" ? json({ data: sessions, cursor: {} }) : undefined),
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("Wheel session 0"))
  expect(app.captureCharFrame()).not.toContain("Wheel session 9")
  const y = app
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes("Wheel session 0"))
  for (let i = 0; i < 15; i++) await app.mockMouse.scroll(12, y, "down")
  await app.waitForFrame((frame) => frame.includes("Wheel session 9") && !frame.includes("Wheel session 0"))
})

test("attention rows explain their action; headers fold with remapped keys or a click", async () => {
  const sessions = [
    {
      ...session("ses_question"),
      title: "Choose " + "a very long title ".repeat(10),
      location: { directory: "/work/Atlas" },
    },
    { ...session("ses_permission"), title: "Deploy", location: { directory: "/work/Atlas" } },
    { ...session("ses_recent"), title: "Finished earlier" },
  ]
  await using app = await createAppFixture({
    width: 100,
    height: 24,
    config: {
      animations: false,
      session: { inbox: true },
      keybinds: { "inbox.section.collapse": "f8", "inbox.section.expand": "f9", "dialog.select.submit": "none" },
    },
    fetch: (url) => {
      if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
      if (url.searchParams.get("location[directory]") !== "/work/Atlas") return
      if (url.pathname === "/api/permission/request")
        return json({ data: [{ id: "permission", sessionID: "ses_permission", action: "read", resources: ["a"] }] })
      if (url.pathname === "/api/form")
        return json({ data: [{ id: "form", sessionID: "ses_question", title: "Answer", fields: [] }] })
    },
  })
  await app.ready
  await app.waitForFrame(
    (frame) =>
      frame.includes("▾ Needs attention 2") &&
      frame.includes("[?] Choose") &&
      app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  const frame = app.captureCharFrame()
  expect(frame).toContain("[?] Choose")
  expect(frame).toContain("[!] Deploy")
  expect(frame).not.toMatch(/Review permission|Answer question/)
  expect(frame).toMatch(/collapse f8/i)
  expect(frame).not.toMatch(/enter open|open enter|esc close/i)
  expect(frame).not.toContain("Atlas")
  app.mockInput.pressKey("HOME")
  app.mockInput.pressArrow("down")
  await app.waitForFrame((frame) => /▌ +\[!\] Deploy/.test(frame))
  app.mockInput.pressKey("F8")
  await app.waitForFrame((frame) => frame.includes("▌ ▸ Needs attention 2") && !frame.includes("[!] Deploy"))
  app.mockInput.pressArrow("down")
  await app.waitForFrame((frame) => frame.includes("▌ ▾ Recent 1"))
  app.mockInput.pressArrow("up")
  await app.waitForFrame((frame) => frame.includes("▌ ▸ Needs attention 2") && /expand f9/i.test(frame))
  app.mockInput.pressKey("F9")
  await app.waitForFrame((frame) => frame.includes("▌ ▾ Needs attention 2") && frame.includes("[!] Deploy"))
  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("Needs attention"))
  await app.mockMouse.click(lines[y]!.indexOf("Needs attention"), y)
  await app.waitForFrame((frame) => frame.includes("▸ Needs attention 2") && !frame.includes("[?] Choose"))
  await app.mockInput.typeText("Atlas")
  await app.waitForFrame((frame) => frame.includes("[?] Choose") && !frame.includes("Finished earlier"))
  app.resize(180, 24)
  await app.waitForFrame((frame) => /\[\?\] Choose[^\n]+Dir: Atlas/.test(frame))
  expect(app.captureCharFrame()).toMatch(/\[!\] Deploy[^\n]+Dir: Atlas/)
})
