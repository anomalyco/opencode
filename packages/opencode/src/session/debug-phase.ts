export namespace DebugPhase {
  export const PHASES = [
    "PLANNING",
    "CODING",
    "BREAKPOINTING",
    "DEBUGGING",
    "EXPLAINING",
    "CONFIRMING",
  ] as const

  export type Phase = (typeof PHASES)[number]

  export interface State {
    sessionID: string
    currentPhase: Phase
    currentStep: number
    totalSteps: number | null
    stepDescriptions: string[]
    autoConfirm: boolean
  }

  const VALID_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
    PLANNING: ["CODING"],
    CODING: ["BREAKPOINTING"],
    BREAKPOINTING: ["DEBUGGING"],
    DEBUGGING: ["EXPLAINING"],
    EXPLAINING: ["CONFIRMING"],
    CONFIRMING: ["PLANNING"],
  }

  const PHASE_TOOLS: Readonly<Record<Phase, readonly string[]>> = {
    PLANNING: ["read", "glob", "grep", "task", "transitionPhase"],
    CODING: ["read", "glob", "grep", "edit", "write", "bash", "apply_patch", "transitionPhase"],
    BREAKPOINTING: [
      "debugger_set_breakpoints",
      "debugger_remove_breakpoints",
      "debugger_list_breakpoints",
      "read",
      "transitionPhase",
    ],
    DEBUGGING: [
      "debugger_start_debug_session",
      "debugger_continue_execution",
      "debugger_step_over",
      "debugger_step_into",
      "debugger_step_out",
      "debugger_get_variables",
      "debugger_get_call_stack",
      "debugger_evaluate_expression",
      "debugger_list_breakpoints",
      "transitionPhase",
    ],
    EXPLAINING: ["transitionPhase"],
    CONFIRMING: ["debugger_stop_debug_session", "transitionPhase"],
  }

  // In-memory store keyed by session ID. Callers should invoke clear(sessionID)
  // when a session ends to prevent unbounded growth in long-running processes.
  const store = new Map<string, State>()

  export function create(sessionID: string): State {
    const state: State = {
      sessionID,
      currentPhase: "PLANNING",
      currentStep: 0,
      totalSteps: null,
      stepDescriptions: [],
      autoConfirm: false,
    }
    store.set(sessionID, state)
    return state
  }

  export function get(sessionID: string): State | undefined {
    return store.get(sessionID)
  }

  export function getOrCreate(sessionID: string): State {
    return store.get(sessionID) ?? create(sessionID)
  }

  export function transition(state: State, to: Phase): State {
    const allowed = VALID_TRANSITIONS[state.currentPhase]
    if (!allowed.includes(to)) {
      throw new Error(
        `Cannot transition from ${state.currentPhase} to ${to}. Valid transitions: ${allowed.join(", ")}`,
      )
    }

    let nextStep = state.currentStep
    if (state.currentPhase === "CONFIRMING" && to === "PLANNING") {
      nextStep = state.currentStep + 1
    }

    const next: State = {
      ...state,
      currentPhase: to,
      currentStep: nextStep,
    }
    store.set(state.sessionID, next)
    return next
  }

  export function toolsForPhase(phase: Phase): string[] {
    return [...PHASE_TOOLS[phase]]
  }

  export function isDebugAgent(agentName: string): boolean {
    return agentName === "debug"
  }

  export function isToolAllowed(phase: Phase, toolID: string): boolean {
    return PHASE_TOOLS[phase].includes(toolID)
  }

  export function setAutoConfirm(sessionID: string, value: boolean): void {
    const state = store.get(sessionID)
    if (state) {
      store.set(sessionID, { ...state, autoConfirm: value })
    }
  }

  export function clear(sessionID: string): void {
    store.delete(sessionID)
  }
}
