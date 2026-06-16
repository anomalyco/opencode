import { describe, expect, test } from "bun:test"
import { actor, label } from "./actor"

describe("doc actor labels", () => {
  test("uses awareness name when present", () => {
    expect(actor({ user: { actorID: "act_1", name: "Alice" } })).toEqual({
      actorID: "act_1",
      name: "Alice",
    })
  })

  test("falls back to actor id when awareness name is missing", () => {
    expect(actor({ user: { actorID: "act_1" } })).toEqual({
      actorID: "act_1",
      name: "act_1",
    })
  })

  test("falls back to actor id when awareness name is empty", () => {
    expect(actor({ user: { actorID: "act_1", name: "" } })).toEqual({
      actorID: "act_1",
      name: "act_1",
    })
  })

  test("falls back to actor id for local actor labels", () => {
    expect(label("act_1")).toBe("act_1")
    expect(label("act_1", "")).toBe("act_1")
    expect(label("act_1", " Alice ")).toBe("Alice")
  })
})
