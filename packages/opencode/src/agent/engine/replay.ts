import { AgentStateMachine, AgentState } from "./state-machine"
import { validateDAG, type DAG } from "./dag"

export type ReplayMode = "dry-run" | "read-only" | "full"

export interface ReplayEvent {
  event_id: string
  session_id: string
  parent_event_id: string | null
  event_type: string
  payload: Record<string, unknown>
  sequence_index: number
  timestamp: number
}

export interface ReplayResult {
  mode: ReplayMode
  totalEvents: number
  replayedEvents: number
  skippedEvents: number
  stateTrajectory: Array<{ sequence: number; from: string; to: string }>
  differences: Array<{ sequence: number; expected: unknown; actual: unknown }>
  durationMs: number
}

export class SessionReplayer {
  private eventStream: ReplayEvent[] = []
  private stateMachine: AgentStateMachine

  constructor() {
    this.stateMachine = new AgentStateMachine()
  }

  loadEvents(events: ReplayEvent[]): void {
    this.eventStream = [...events].sort((a, b) => a.sequence_index - b.sequence_index)
  }

  async replay(mode: ReplayMode, executeHandler?: (event: ReplayEvent) => Promise<unknown>): Promise<ReplayResult> {
    const startTime = Date.now()
    const trajectory: ReplayResult["stateTrajectory"] = []
    const differences: ReplayResult["differences"] = []
    let replayed = 0
    let skipped = 0

    this.stateMachine.reset()

    for (const event of this.eventStream) {
      if (event.event_type === "state_transition") {
        const payload = event.payload as { from?: string; to?: string }
        if (payload.from && payload.to) {
          trajectory.push({
            sequence: event.sequence_index,
            from: payload.from,
            to: payload.to,
          })

          if (mode !== "dry-run") {
            try {
              await this.stateMachine.transition(payload.to as AgentState, "replay")
            } catch {
              differences.push({
                sequence: event.sequence_index,
                expected: `${payload.from}->${payload.to}`,
                actual: "invalid transition",
              })
            }
          }
        }
        replayed++
        continue
      }

      if (mode === "dry-run") {
        replayed++
        continue
      }

      const isDestructive = ["tool_call", "tool_result"].includes(event.event_type)
      if (mode === "read-only" && isDestructive) {
        skipped++
        continue
      }

      if (mode === "full" && executeHandler) {
        try {
          await executeHandler(event)
        } catch (err) {
          differences.push({
            sequence: event.sequence_index,
            expected: "success",
            actual: err instanceof Error ? err.message : String(err),
          })
        }
      }

      replayed++
    }

    return {
      mode,
      totalEvents: this.eventStream.length,
      replayedEvents: replayed,
      skippedEvents: skipped,
      stateTrajectory: trajectory,
      differences,
      durationMs: Date.now() - startTime,
    }
  }

  getStateMachine(): AgentStateMachine {
    return this.stateMachine
  }
}

export * as Replay from "./replay"
