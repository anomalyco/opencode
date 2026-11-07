import { expect, test } from "bun:test"
import { epilogue } from "../../src/util/presentation"

const rows = (text: string | undefined) =>
  Bun.stripANSI(text ?? "")
    .split("\n")
    .filter((line) => line.trim() && !/[▀▄█]/.test(line))

test("prints nothing without a session or update", () => {
  expect(epilogue({ tty: true })).toBeUndefined()
})

test("formats session continuation summary", () => {
  expect(rows(epilogue({ session: { title: "A session", sessionID: "ses_123" }, tty: true }))).toEqual([
    "  Session   A session",
    "  Continue  opencode -s ses_123",
  ])
})

test("tells the user to start OpenCode again after an update", () => {
  expect(rows(epilogue({ updatedVersion: "2.0.0", tty: true }))).toEqual(["  Run opencode to use 2.0.0"])
})

test("keeps the session continuation after an update", () => {
  expect(
    rows(epilogue({ session: { title: "A session", sessionID: "ses_123" }, updatedVersion: "2.0.0", tty: true })),
  ).toEqual(["  Run opencode to use 2.0.0", "  Session   A session", "  Continue  opencode -s ses_123"])
})

test("draws the block wordmark only in a terminal", () => {
  const session = { title: "A session", sessionID: "ses_123" }
  expect(Bun.stripANSI(epilogue({ session, tty: true }) ?? "")).toMatch(/[▀▄█]/)
  expect(Bun.stripANSI(epilogue({ session, tty: false }) ?? "").split("\n")).toEqual([
    "  opencode",
    "",
    "  Session   A session",
    "  Continue  opencode -s ses_123",
    "",
  ])
})
