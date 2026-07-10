export const AgentState = {
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
  READY: "READY",
  PLANNING: "PLANNING",
  THINKING: "THINKING",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  COMPACTING: "COMPACTING",
  PAUSED: "PAUSED",
  FAILED: "FAILED",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
  RECOVERING: "RECOVERING",
  SHUTTING_DOWN: "SHUTTING_DOWN",
} as const

export type AgentState = (typeof AgentState)[keyof typeof AgentState]

const VALID_TRANSITIONS = new Set<string>([
  "IDLE->INITIALIZING",
  "INITIALIZING->READY",
  "READY->PLANNING",
  "READY->THINKING",
  "READY->PAUSED",
  "READY->SHUTTING_DOWN",
  "PLANNING->THINKING",
  "PLANNING->EXECUTING",
  "PLANNING->PAUSED",
  "THINKING->EXECUTING",
  "THINKING->PAUSED",
  "EXECUTING->VERIFYING",
  "EXECUTING->PAUSED",
  "EXECUTING->FAILED",
  "VERIFYING->READY",
  "VERIFYING->THINKING",
  "VERIFYING->COMPACTING",
  "VERIFYING->COMPLETED",
  "VERIFYING->PAUSED",
  "VERIFYING->FAILED",
  "PAUSED->READY",
  "PAUSED->RECOVERING",
  "FAILED->RECOVERING",
  "FAILED->READY",
  "FAILED->SHUTTING_DOWN",
  "COMPACTING->READY",
  "RECOVERING->READY",
  "RECOVERING->FAILED",
  "COMPLETED->INITIALIZING",
  "FAILED->INITIALIZING",
  "SHUTTING_DOWN->INITIALIZING",
  "THINKING->INITIALIZING",
  "VERIFYING->INITIALIZING",
  "PAUSED->INITIALIZING",
  "PLANNING->INITIALIZING",
  "READY->INITIALIZING",
  "ERROR->READY",
  "ERROR->RECOVERING",
  "ERROR->SHUTTING_DOWN",
])

export class StateTransitionError extends Error {
  constructor(from: AgentState, to: AgentState) {
    super(`Invalid state transition: ${from} -> ${to}`)
    this.name = "StateTransitionError"
  }
}

export type TransitionCallback = (prev: AgentState, next: AgentState, reason?: string) => Promise<void>

export interface StateMachineSnapshot {
  current_state: AgentState
  previous_state: AgentState
  transition_count: number
  state_history: Array<{
    from: AgentState
    to: AgentState
    timestamp: number
    reason?: string
  }>
}

export interface StateMetrics {
  enter_count: number
  total_time_ms: number
  avg_time_ms: number
}

export class AgentStateMachine {
  private currentState: AgentState = AgentState.IDLE
  private previousState: AgentState = AgentState.IDLE
  private transitionCount = 0
  private stateHistory: StateMachineSnapshot["state_history"] = []
  private stateEnterTimes = new Map<AgentState, number>()
  private stateMetrics = new Map<AgentState, StateMetrics>()
  private onEnterCallbacks = new Map<AgentState, TransitionCallback[]>()
  private onExitCallbacks = new Map<AgentState, TransitionCallback[]>()

  get state(): AgentState {
    return this.currentState
  }

  get prevState(): AgentState {
    return this.previousState
  }

  get transitions(): number {
    return this.transitionCount
  }

  canTransition(from: AgentState, to: AgentState): boolean {
    return VALID_TRANSITIONS.has(`${from}->${to}`)
  }

  async transition(to: AgentState, reason?: string): Promise<void> {
    const from = this.currentState

    if (!this.canTransition(from, to)) {
      const isErrorState = to === AgentState.ERROR
      if (!isErrorState) {
        throw new StateTransitionError(from, to)
      }
    }

    const exitCallbacks = this.onExitCallbacks.get(from) ?? []
    for (const cb of exitCallbacks) {
      await cb(from, to)
    }

    const exitTime = Date.now()
    const entryTime = this.stateEnterTimes.get(from)
    if (entryTime) {
      const duration = exitTime - entryTime
      const metrics = this.stateMetrics.get(from) ?? {
        enter_count: 0,
        total_time_ms: 0,
        avg_time_ms: 0,
      }
      metrics.total_time_ms += duration
      metrics.enter_count += 1
      metrics.avg_time_ms = metrics.total_time_ms / metrics.enter_count
      this.stateMetrics.set(from, metrics)
    }

    this.previousState = from
    this.currentState = to
    this.transitionCount++
    this.stateEnterTimes.set(to, exitTime)

    this.stateHistory.push({
      from,
      to,
      timestamp: exitTime,
      reason,
    })

    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-100)
    }

    const enterCallbacks = this.onEnterCallbacks.get(to) ?? []
    for (const cb of enterCallbacks) {
      await cb(from, to, reason)
    }
  }

  onEnter(state: AgentState, callback: TransitionCallback): void {
    const callbacks = this.onEnterCallbacks.get(state) ?? []
    callbacks.push(callback)
    this.onEnterCallbacks.set(state, callbacks)
  }

  onExit(state: AgentState, callback: TransitionCallback): void {
    const callbacks = this.onExitCallbacks.get(state) ?? []
    callbacks.push(callback)
    this.onExitCallbacks.set(state, callbacks)
  }

  getSnapshot(): StateMachineSnapshot {
    return {
      current_state: this.currentState,
      previous_state: this.previousState,
      transition_count: this.transitionCount,
      state_history: [...this.stateHistory].slice(-20),
    }
  }

  getStateMetrics(): Record<AgentState, StateMetrics> {
    const result: Record<string, StateMetrics> = {}
    for (const [state, metrics] of this.stateMetrics) {
      result[state] = { ...metrics }
    }
    for (const state of Object.values(AgentState)) {
      if (!result[state]) {
        result[state] = { enter_count: 0, total_time_ms: 0, avg_time_ms: 0 }
      }
    }
    return result as Record<AgentState, StateMetrics>
  }

  toPrometheusMetrics(name: string = "agent_state_machine"): string {
    const metrics = this.getStateMetrics()
    const lines = [`# StateMachine: ${name}`]
    for (const [state, data] of Object.entries(metrics)) {
      lines.push(`state_enter_count{state="${state}"} ${data.enter_count}`)
      lines.push(`state_total_time_ms{state="${state}"} ${data.total_time_ms}`)
      lines.push(`state_avg_time_ms{state="${state}"} ${data.avg_time_ms.toFixed(2)}`)
    }
    return lines.join("\n")
  }

  reset(): void {
    this.currentState = AgentState.IDLE
    this.previousState = AgentState.IDLE
    this.transitionCount = 0
    this.stateHistory = []
    this.stateEnterTimes.clear()
    this.stateMetrics.clear()
  }

  /** Restore state machine from a checkpoint snapshot without triggering callbacks. */
  restore(snapshot: StateMachineSnapshot): void {
    this.currentState = snapshot.current_state
    this.previousState = snapshot.previous_state
    this.transitionCount = snapshot.transition_count
    this.stateHistory = [...snapshot.state_history]
    this.stateEnterTimes.set(this.currentState, Date.now())
  }
}

export * as StateMachine from "./state-machine"
