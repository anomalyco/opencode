import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { LoopState, PhaseDefineParams } from "./loop-state"

type Metadata = {
  phaseId?: string
}

export const PhaseDefineTool = Tool.define<typeof PhaseDefineParams, Metadata, LoopState.Service>(
  "loop_phase_define",
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    return {
      description:
        "Update the details of a specific phase in the current plan. Use to refine scope, acceptance criteria, or interface contracts as the plan evolves.",
      parameters: PhaseDefineParams,
      execute: (
        params: Schema.Schema.Type<typeof PhaseDefineParams>,
        ctx: Tool.Context<Metadata>,
      ) =>
        Effect.gen(function* () {
          const current = yield* loop.get()
          if (!current.plan) {
            return {
              title: "No plan",
              output: "No plan has been created yet. Use loop_plan_create first.",
              metadata: {} as Metadata,
            }
          }

          const phaseIndex = current.plan.phases.findIndex((p) => p.id === params.phaseId)
          if (phaseIndex === -1) {
            return {
              title: "Phase not found",
              output: `Phase "${params.phaseId}" not found in the current plan.`,
              metadata: {} as Metadata,
            }
          }

          yield* loop.update((state) => {
            if (!state.plan) return state
            const phase = state.plan.phases[phaseIndex]
            if (!phase) return state

            const updated = { ...phase }
            if (params.spec !== undefined) updated.scope = params.spec
            if (params.acceptanceCriteria !== undefined) updated.acceptanceCriteria = [...params.acceptanceCriteria]
            if (params.interfaceContract !== undefined) updated.interfaceContract = params.interfaceContract

            if (updated.status === "failed") {
              updated.status = "pending"
              updated.attempts = 0
            }

            const newPhases = [...state.plan.phases]
            newPhases[phaseIndex] = updated

            return {
              ...state,
              plan: { ...state.plan, phases: newPhases },
            }
          })

          yield* ctx.metadata({
            title: `Phase updated: ${params.phaseId}`,
            metadata: { phaseId: params.phaseId },
          })

          return {
            title: "Phase updated",
            output: `Phase "${params.phaseId}" has been updated.`,
            metadata: { phaseId: params.phaseId },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof PhaseDefineParams, Metadata>
  }),
)
