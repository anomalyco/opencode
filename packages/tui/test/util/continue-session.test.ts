import { expect, test } from "bun:test"
import { resolveContinueSessionID } from "../../src/util/continue-session"

const sessions = [
  { id: "ses_old", time: { updated: 1 }, directory: "/a" },
  { id: "ses_new", time: { updated: 3 }, directory: "/a" },
  { id: "ses_other", time: { updated: 4 }, directory: "/b" },
  { id: "ses_child", parentID: "ses_old", time: { updated: 5 }, directory: "/a" },
]

test("prefers the last exited session over most recently updated", () => {
  expect(resolveContinueSessionID(sessions, { lastID: "ses_old" })).toBe("ses_old")
})

test("falls back to most recently updated root session", () => {
  expect(resolveContinueSessionID(sessions)).toBe("ses_other")
})

test("maps a child last session to its parent root", () => {
  expect(resolveContinueSessionID(sessions, { lastID: "ses_child" })).toBe("ses_old")
})

test("scopes fallback and last-session match to a directory", () => {
  expect(resolveContinueSessionID(sessions, { directory: "/a" })).toBe("ses_new")
  expect(resolveContinueSessionID(sessions, { lastID: "ses_other", directory: "/a" })).toBe("ses_new")
  expect(resolveContinueSessionID(sessions, { lastID: "ses_old", directory: "/a" })).toBe("ses_old")
})

test("ignores a missing last session id", () => {
  expect(resolveContinueSessionID(sessions, { lastID: "ses_gone" })).toBe("ses_other")
})
