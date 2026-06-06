import { describe, expect, test } from "bun:test"
import { sessionExitSummary } from "../../src/util/presentation"

describe("util.presentation", () => {
  test("formats the ANSI session exit summary", () => {
    const summary = sessionExitSummary({ title: "A session", sessionID: "ses_123" })
    expect(summary.split("\n")).toHaveLength(8)
    expect(summary).toContain("\x1b[90mSession   \x1b[0m\x1b[1mA session\x1b[0m")
    expect(summary).toContain("\x1b[1mopencode -s ses_123\x1b[0m")
  })
})
