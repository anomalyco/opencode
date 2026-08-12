import { describe, expect, test } from "bun:test"
import { hasCustomAgent, isAgentsVisible, resolveAgent } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects explicitly custom agents", () => {
    expect(hasCustomAgent([{ native: true }, { native: false }])).toBe(true)
  })

  test("ignores built-in and unclassified agents", () => {
    expect(hasCustomAgent([{ native: true }, {}])).toBe(false)
  })
})

describe("isAgentsVisible", () => {
  test("is visible when there are multiple selectable agents", () => {
    expect(isAgentsVisible({ customAgents: false, agents: [{ native: true }, { native: true }] })).toBe(true)
  })

  test("is hidden for a single built-in agent unless custom agents are enabled", () => {
    expect(isAgentsVisible({ customAgents: false, agents: [{ native: true }] })).toBe(false)
    expect(isAgentsVisible({ customAgents: true, agents: [{ native: true }] })).toBe(true)
  })

  test("is visible when any custom agent is present", () => {
    expect(isAgentsVisible({ customAgents: false, agents: [{ native: false }] })).toBe(true)
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
