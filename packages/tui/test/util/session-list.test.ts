import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { sessionList } from "../../src/util/session-list"

function session(id: string, updated: number, parentID?: string): Session {
  return {
    id,
    slug: id,
    projectID: "proj",
    directory: "/tmp",
    parentID,
    title: id,
    version: "1",
    time: {
      created: updated,
      updated,
    },
  }
}

describe("sessionList", () => {
  test("caps root sessions when not searching", () => {
    const result = sessionList(
      [session("old", 1), session("child", 3, "parent"), session("new", 2)],
      1,
      undefined,
      false,
    )

    expect(result.map((x) => x.id)).toEqual(["new"])
  })

  test("does not cap when searching", () => {
    const result = sessionList([session("a", 1), session("b", 2), session("c", 3)], 1, undefined, true)

    expect(result.map((x) => x.id)).toEqual(["c", "b", "a"])
  })

  test("keeps current session when capped", () => {
    const result = sessionList([session("a", 4), session("b", 3), session("c", 2)], 2, "c", false)

    expect(result.map((x) => x.id)).toEqual(["a", "c"])
  })

  test("keeps current root session when current session is a child", () => {
    const result = sessionList([session("a", 4), session("root", 1), session("child", 5, "root")], 1, "child", false)

    expect(result.map((x) => x.id)).toEqual(["root"])
  })

  test("inserts current using session sort order", () => {
    const result = sessionList(
      [session("a", 10), session("b", 9), session("c", 9), session("d", 9), session("e", 8)],
      3,
      "d",
      false,
    )

    expect(result.map((x) => x.id)).toEqual(["a", "b", "d"])
  })

  test("keeps pinned sessions when capped", () => {
    const result = sessionList(
      [session("a", 4), session("b", 3), session("c", 2), session("d", 1)],
      2,
      undefined,
      false,
      ["d"],
    )

    expect(result.map((x) => x.id)).toEqual(["a", "d"])
  })

  test("deduplicates pinned sessions inside the cap", () => {
    const result = sessionList(
      [session("a", 4), session("b", 3), session("c", 2), session("d", 1)],
      2,
      undefined,
      false,
      ["d", "d"],
    )

    expect(result.map((x) => x.id)).toEqual(["a", "d"])
  })

  test("keeps the cap when pinned sessions exceed the limit", () => {
    const result = sessionList([session("a", 4), session("b", 3), session("c", 2), session("d", 1)], 1, "c", false, [
      "d",
    ])

    expect(result.map((x) => x.id)).toEqual(["c"])
  })
})
