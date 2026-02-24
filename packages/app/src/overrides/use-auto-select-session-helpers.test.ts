import { describe, expect, test } from "bun:test"
import { resolveLatestSessionPath, createAutoSelectGuard } from "./use-auto-select-session-helpers"

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

describe("createAutoSelectGuard", () => {
  const sessions = [{ id: "sess-1" }, { id: "sess-2" }]

  test("auto-selects on first call when sessions exist and no paramsId", () => {
    const guard = createAutoSelectGuard()
    expect(guard(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-2")
  })

  test("does not auto-select again after first successful selection", () => {
    const guard = createAutoSelectGuard()
    guard(undefined, "dir-abc", sessions)
    // Simulate clicking "New session" — same inputs, should not redirect
    expect(guard(undefined, "dir-abc", sessions)).toBeUndefined()
  })

  test("stays locked after multiple calls", () => {
    const guard = createAutoSelectGuard()
    guard(undefined, "dir-abc", sessions)
    expect(guard(undefined, "dir-abc", sessions)).toBeUndefined()
    expect(guard(undefined, "dir-abc", sessions)).toBeUndefined()
    expect(guard(undefined, "dir-abc", sessions)).toBeUndefined()
  })

  test("does not lock when no sessions exist (no successful selection)", () => {
    const guard = createAutoSelectGuard()
    // First call: no sessions, returns undefined but does NOT lock
    expect(guard(undefined, "dir-abc", [])).toBeUndefined()
    // Sessions arrive later — should still auto-select
    expect(guard(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-2")
    // Now locked
    expect(guard(undefined, "dir-abc", sessions)).toBeUndefined()
  })

  test("does not lock when paramsId is set (no redirect needed)", () => {
    const guard = createAutoSelectGuard()
    // User directly visits a session — no redirect, no lock
    expect(guard("sess-1", "dir-abc", sessions)).toBeUndefined()
    // Later navigates without ID — should auto-select since guard never locked
    expect(guard(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-2")
  })

  test("each guard instance is independent", () => {
    const guard1 = createAutoSelectGuard()
    const guard2 = createAutoSelectGuard()
    guard1(undefined, "dir-abc", sessions)
    // guard1 is locked, guard2 is not
    expect(guard1(undefined, "dir-abc", sessions)).toBeUndefined()
    expect(guard2(undefined, "dir-abc", sessions)).toBe("/dir-abc/session/sess-2")
  })
})
