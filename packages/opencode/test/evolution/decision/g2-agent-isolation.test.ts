import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-AGENT-ISOLATION — no brain/ or engine/ imports in agent source", () => {
  const agentSrc = readFileSync(
    new URL("../../../src/evolution/decision/agents/context-analyst.ts", import.meta.url),
    "utf-8",
  )

  test("no brain/ imports", () => {
    const matches = agentSrc.match(/from\s+["'].*brain\/.*["']/)
    expect(matches).toBeNull()
  })

  test("no decision/engine import (TG-AGENT-NO-ENGINE-IMPORT)", () => {
    const matches = agentSrc.match(/from\s+["'].*decision\/engine["']/)
    expect(matches).toBeNull()
  })
})
