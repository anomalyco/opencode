import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveAgent, shouldApplyAgent } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasCustomAgent([{ native: true }, {}])).toBe(false)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "plan" }, { name: "build" }, { name: "custom" }]

  test("uses the requested available agent", () => {
    expect(resolveAgent(agents, "custom")?.name).toBe("custom")
  })

  test("defaults to build", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
  })

  test("uses the first agent when build is unavailable", () => {
    expect(resolveAgent([{ name: "custom" }], "missing")?.name).toBe("custom")
  })
})

describe("shouldApplyAgent", () => {
  test("applies the first selection so state is persisted", () => {
    expect(shouldApplyAgent({ agent: "build", persisted: undefined })).toBe(true)
  })

  test("applies a real agent switch", () => {
    expect(shouldApplyAgent({ agent: "plan", persisted: "build" })).toBe(true)
  })

  test("skips re-applying the already-persisted agent", () => {
    expect(shouldApplyAgent({ agent: "build", persisted: "build" })).toBe(false)
  })
})
