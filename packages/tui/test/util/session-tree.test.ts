import { describe, expect, test } from "bun:test"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { collectSubtree, countActiveDescendants, isActiveSessionStatus } from "../../src/util/session-tree"

function session(items: { id: string; parentID?: string }[]) {
  return items as unknown as Session[]
}

describe("util.session-tree", () => {
  test("classifies busy and retry as active session statuses", () => {
    expect(isActiveSessionStatus({ type: "busy" })).toBe(true)
    expect(isActiveSessionStatus({ type: "retry", attempt: 1, message: "retrying", next: Date.now() + 1000 })).toBe(
      true,
    )
    expect(isActiveSessionStatus({ type: "idle" })).toBe(false)
    expect(isActiveSessionStatus(undefined)).toBe(false)
  })

  test("returns the root for a single root session", () => {
    expect(collectSubtree(session([{ id: "root" }]), "root")).toEqual(["root"])
  })

  test("collects depth-1 fan-out", () => {
    expect(
      collectSubtree(
        session([
          { id: "root" },
          { id: "child-a", parentID: "root" },
          { id: "child-b", parentID: "root" },
          { id: "child-c", parentID: "root" },
        ]),
        "root",
      ),
    ).toEqual(["root", "child-a", "child-b", "child-c"])
  })

  test("collects a depth-2 chain", () => {
    expect(
      collectSubtree(
        session([{ id: "root" }, { id: "child", parentID: "root" }, { id: "grandchild", parentID: "child" }]),
        "root",
      ),
    ).toEqual(["root", "child", "grandchild"])
  })

  test("collects a depth-3 chain", () => {
    expect(
      collectSubtree(
        session([
          { id: "root" },
          { id: "child", parentID: "root" },
          { id: "grandchild", parentID: "child" },
          { id: "great-grandchild", parentID: "grandchild" },
        ]),
        "root",
      ),
    ).toEqual(["root", "child", "grandchild", "great-grandchild"])
  })

  test("collects multiple branches", () => {
    expect(
      collectSubtree(
        session([
          { id: "root" },
          { id: "child-a", parentID: "root" },
          { id: "child-b", parentID: "root" },
          { id: "grandchild-a1", parentID: "child-a" },
          { id: "grandchild-a2", parentID: "child-a" },
          { id: "grandchild-b1", parentID: "child-b" },
        ]),
        "root",
      ),
    ).toEqual(["root", "child-a", "child-b", "grandchild-b1", "grandchild-a1", "grandchild-a2"])
  })

  test("excludes unrelated sessions", () => {
    expect(
      collectSubtree(
        session([
          { id: "root" },
          { id: "child", parentID: "root" },
          { id: "unrelated-root" },
          { id: "unrelated-child", parentID: "unrelated-root" },
        ]),
        "root",
      ),
    ).toEqual(["root", "child"])
  })

  test("terminates on a synthetic parentID cycle", () => {
    expect(
      collectSubtree(
        session([
          { id: "root", parentID: "child" },
          { id: "child", parentID: "root" },
        ]),
        "root",
      ),
    ).toEqual(["root", "child"])
  })

  test("counts a busy descendant", () => {
    expect(
      countActiveDescendants(
        session([{ id: "root" }, { id: "child", parentID: "root" }]),
        { child: { type: "busy" } },
        "root",
      ),
    ).toBe(1)
  })

  test("counts a retrying descendant", () => {
    expect(
      countActiveDescendants(
        session([{ id: "root" }, { id: "child", parentID: "root" }]),
        {
          child: {
            type: "retry",
            attempt: 1,
            message: "retrying",
            next: Date.now() + 1000,
          },
        },
        "root",
      ),
    ).toBe(1)
  })

  test("does not count an idle descendant", () => {
    expect(
      countActiveDescendants(
        session([{ id: "root" }, { id: "child", parentID: "root" }]),
        { child: { type: "idle" } },
        "root",
      ),
    ).toBe(0)
  })

  test("treats a missing status as idle", () => {
    const sessions = session([{ id: "root" }, { id: "child", parentID: "root" }])
    expect(countActiveDescendants(sessions, {}, "root")).toBe(0)
    expect(countActiveDescendants(sessions, undefined, "root")).toBe(0)
  })

  test("counts an active grandchild below an idle child", () => {
    expect(
      countActiveDescendants(
        session([{ id: "root" }, { id: "child", parentID: "root" }, { id: "grandchild", parentID: "child" }]),
        { child: { type: "idle" }, grandchild: { type: "busy" } },
        "root",
      ),
    ).toBe(1)
  })

  test("excludes the current session even when active", () => {
    expect(countActiveDescendants(session([{ id: "root" }]), { root: { type: "busy" } }, "root")).toBe(0)
  })

  test("excludes active sessions outside the current subtree", () => {
    expect(
      countActiveDescendants(
        session([
          { id: "root" },
          { id: "child", parentID: "root" },
          { id: "other" },
          { id: "other-child", parentID: "other" },
        ]),
        {
          child: { type: "idle" },
          other: { type: "busy" },
          "other-child": { type: "retry", attempt: 1, message: "retrying", next: 1 },
        },
        "root",
      ),
    ).toBe(0)
  })

  test("counts multiple active descendants", () => {
    expect(
      countActiveDescendants(
        session([
          { id: "root" },
          { id: "child-a", parentID: "root" },
          { id: "child-b", parentID: "root" },
          { id: "grandchild", parentID: "child-a" },
        ]),
        {
          "child-a": { type: "busy" },
          "child-b": { type: "retry", attempt: 2, message: "retrying", next: 1 },
          grandchild: { type: "busy" },
        },
        "root",
      ),
    ).toBe(3)
  })

  test("counts a large active subtree within a bounded time", () => {
    const children = Array.from({ length: 1000 }, (_, index) => ({
      id: `child-${index}`,
      parentID: index === 0 ? "root" : `child-${index - 1}`,
    }))
    const status = Object.fromEntries(children.map((item) => [item.id, { type: "busy" } satisfies SessionStatus]))
    const start = performance.now()

    expect(countActiveDescendants(session([{ id: "root" }, ...children]), status, "root")).toBe(children.length)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
