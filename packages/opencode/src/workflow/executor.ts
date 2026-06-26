import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { WorkflowLimitError, DEFAULTS } from "./limits"
import { spawnWorker, type TaskPromptOps } from "@/tool/task"
import { Agent } from "@/agent/agent"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Tool } from "@/tool/tool"
import { Context, Effect, Layer, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "workflow.executor" })

const WorkflowSpawnEvent = BusEvent.define("workflow.spawn", Schema.Struct({
  workerIndex: Schema.Number,
  agent: Schema.String,
  prompt: Schema.String,
}))

const WorkflowCompleteEvent = BusEvent.define("workflow.complete", Schema.Struct({
  workerIndex: Schema.Number,
  sessionID: Schema.String,
  ok: Schema.Boolean,
}))

const WorkflowFailEvent = BusEvent.define("workflow.fail", Schema.Struct({
  workerIndex: Schema.Number,
  error: Schema.String,
}))

const WorkflowProgressEvent = BusEvent.define("workflow.progress", Schema.Struct({
  completed: Schema.Number,
  total: Schema.Number,
  active: Schema.Number,
}))

export interface AgentResult {
  text: string
  ok: boolean
  sessionID: string
}

export interface WorkflowHelpers {
  agent: (params: { prompt: string; agent?: string; model?: string }) => Promise<AgentResult>
  parallel: <T>(items: T[], fn: (item: T) => Promise<AgentResult>, concurrency?: number) => Promise<AgentResult[]>
  sleep: (ms: number) => Promise<void>
}

export interface ExecuteInput {
  script: string
  args?: string
  parentSessionID: SessionID
  parentAgent: Agent.Info | undefined
  model?: { modelID: ModelID; providerID: ProviderID }
  ops: TaskPromptOps
  ctx: Pick<Tool.Context, "abort" | "ask" | "metadata" | "extra">
}

export interface Interface {
  readonly execute: (input: ExecuteInput) => Effect.Effect<string, WorkflowLimitError | Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const bus = yield* Bus.Service

    const execute = Effect.fn("Workflow.execute")(function* (input: ExecuteInput) {
      log.info("executing workflow", { parentSessionID: input.parentSessionID })

      const cfg = yield* config.get()
      const maxConcurrency = cfg.workflow?.max_concurrency ?? DEFAULTS.max_concurrency
      const maxAgents = cfg.workflow?.max_agents ?? DEFAULTS.max_agents
      const timeoutMs = cfg.workflow?.timeout_ms ?? DEFAULTS.timeout_ms

      const bridge = yield* EffectBridge.make()

      const state = {
        totalWorkers: 0,
        activeWorkers: 0,
        workerIndexCounter: 0,
      }

      function nextWorkerIndex() {
        return state.workerIndexCounter++
      }

      const agent = async (params: { prompt: string; agent?: string; model?: string }): Promise<AgentResult> => {
        const idx = nextWorkerIndex()
        state.totalWorkers++
        state.activeWorkers++

        if (state.totalWorkers > maxAgents) {
          throw new WorkflowLimitError({ limit: "max_agents", value: state.totalWorkers, max: maxAgents })
        }

        const agentName = params.agent ?? "general"

        await bridge.promise(bus.publish(WorkflowSpawnEvent, {
          workerIndex: idx,
          agent: agentName,
          prompt: params.prompt,
        }))

        try {
          const result = await bridge.promise(spawnWorker({
            subagentType: agentName,
            prompt: params.prompt,
            parentSessionID: input.parentSessionID,
            parentAgent: input.parentAgent,
            model: input.model,
            ops: input.ops,
            ctx: input.ctx,
            bypassAgentCheck: true,
          }).pipe(
            Effect.tap((r) => bus.publish(WorkflowCompleteEvent, {
              workerIndex: idx,
              sessionID: r.sessionID,
              ok: true,
            })),
          ))

          state.activeWorkers--
          await bridge.promise(bus.publish(WorkflowProgressEvent, {
            completed: state.totalWorkers - state.activeWorkers,
            total: state.totalWorkers,
            active: state.activeWorkers,
          }))

          return { text: result.text, ok: true, sessionID: result.sessionID }
        } catch (err) {
          state.activeWorkers--
          const errMsg = err instanceof Error ? err.message : String(err)
          await bridge.promise(bus.publish(WorkflowFailEvent, {
            workerIndex: idx,
            error: errMsg,
          }))
          return { text: "", ok: false, sessionID: "" }
        }
      }

      const parallel = async <T>(
        items: T[],
        fn: (item: T) => Promise<AgentResult>,
        concurrency?: number,
      ): Promise<AgentResult[]> => {
        const limit = Math.min(concurrency ?? maxConcurrency, maxConcurrency)
        const results: AgentResult[] = []
        for (let i = 0; i < items.length; i += limit) {
          const batch = items.slice(i, i + limit)
          const batchResults = await Promise.all(batch.map(fn))
          results.push(...batchResults)
        }
        return results
      }

      const sleep = async (ms: number): Promise<void> => {
        await bridge.promise(Effect.sleep(ms))
      }

      const helpers: WorkflowHelpers = { agent, parallel, sleep }
      const argsValue = input.args ?? ""

      const { executeScript } = yield* Effect.promise(() => import("./runtime"))

      return yield* Effect.callback<string, Error>((resume) => {
        executeScript(input.script, helpers, argsValue)
          .then((value) => resume(Effect.succeed(typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value))))
          .catch((err) => resume(Effect.fail(err instanceof Error ? err : new Error(String(err)))))
      }).pipe(
        Effect.timeout(timeoutMs),
        Effect.catchCause((cause) => Effect.fail(new Error(String(cause)))),
      )
    })

    return Service.of({ execute })
  }),
)

export * as WorkflowExecutor from "./executor"
