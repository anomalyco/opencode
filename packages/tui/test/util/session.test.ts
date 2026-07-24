import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { isDefaultTitle, sessionFamily } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("collects every generation in a session family", () => {
    const sessions = [
      session("root"),
      session("first", "root"),
      session("grandchild", "first"),
      session("great-grandchild", "grandchild"),
      session("second", "root"),
      session("unrelated"),
      session("unrelated-child", "unrelated"),
    ]

    expect(sessionFamily(sessions, "root").map((session) => session.id)).toEqual([
      "root",
      "first",
      "grandchild",
      "great-grandchild",
      "second",
    ])
  })

  test("ignores malformed cycles and missing roots", () => {
    const sessions = [
      session("root", "child"),
      session("child", "root"),
      session("cycle-a", "cycle-b"),
      session("cycle-b", "cycle-a"),
    ]

    expect(sessionFamily(sessions, "root").map((session) => session.id)).toEqual(["root", "child"])
    expect(sessionFamily(sessions, "missing")).toEqual([])
  })
})

function session(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    slug: id,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "test",
    time: {
      created: 0,
      updated: 0,
    },
  }
}
