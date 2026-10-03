import { describe, expect, test } from "bun:test"
import { agentColor } from "./agent"

describe("agentColor", () => {
  test("uses the configured colors for built-in agents", () => {
    expect(agentColor("build")).toBe("var(--icon-agent-build-base)")
    expect(agentColor("Build")).toBe("var(--icon-agent-build-base)")
  })

  test("uses custom colors before generated colors", () => {
    expect(agentColor("custom", "#123456")).toBe("#123456")
  })

  test("generates colors for names inherited by plain objects", () => {
    expect(agentColor("constructor")).toMatch(/^var\(--.+\)$/)
    expect(agentColor("toString")).toMatch(/^var\(--.+\)$/)
  })
})
