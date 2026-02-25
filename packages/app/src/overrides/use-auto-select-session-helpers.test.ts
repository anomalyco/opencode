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

describe("resolveLatestSessionPath — always redirects (no guard)", () => {
  const sessions = [{ id: "sess-1" }, { id: "sess-2" }]

  test("redirects every time when called repeatedly with same inputs", () => {
    // Without the old guard, every call should return a path
    const first = resolveLatestSessionPath(undefined, "dir-abc", sessions)
    const second = resolveLatestSessionPath(undefined, "dir-abc", sessions)
    const third = resolveLatestSessionPath(undefined, "dir-abc", sessions)
    expect(first).toBe("/dir-abc/session/sess-2")
    expect(second).toBe("/dir-abc/session/sess-2")
    expect(third).toBe("/dir-abc/session/sess-2")
  })

  test("still skips redirect when paramsId is set (already on a session)", () => {
    expect(resolveLatestSessionPath("sess-1", "dir-abc", sessions)).toBeUndefined()
  })

  test("returns undefined when no sessions, then redirects once sessions appear", () => {
    expect(resolveLatestSessionPath(undefined, "dir-abc", [])).toBeUndefined()
    expect(resolveLatestSessionPath(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-2")
  })
})
