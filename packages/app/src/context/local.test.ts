import { describe, expect, test } from "bun:test"
import { pickAgentItem, syncSessionState, type ModelKey } from "./local"

describe("pickAgentItem", () => {
  test("matches by id before name", () => {
    const items = [
      { id: "build", name: "Builder" },
      { id: "plan", name: "Planner" },
    ]

    expect(pickAgentItem(items, "build")?.name).toBe("Builder")
    expect(pickAgentItem(items, "Builder")?.name).toBe("Builder")
  })

  test("falls back to first item", () => {
    const items = [{ name: "build" }, { name: "plan" }]
    expect(pickAgentItem(items, "missing")?.name).toBe("build")
  })
})

describe("syncSessionState", () => {
  const model: ModelKey = { providerID: "anthropic", modelID: "claude-sonnet-4" }

  test("skips restoring for same message", () => {
    const state = syncSessionState({ message: "msg-1" }, { id: "msg-1", agent: "build", model })
    expect(state).toBeUndefined()
  })

  test("restores latest session message", () => {
    const state = syncSessionState({ agent: "plan", message: "msg-1" }, { id: "msg-2", agent: "build", model })
    expect(state).toEqual({
      agent: "build",
      model,
      variant: null,
      message: "msg-2",
    })
  })
})
