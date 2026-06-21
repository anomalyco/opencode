import { describe, expect, test } from "bun:test"
import { REGISTERED_AGENTS } from "@/evolution/decision/agents/register"

describe("G4-01 — Agent Registry v1", () => {
  test("registry exports AgentManifest[] (not AgentFn[])", () => {
    expect(Array.isArray(REGISTERED_AGENTS)).toBe(true)
    expect(REGISTERED_AGENTS.length).toBeGreaterThanOrEqual(3)
  })

  test("each manifest has id, capabilities, execute", () => {
    for (const m of REGISTERED_AGENTS) {
      expect(typeof m.id).toBe("string")
      expect(Array.isArray(m.capabilities)).toBe(true)
      expect(typeof m.execute).toBe("function")
    }
  })

  test("context-analyst has proposal capability", () => {
    const analyst = REGISTERED_AGENTS.find((a) => a.id === "context-analyst")
    expect(analyst).toBeDefined()
    expect(analyst!.capabilities).toContain("proposal")
  })

  test("risk-agent has risk-analysis capability", () => {
    const risk = REGISTERED_AGENTS.find((a) => a.id === "risk-agent")
    expect(risk).toBeDefined()
    expect(risk!.capabilities).toContain("risk-analysis")
    expect(risk!.capabilities).not.toContain("proposal")
  })

  test("planning-agent has execution-plan capability", () => {
    const planner = REGISTERED_AGENTS.find((a) => a.id === "planning-agent")
    expect(planner).toBeDefined()
    expect(planner!.capabilities).toContain("execution-plan")
    expect(planner!.capabilities).not.toContain("proposal")
  })

  test("exactly one agent has proposal capability (G4 scope)", () => {
    const proposalAgents = REGISTERED_AGENTS.filter((a) => a.capabilities.includes("proposal"))
    expect(proposalAgents.length).toBe(1)
    expect(proposalAgents[0].id).toBe("context-analyst")
  })
})
