import { describe, expect, test } from "bun:test"
import { isStoreName } from "./name"

describe("store names", () => {
  test.each([
    "default.dat",
    "opencode.global.dat",
    "opencode.window.browser.dat",
    "opencode.workspace.-home-user.abc123.dat",
    "opencode.draft.session_123.0.dat",
  ])("allows %s", (name) => {
    expect(isStoreName(name)).toBe(true)
  })

  test.each([
    "../outside.dat",
    "/tmp/outside.dat",
    "C:\\outside.dat",
    "C:outside.dat",
    "opencode.window/../../outside.dat",
    ".",
    "..",
    "",
  ])("rejects %s", (name) => {
    expect(isStoreName(name)).toBe(false)
  })

  test("rejects oversized names", () => {
    expect(isStoreName("a".repeat(256))).toBe(false)
  })
})
