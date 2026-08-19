import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { sessionTree } from "../../../src/routes/session/tree"

const session = (id: string, parentID?: string) => ({ id, parentID, title: id }) as Session

describe("sessionTree", () => {
  test("returns the complete subtree", () => {
    const sessions = [
      session("root"),
      session("child-a", "root"),
      session("child-b", "root"),
      session("grandchild", "child-a"),
      session("other"),
    ]

    expect(sessionTree(sessions, "root").map((item) => item.id)).toEqual(["root", "child-a", "child-b", "grandchild"])
  })

  test("returns an empty list for an unknown root", () => {
    expect(sessionTree([session("child", "root")], "root")).toEqual([])
  })

  test("visits each session once when parent links cycle", () => {
    const sessions = [session("root", "child"), session("child", "root")]

    expect(sessionTree(sessions, "root").map((item) => item.id)).toEqual(["root", "child"])
  })
})
