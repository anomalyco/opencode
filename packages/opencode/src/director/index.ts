export * as Director from "."

import { Config } from "@/config/config"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"

export interface WorkerEntry {
  agent: string
  tasksCompleted: number
  tasksFailed: number
  lastTask: string
  lastOutcome: "success" | "failure"
  consecutiveFailures: number
}

type State = {
  workers: Map<string, WorkerEntry>
}

export interface Interface {
  readonly recordSuccess: (agent: string, task: string) => Effect.Effect<void>
  readonly recordFailure: (agent: string, task: string) => Effect.Effect<void>
  readonly getStats: (agent: string) => Effect.Effect<WorkerEntry | undefined>
  readonly getAllStats: () => Effect.Effect<WorkerEntry[]>
  readonly resetStats: (agent: string) => Effect.Effect<void>
  readonly shouldReplace: (agent: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Director") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Director.state")(function* () {
        return { workers: new Map() }
      }),
    )

    const getEntry = Effect.fnUntraced(function* (agent: string) {
      const s = yield* InstanceState.get(state)
      let entry = s.workers.get(agent)
      if (!entry) {
        entry = { agent, tasksCompleted: 0, tasksFailed: 0, lastTask: "", lastOutcome: "success", consecutiveFailures: 0 }
        s.workers.set(agent, entry)
      }
      return entry
    })

    const recordSuccess = Effect.fn("Director.recordSuccess")(function* (agent: string, task: string) {
      const cfg = yield* config.get()
      if (!cfg.director?.statsEnabled) return
      const entry = yield* getEntry(agent)
      entry.tasksCompleted++
      entry.lastTask = task
      entry.lastOutcome = "success"
      entry.consecutiveFailures = 0
    })

    const recordFailure = Effect.fn("Director.recordFailure")(function* (agent: string, task: string) {
      const cfg = yield* config.get()
      if (!cfg.director?.statsEnabled) return
      const entry = yield* getEntry(agent)
      entry.tasksFailed++
      entry.lastTask = task
      entry.lastOutcome = "failure"
      entry.consecutiveFailures++
    })

    const getStats = Effect.fn("Director.getStats")(function* (agent: string) {
      const s = yield* InstanceState.get(state)
      return s.workers.get(agent)
    })

    const getAllStats = Effect.fn("Director.getAllStats")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.workers.values()]
    })

    const resetStats = Effect.fn("Director.resetStats")(function* (agent: string) {
      const s = yield* InstanceState.get(state)
      s.workers.delete(agent)
    })

    const shouldReplace = Effect.fn("Director.shouldReplace")(function* (agent: string) {
      const cfg = yield* config.get()
      const minRate = cfg.director?.minSuccessRate ?? 0.6
      const entry = yield* getEntry(agent)
      const total = entry.tasksCompleted + entry.tasksFailed
      if (total < 3) return false
      const rate = total > 0 ? entry.tasksCompleted / total : 0
      return rate < minRate
    })

    return Service.of({ recordSuccess, recordFailure, getStats, getAllStats, resetStats, shouldReplace })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const node = LayerNode.make({ service: Service, layer, deps: [Config.node] })
