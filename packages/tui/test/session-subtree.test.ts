import { describe, expect, it } from "bun:test"
import { subtreeCost } from "../src/util/session-subtree"

const session = (id: string, cost: number, parentID?: string) => ({
  id,
  cost,
  ...(parentID ? { parentID } : {}),
})

describe("subtreeCost", () => {
  it("sums self plus all descendants", () => {
    const sessions = [
      session("root", 1),
      session("child", 2, "root"),
      session("grandchild", 3, "child"),
      session("unrelated", 9),
    ]
    expect(subtreeCost(sessions, "root")).toEqual({ self: 1, subagents: 5 })
  })

  it("includes the session's own subtree when viewing a subagent", () => {
    const sessions = [session("root", 1), session("child", 2, "root"), session("grandchild", 3, "child")]
    expect(subtreeCost(sessions, "child")).toEqual({ self: 2, subagents: 3 })
  })

  it("reports zero for a session without children or cost", () => {
    expect(subtreeCost([session("solo", 0)], "solo")).toEqual({ self: 0, subagents: 0 })
  })

  it("reports zero when the session is missing", () => {
    expect(subtreeCost([], "missing")).toEqual({ self: 0, subagents: 0 })
  })

  it("guards against parentID cycles", () => {
    const sessions = [session("a", 1, "b"), session("b", 2, "a"), session("root", 4)]
    expect(subtreeCost(sessions, "root")).toEqual({ self: 4, subagents: 0 })
  })
})