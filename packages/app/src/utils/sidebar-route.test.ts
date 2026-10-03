import { expect, test } from "bun:test"
import { sidebarSessionIdFromPath } from "./sidebar-route"

test("extracts the session id from session routes", () => {
  expect(sidebarSessionIdFromPath("/server/c2Vzc2lvbg/session/abc123")).toBe("abc123")
  expect(sidebarSessionIdFromPath("/server/c2Vzc2lvbg/session/abc123/")).toBe("abc123")
})

test("returns undefined outside session routes", () => {
  expect(sidebarSessionIdFromPath("/")).toBeUndefined()
  expect(sidebarSessionIdFromPath("/new-session")).toBeUndefined()
  expect(sidebarSessionIdFromPath("/new-session?draftId=abc")).toBeUndefined()
  expect(sidebarSessionIdFromPath("/server/c2Vzc2lvbg/session/")).toBeUndefined()
  expect(sidebarSessionIdFromPath("")).toBeUndefined()
})
