import { Effect, Layer, Context } from "effect"
import { EngineAdapter, createEngineAdapter, type ToolAdapter } from "./engine-adapter"
import type { AgentEngine, EngineConfig, EngineSnapshot } from "./engine"
import type { DAG } from "./engine/dag"
import type { Capability, ExecutionStrategy } from "./engine/planner"
import type { ContextSummary } from "./engine/checkpoint"
import type { SessionBranch } from "./engine/branch"

export interface EngineServiceInterface {
  readonly adapter: EngineAdapter
  readonly registerTools: (adapters: ToolAdapter[]) => void
  readonly run: (
    sessionId: string,
    goal: string,
    workspaceHash: string,
  ) => Effect.Effect<
    { completed: boolean; allSucceeded: boolean; stepCount: number; tokenUsage: number },
    Error
  >
  readonly getEngine: () => AgentEngine | null
  readonly getSnapshot: () => Effect.Effect<EngineSnapshot, Error>
  readonly initialize: (sessionId: string, goal: string, workspaceHash?: string) => Effect.Effect<void, Error>
  readonly plan: (goal: string, capabilities: Capability[]) => Effect.Effect<{ dag: DAG; strategy: ExecutionStrategy }, Error>
  readonly executeStep: () => Effect.Effect<{ completed: boolean; allSucceeded: boolean }, Error>
  readonly createCheckpoint: () => Effect.Effect<string, Error>
  readonly createL2Checkpoint: (contextSummary: ContextSummary, gitHeadHash: string) => Effect.Effect<string, Error>
  readonly resume: (checkpointId?: string, workspaceHash?: string, gitHeadHash?: string) => Effect.Effect<EngineSnapshot | null, Error>
  readonly rollback: (checkpointId: string) => Effect.Effect<EngineSnapshot | null, Error>
  readonly pause: () => Effect.Effect<void, Error>
  readonly shutdown: () => Effect.Effect<void, Error>
  readonly fork: (branchName: string) => Effect.Effect<SessionBranch, Error>
  readonly getDAG: () => Effect.Effect<DAG | null, Error>
}

export class EngineService extends Context.Service<EngineService, EngineServiceInterface>()(
  "@fengru/EngineService",
) {}

export const layer = Layer.effect(
  EngineService,
  Effect.gen(function* () {
    const adapter = createEngineAdapter()

    const requireEngine = <A>(fn: (engine: AgentEngine) => A | Promise<A>) =>
      Effect.tryPromise(async () => {
        const engine = adapter.getEngine()
        if (!engine) throw new Error("Engine not initialized. Call createEngine() first.")
        return fn(engine)
      })

    const svc: EngineServiceInterface = {
      adapter,

      registerTools: (adapters: ToolAdapter[]) => {
        adapter.registerTools(adapters)
      },

      run: (sessionId: string, goal: string, workspaceHash: string) =>
        Effect.tryPromise(async () => {
          const result = await adapter.runWithEngine(sessionId, goal, workspaceHash)
          return result
        }),

      getEngine: () => adapter.getEngine(),

      getSnapshot: () => requireEngine((e) => e.getSnapshot()),

      initialize: (sessionId, goal, workspaceHash) =>
        requireEngine((e) => e.initialize(sessionId, goal, workspaceHash)),

      plan: (goal, capabilities) =>
        requireEngine((e) => e.plan(goal, capabilities)),

      executeStep: () =>
        requireEngine((e) => e.executeStep()),

      createCheckpoint: () =>
        requireEngine((e) => e.createCheckpoint()),

      createL2Checkpoint: (contextSummary, gitHeadHash) =>
        requireEngine((e) => e.createL2Checkpoint(contextSummary, gitHeadHash)),

      resume: (checkpointId, workspaceHash, gitHeadHash) =>
        requireEngine((e) => e.resume(checkpointId, workspaceHash, gitHeadHash)),

      rollback: (checkpointId) =>
        requireEngine((e) => e.rollbackToCheckpoint(checkpointId)),

      pause: () =>
        requireEngine((e) => e.pause()),

      shutdown: () =>
        requireEngine((e) => e.shutdown()),

      fork: (branchName) =>
        requireEngine((e) => e.fork(branchName)),

      getDAG: () =>
        requireEngine((e) => e.getDAG()),
    }

    return EngineService.of(svc)
  }),
)

export const defaultLayer = layer
