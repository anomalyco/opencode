/**
 * Reference implementation of the Daemon Protocol GATE_3 shielded kernel.
 *
 * This is the concrete realisation of the deterministic transition function
 * Delta_delta described in `daemon_gate3_safety_model.tex`. It is intentionally
 * dependency-free so it can be read alongside the formal model and exercised by
 * the Trinity Fixtures in `kernel_enforcer.test.ts`.
 */

export type EnforcerStatus =
  | "BLOCKED"
  | "SUCCESS"
  | "FAILURE"
  | "ROLLBACK"
  | "PROCEED"

export interface TelemetryRow {
  gate: string
  turn: number
  action_schema: string
  enforcer_status: EnforcerStatus
  network_emitted: boolean // concrete instance of E_t in {0,1}
  timestamp: string
}

export interface TelemetrySink {
  append(row: TelemetryRow): void | Promise<void>
}

export class BlackBoxRecorder {
  private traces: TelemetryRow[] = []
  constructor(private sink?: TelemetrySink) {}

  record(row: Omit<TelemetryRow, "timestamp">): void {
    const entry: TelemetryRow = { ...row, timestamp: new Date().toISOString() }
    this.traces.push(entry)
    if (this.sink) void this.sink.append(entry)
  }

  getTraces(): TelemetryRow[] {
    return [...this.traces]
  }
}

export interface KernelRegisters {
  r_gate: number
  r_global: number
  turn: number
  sigma_sop: number // 0 = SOP not run, 1 = mandatory SOP cleared
}

export interface LoopConfig {
  maxGateRetries: number
  maxGlobalRetries: number
}

export interface IntentProposal {
  action_schema: string
  target_subsystem: string
  typed_arguments: Record<string, unknown>
}

export interface CrystallineResponse {
  memories: Array<{
    id: string
    layer: string
    summary: string
    activeConstraints?: { blockedActions?: string[]; requiredSOP?: string[] }
  }>
}

export interface LoopControl {
  shouldBreak: boolean
  finalStatus: "ROLLBACK" | "PENDING"
}

const SOP_TOOLS = new Set(["ares_scan_directory", "ouroboros_scan"])

/**
 * Atomic helper for hard violations (I_bad). Guarantees that register mutation,
 * telemetry logging, and loop-control are synchronised in a single place, which
 * removes the off-by-one / missing-log class of bugs.
 */
export function applyViolationPenalty(
  ctx: { gate: string; turn: number; action_schema: string; interruptMessage: string },
  registers: KernelRegisters,
  config: LoopConfig,
  recorder: BlackBoxRecorder,
  conversationHistory: unknown[],
): LoopControl {
  registers.r_gate++
  registers.r_global++

  const terminal =
    registers.r_gate >= config.maxGateRetries ||
    registers.r_global >= config.maxGlobalRetries

  const status: EnforcerStatus = terminal ? "ROLLBACK" : "BLOCKED"

  recorder.record({
    gate: ctx.gate,
    turn: ctx.turn,
    action_schema: ctx.action_schema,
    enforcer_status: status,
    network_emitted: false, // I_bad => E_t = 0
  })

  if (terminal) return { shouldBreak: true, finalStatus: "ROLLBACK" }

  // Dual-layer cognitive injection (audit + steering), only when non-terminal.
  conversationHistory.push({
    role: "tool",
    content: JSON.stringify({ status: "BLOCKED_BY_KERNEL", tool: ctx.action_schema }),
  })
  conversationHistory.push({ role: "system", content: ctx.interruptMessage })

  return { shouldBreak: false, finalStatus: "PENDING" }
}

/**
 * The GATE_3 kernel loop. Stochastic only in the planner; every other state
 * change is deterministic. Returns the terminal status and the full telemetry
 * trace (the empirical instantiation of T_t).
 */
export async function runGateWithGuardedTools(
  gate: string,
  initialHistory: unknown[],
  loopConfig: LoopConfig,
  llmPlanner: (history: unknown[]) => Promise<IntentProposal>,
  crystallineRecall: (action: string) => Promise<CrystallineResponse>,
  sink?: TelemetrySink,
): Promise<{ status: "PROCEED" | "ROLLBACK"; traces: TelemetryRow[] }> {
  const recorder = new BlackBoxRecorder(sink)
  const conversationHistory = [...initialHistory]
  const registers: KernelRegisters = { r_gate: 0, r_global: 0, turn: 1, sigma_sop: 0 }

  while (
    registers.r_gate < loopConfig.maxGateRetries &&
    registers.r_global < loopConfig.maxGlobalRetries
  ) {
    const intent = await llmPlanner(conversationHistory)
    const tool = intent.action_schema

    const recall = await crystallineRecall(tool)
    const blocked = recall.memories[0]?.activeConstraints?.blockedActions ?? []

    const isBlocked = blocked.includes(tool)
    const isIllegalExit = tool === "complete_gate_task" && registers.sigma_sop === 0

    // f_enforce == 1 : hard violation
    if (isBlocked || isIllegalExit) {
      const interruptMessage = isIllegalExit
        ? "[SECURITY INTERRUPT] Cannot close gate. Mandatory SOP scanner missing."
        : `[SECURITY INTERRUPT] Action '${tool}' rejected by kernel shield constraints.`
      const control = applyViolationPenalty(
        { gate, turn: registers.turn, action_schema: tool, interruptMessage },
        registers,
        loopConfig,
        recorder,
        conversationHistory,
      )
      if (control.shouldBreak) return { status: "ROLLBACK", traces: recorder.getTraces() }
      registers.turn++
      continue
    }

    // f_enforce == 0 : safe path
    if (SOP_TOOLS.has(tool)) {
      registers.sigma_sop = 1
      registers.r_gate = 0 // tactical reward for returning to SOP
      recorder.record({
        gate,
        turn: registers.turn,
        action_schema: tool,
        enforcer_status: "SUCCESS",
        network_emitted: true,
      })
      conversationHistory.push({
        role: "tool",
        content: JSON.stringify({ status: "SUCCESS", output: "SCAN_CLEAN_NO_HIGH_RISK" }),
      })
      registers.turn++
      continue
    }

    if (tool === "complete_gate_task" && registers.sigma_sop === 1) {
      recorder.record({
        gate,
        turn: registers.turn,
        action_schema: tool,
        enforcer_status: "PROCEED",
        network_emitted: true,
      })
      return { status: "PROCEED", traces: recorder.getTraces() }
    }

    // Unknown / unhandled tool in the safe path: treat conservatively as a
    // violation rather than allowing an unmodelled transition.
    const control = applyViolationPenalty(
      {
        gate,
        turn: registers.turn,
        action_schema: tool,
        interruptMessage: `[SECURITY INTERRUPT] Unmodelled tool '${tool}' rejected (default-deny).`,
      },
      registers,
      loopConfig,
      recorder,
      conversationHistory,
    )
    if (control.shouldBreak) return { status: "ROLLBACK", traces: recorder.getTraces() }
    registers.turn++
  }

  return { status: "ROLLBACK", traces: recorder.getTraces() }
}
