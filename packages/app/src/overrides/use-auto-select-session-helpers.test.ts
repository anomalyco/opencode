import { describe, expect, test } from "bun:test"
import { resolveLatestSessionPath } from "./use-auto-select-session-helpers"

describe("resolveLatestSessionPath", () => {
  test("returns undefined when paramsId is already set (no redirect needed)", () => {
    expect(resolveLatestSessionPath("sess-123", "dir-abc", [{ id: "sess-123" }])).toBeUndefined()
  })

  test("returns undefined when sessions list is empty", () => {
    expect(resolveLatestSessionPath(undefined, "dir-abc", [])).toBeUndefined()
  })

  test("returns path to last session when no paramsId and sessions exist", () => {
    const sessions = [{ id: "sess-1" }, { id: "sess-2" }, { id: "sess-3" }]
    expect(resolveLatestSessionPath(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-3")
  })

  test("returns path for single session", () => {
    expect(resolveLatestSessionPath(undefined, "dir-abc", [{ id: "only-one" }])).toBe("/dir-abc/session/only-one")
  })

  test("correctly includes paramsDir in the path", () => {
    const sessions = [{ id: "sess-1" }]
    expect(resolveLatestSessionPath(undefined, "L2hvbWUvcHJvamVjdA", sessions)).toBe(
      "/L2hvbWUvcHJvamVjdA/session/sess-1",
    )
  })
})
