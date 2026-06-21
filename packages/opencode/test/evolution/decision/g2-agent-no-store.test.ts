import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-AGENT-NO-STORE — no ProposalStore import in agent source", () => {
  const agentSrc = readFileSync(
    new URL("../../../src/evolution/decision/agents/context-analyst.ts", import.meta.url),
    "utf-8",
  )

  test("no ProposalStore import", () => {
    const matches = agentSrc.match(/ProposalStore/)
    expect(matches).toBeNull()
  })

  test("no ProposalCandidate import with persist methods", () => {
    const matches = agentSrc.match(/import.*(write|save|persist)/i)
    expect(matches).toBeNull()
  })
})
