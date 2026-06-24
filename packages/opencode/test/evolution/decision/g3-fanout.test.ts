import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { collect } from "@/evolution/decision/coordinator"
import type { AgentManifest } from "@/evolution/decision/agents/types"
import type { ProposalCandidate } from "@/evolution/decision/proposal-candidate"
import type { EvolutionContext } from "@/evolution/context"

const mockContext: EvolutionContext = {
  project: { name: "test", frameworks: [], structure: "" },
  memories: [],
  decisions: [],
  budget: { configured: 0, used: 0, remaining: 0, strategy: "truncate" },
}
const mockCriteria = { instruction: "test", tags: [] }

function makeManifest(id: string, candidate: ProposalCandidate): AgentManifest {
  return {
    id,
    capabilities: ["proposal"],
    execute: () => Effect.succeed(candidate),
  }
}

describe("TG-FANOUT — Coordinator identity preservation and collect-only", () => {
  test("preserves exact candidate identity for each agent", async () => {
    const candidateA: ProposalCandidate = {
      agentId: "mock-a",
      reasoningStrength: "high",
      rationale: "reason a",
      proposedAction: "action a",
      tags: [],
      producedAt: 100,
    }
    const candidateB: ProposalCandidate = {
      agentId: "mock-b",
      reasoningStrength: "medium",
      rationale: "reason b",
      proposedAction: "action b",
      tags: [],
      producedAt: 200,
    }

    const results = await Effect.runPromise(collect(
      [makeManifest("a", candidateA), makeManifest("b", candidateB)],
      mockContext,
      mockCriteria,
    ))

    expect(results.length).toBe(2)
    expect(results[0].output).toBe(candidateA)
    expect(results[1].output).toBe(candidateB)
  })

  test("returns all candidates from all agents (no filtering)", async () => {
    const manifests = Array.from({ length: 5 }, (_, i) => {
      const candidate: ProposalCandidate = {
        agentId: `mock-${i}`,
        reasoningStrength: "low",
        rationale: `reason ${i}`,
        proposedAction: `action ${i}`,
        tags: [],
        producedAt: i,
      }
      return makeManifest(`agent-${i}`, candidate)
    })

    const results = await Effect.runPromise(collect(manifests, mockContext, mockCriteria))
    expect(results.length).toBe(5)
  })

  test("single agent returns single candidate", async () => {
    const candidate: ProposalCandidate = {
      agentId: "single",
      reasoningStrength: "low",
      rationale: "only",
      proposedAction: "only",
      tags: [],
      producedAt: 0,
    }
    const results = await Effect.runPromise(collect(
      [makeManifest("single", candidate)],
      mockContext,
      mockCriteria,
    ))
    expect(results.length).toBe(1)
    expect(results[0].output).toBe(candidate)
  })
})
