import { describe, expect, test } from "bun:test"
import { agentColor } from "./agent"

describe("agentColor", () => {
  test("generates palette colors for object prototype keys", () => {
    expect(agentColor("constructor")).toStartWith("var(--")
    expect(agentColor("toString")).toStartWith("var(--")
  })

  test("resolves built-in names case-insensitively", () => {
    expect(agentColor("BUILD")).toBe("var(--icon-agent-build-base)")
  })
})
