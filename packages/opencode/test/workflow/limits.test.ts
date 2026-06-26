import { describe, expect, it } from "bun:test"
import { WorkflowLimitError, DEFAULTS } from "../../src/workflow/limits"

describe("workflow limits", () => {
  it("DEFAULTS has correct values", () => {
    expect(DEFAULTS.max_concurrency).toBe(8)
    expect(DEFAULTS.max_agents).toBe(100)
    expect(DEFAULTS.timeout_ms).toBe(30 * 60 * 1000)
  })

  it("WorkflowLimitError has correct fields", () => {
    const err = new WorkflowLimitError({ limit: "max_agents", value: 101, max: 100 })
    expect(err.limit).toBe("max_agents")
    expect(err.value).toBe(101)
    expect(err.max).toBe(100)
    expect(err.message).toContain("max_agents")
    expect(err.message).toContain("101")
    expect(err.message).toContain("100")
  })
})
