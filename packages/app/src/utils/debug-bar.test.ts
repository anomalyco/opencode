import { describe, expect, test } from "bun:test"
import { shouldShowDebugBar } from "./debug-bar"

describe("shouldShowDebugBar", () => {
  test("shows in dev builds", () => {
    expect(shouldShowDebugBar({ dev: true, search: "" })).toBe(true)
  })

  test("shows when debug_perf=1 is set in the URL", () => {
    let saved = ""
    expect(
      shouldShowDebugBar({
        dev: false,
        search: "?debug_perf=1",
        read: () => (saved ? saved : null),
        write: (value) => {
          saved = value
        },
      }),
    ).toBe(true)
    expect(saved).toBe("1")
  })

  test("stays hidden in production without the query flag", () => {
    expect(shouldShowDebugBar({ dev: false, search: "" })).toBe(false)
  })

  test("stays enabled after navigation once persisted", () => {
    expect(
      shouldShowDebugBar({
        dev: false,
        search: "",
        read: () => "1",
      }),
    ).toBe(true)
  })
})
