import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-AGENT-STATELESS — no mutable state in agent source", () => {
  const agentSrc = readFileSync(
    new URL("../../../src/evolution/decision/agents/context-analyst.ts", import.meta.url),
    "utf-8",
  )

  test("no let declarations", () => {
    const matches = agentSrc.match(/^[^/]*\blet\b/m)
    expect(matches).toBeNull()
  })

  test("no var declarations", () => {
    const matches = agentSrc.match(/^[^/]*\bvar\b/m)
    expect(matches).toBeNull()
  })

  test("no mutable collections (new Map, new Set)", () => {
    expect(agentSrc).not.toContain("new Map")
    expect(agentSrc).not.toContain("new Set")
  })
})
