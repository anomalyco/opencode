import { expect, test } from "bun:test"
import { epilogue } from "../../src/util/presentation"

const rows = (text: string | undefined) =>
  Bun.stripANSI(text ?? "")
    .split("\n")
    .filter((line) => line.trim() && !/[▀▄█]/.test(line))

test("prints nothing without a session or update", () => {
  expect(epilogue({})).toBeUndefined()
})

test("formats session continuation summary", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" } }))).toEqual([
    "  Session   A session",
    "  Continue  opencode -s ses_123",
  ])
})

test("tells the user to start OpenCode again after an update", () => {
  expect(rows(epilogue({ updatedVersion: "2.0.0" }))).toEqual(["  Run opencode to use 2.0.0"])
})

test("keeps the session continuation after an update", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" }, updatedVersion: "2.0.0" }))).toEqual([
    "  Run opencode to use 2.0.0",
    "  Session   A session",
    "  Continue  opencode -s ses_123",
  ])
})

test("a plugin claim replaces the wordmark and session rows", () => {
  expect(Bun.stripANSI(epilogue({ session: { claimed: "Resume: acme -s ses_123" } }) ?? "")).toBe(
    "Resume: acme -s ses_123",
  )
})

test("a plugin claim of nothing prints nothing", () => {
  expect(epilogue({ session: { claimed: undefined } })).toBeUndefined()
})

test("keeps the update notice above a plugin claim", () => {
  expect(rows(epilogue({ session: { claimed: "Resume: acme -s ses_123" }, updatedVersion: "2.0.0" }))).toEqual([
    "  Run opencode to use 2.0.0",
    "Resume: acme -s ses_123",
  ])
  expect(rows(epilogue({ session: { claimed: undefined }, updatedVersion: "2.0.0" }))).toEqual([
    "  Run opencode to use 2.0.0",
  ])
})
