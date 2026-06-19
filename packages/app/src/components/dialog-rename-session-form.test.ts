import { describe, expect, test } from "bun:test"
import { validateSessionRename } from "./dialog-rename-session-form"

describe("validateSessionRename", () => {
  test("builds a trimmed title payload", () => {
    expect(validateSessionRename({ title: "  New title  ", currentTitle: "Old title" })).toEqual({
      result: { title: "New title" },
      error: undefined,
    })
  })

  test("rejects empty titles", () => {
    expect(validateSessionRename({ title: "   ", currentTitle: "Old title" })).toEqual({
      result: undefined,
      error: "dialog.session.rename.error.empty",
    })
  })

  test("skips unchanged titles", () => {
    expect(validateSessionRename({ title: " Old title ", currentTitle: "Old title" })).toEqual({
      result: undefined,
      error: undefined,
    })
  })
})
