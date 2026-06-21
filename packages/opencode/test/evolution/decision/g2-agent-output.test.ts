import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-AGENT-OUTPUT — agent produces schema-valid ProposalCandidate", () => {
  const agentSrc = readFileSync(
    new URL("../../../src/evolution/decision/agents/context-analyst.ts", import.meta.url),
    "utf-8",
  )

  test("agent uses AGENT_OUTPUT_SCHEMA", () => {
    expect(agentSrc).toContain("AGENT_OUTPUT_SCHEMA")
  })

  test("agent function returns single ProposalCandidate (not array)", () => {
    const returnMatch = agentSrc.match(/Effect\.Effect<ProposalCandidate/)
    expect(returnMatch).not.toBeNull()
    const arrayMatch = agentSrc.match(/Effect\.Effect<ProposalCandidate\[\]/)
    expect(arrayMatch).toBeNull()
  })

  test("agent does not import mapConfidence", () => {
    expect(agentSrc).not.toContain("mapConfidence")
  })

  test("agent does not produce confidenceScore", () => {
    expect(agentSrc).not.toContain("confidenceScore")
  })
})
