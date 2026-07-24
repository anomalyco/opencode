import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveAgent, shouldShowAgentSelector } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasCustomAgent([{ native: true }, {}])).toBe(false)
  })
})

describe("shouldShowAgentSelector", () => {
  test("keeps the default Build and Plan selector hidden", () => {
    expect(
      shouldShowAgentSelector(
        [
          { name: "build", native: true },
          { name: "plan", native: true },
        ],
        false,
      ),
    ).toBe(false)
  })

  test("shows built-in workflow and custom agents without a settings override", () => {
    expect(shouldShowAgentSelector([{ name: "heavy", native: true }], false)).toBe(true)
    expect(shouldShowAgentSelector([{ name: "council", native: true }], false)).toBe(true)
    expect(shouldShowAgentSelector([{ name: "review", native: false }], false)).toBe(true)
  })

  test("respects the explicit selector setting", () => {
    expect(shouldShowAgentSelector([{ name: "build", native: true }], true)).toBe(true)
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
