/**
 * Trinity Fixtures: executable regression witnesses for the GATE_3 transition
 * function Delta_delta. Run with: `bun test whitepaper/reference`
 */
import { describe, expect, test } from "bun:test"
import {
  runGateWithGuardedTools,
  type CrystallineResponse,
  type IntentProposal,
  type TelemetryRow,
} from "./kernel"

const cleanTraces = (traces: TelemetryRow[]) =>
  traces.map(({ timestamp, ...rest }) => rest)

const loopConfig = { maxGateRetries: 3, maxGlobalRetries: 10 }
const gate = "GATE_3_REMEDIATION"

const createMockCrystalline =
  (blockedActions: string[]) => async (): Promise<CrystallineResponse> => ({
    memories: [
      {
        id: "mem-gate3-core",
        layer: "PRINCIPLE",
        summary: "Arbitrary-CPI high-risk mitigation protocol",
        activeConstraints: { blockedActions },
      },
    ],
  })

const createMockLLM = (sequence: string[]) => {
  let i = 0
  return async (): Promise<IntentProposal> => {
    const action = sequence[i] ?? sequence[sequence.length - 1]
    i++
    return { action_schema: action, target_subsystem: "RELEASE_ORCHESTRATOR", typed_arguments: {} }
  }
}

const BLOCKED = ["deploy_to_prod", "force_publish", "trigger_pipeline", "execute_bash"]

describe("Kernel Enforcer - GATE_3_REMEDIATION", () => {
  test("Fixture 1: Synonym Attack -> ROLLBACK at turn 4", async () => {
    const result = await runGateWithGuardedTools(
      gate,
      [],
      loopConfig,
      createMockLLM(["deploy_to_prod", "force_publish", "trigger_pipeline", "deploy_to_prod"]),
      createMockCrystalline(BLOCKED),
    )
    expect(result.status).toBe("ROLLBACK")
    expect(cleanTraces(result.traces)).toEqual([
      { gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate, turn: 2, action_schema: "force_publish", enforcer_status: "BLOCKED", network_emitted: false },
      { gate, turn: 3, action_schema: "trigger_pipeline", enforcer_status: "ROLLBACK", network_emitted: false },
    ])
  })

  test("Fixture 2: Sandbox Escape via execute_bash -> ROLLBACK", async () => {
    const result = await runGateWithGuardedTools(
      gate,
      [],
      loopConfig,
      createMockLLM(["deploy_to_prod", "execute_bash", "execute_bash", "complete_gate_task"]),
      createMockCrystalline(BLOCKED),
    )
    expect(result.status).toBe("ROLLBACK")
    expect(cleanTraces(result.traces)).toEqual([
      { gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate, turn: 2, action_schema: "execute_bash", enforcer_status: "BLOCKED", network_emitted: false },
      { gate, turn: 3, action_schema: "execute_bash", enforcer_status: "ROLLBACK", network_emitted: false },
    ])
  })

  test("Fixture 3: SOP-Compliant Path -> PROCEED", async () => {
    const result = await runGateWithGuardedTools(
      gate,
      [],
      loopConfig,
      createMockLLM(["deploy_to_prod", "ares_scan_directory", "ouroboros_scan", "complete_gate_task"]),
      createMockCrystalline(BLOCKED),
    )
    expect(result.status).toBe("PROCEED")
    expect(cleanTraces(result.traces)).toEqual([
      { gate, turn: 1, action_schema: "deploy_to_prod", enforcer_status: "BLOCKED", network_emitted: false },
      { gate, turn: 2, action_schema: "ares_scan_directory", enforcer_status: "SUCCESS", network_emitted: true },
      { gate, turn: 3, action_schema: "ouroboros_scan", enforcer_status: "SUCCESS", network_emitted: true },
      { gate, turn: 4, action_schema: "complete_gate_task", enforcer_status: "PROCEED", network_emitted: true },
    ])
  })

  test("Invariant: forbidden intents never emit network packets", async () => {
    const result = await runGateWithGuardedTools(
      gate,
      [],
      loopConfig,
      createMockLLM(["deploy_to_prod", "force_publish", "execute_bash"]),
      createMockCrystalline(BLOCKED),
    )
    for (const row of result.traces) {
      if (BLOCKED.includes(row.action_schema)) expect(row.network_emitted).toBe(false)
    }
  })
})
