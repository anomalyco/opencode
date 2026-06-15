import { Effect, Schema, Clock, Option } from "effect"
import * as Tool from "./tool"
import { LoopState, PlanCreateParams, type Phase, type Plan } from "./loop-state"
import { LoopOrchestrator } from "./loop-orchestrator"

type Metadata = {
  phases?: string[]
}

export const PlanCreateTool = Tool.define<typeof PlanCreateParams, Metadata, LoopState.Service>(
  "loop_plan_create",
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    const maybeOrchestrator = yield* Effect.serviceOption(LoopOrchestrator.Service)
    return {
      description:
        "Create a development plan with phases. Each phase defines a scope, acceptance criteria, and interface contract. Use this at the start of loop mode to decompose a large task into executable phases.",
      parameters: PlanCreateParams,
      execute: (
        params: Schema.Schema.Type<typeof PlanCreateParams>,
        ctx: Tool.Context<Metadata>,
      ) =>
        Effect.gen(function* () {
          const current = yield* loop.get()
          if (current.plan) {
            return {
              title: "Plan already exists",
              output: "A plan has already been created. Use loop_phase_define to update phases or loop_complete to reset.",
              metadata: {} as Metadata,
            }
          }

          if (params.phases.length < 1) {
            return {
              title: "Invalid plan",
              output: "A plan must have at least 1 phase.",
              metadata: {} as Metadata,
            }
          }

          if (params.phases.length > 10) {
            return {
              title: "Too many phases",
              output: "A plan can have at most 10 phases. Please consolidate.",
              metadata: {} as Metadata,
            }
          }

          const ids = new Set(params.phases.map((p) => p.id))
          if (ids.size !== params.phases.length) {
            return {
              title: "Duplicate phase IDs",
              output: "All phase IDs must be unique.",
              metadata: {} as Metadata,
            }
          }

          const now = yield* Clock.currentTimeMillis
          const phases: Phase[] = params.phases.map((p) => ({
            id: p.id,
            title: p.title,
            scope: p.scope,
            acceptanceCriteria: [...p.acceptanceCriteria],
            interfaceContract: p.interfaceContract,
            status: "pending",
            attempts: 0,
            result: undefined,
          }))

          const plan: Plan = {
            description: params.description,
            phases,
            createdAt: now,
            currentPhaseIndex: 0,
          }

          yield* loop.set({
            ...current,
            plan,
            startedAt: now,
            status: "running",
          })

          const orchestrator = Option.getOrThrow(maybeOrchestrator)
          yield* orchestrator.start()
          if (phases.length > 0) yield* orchestrator.startPhase(phases[0].id, ctx.sessionID, phases[0].title, phases.length)

          yield* ctx.metadata({
            title: `Plan created: ${params.description.slice(0, 60)}`,
            metadata: { phases: params.phases.map((p) => p.id) },
          })

          return {
            title: "Plan created",
            output: [
              `# Plan: ${params.description}`,
              "",
              `Total phases: ${params.phases.length}`,
              "",
              ...params.phases.map(
                (p, i) =>
                  `## Phase ${i + 1}: ${p.title} (${p.id})\n${p.scope}\n\nAcceptance Criteria:\n${p.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")}${p.interfaceContract ? `\n\nInterface Contract:\n${p.interfaceContract}` : ""}`,
              ),
              "",
              "Run loop_phase_define to update details, then delegate each phase via the task tool.",
            ].join("\n"),
            metadata: { phases: params.phases.map((p) => p.id) },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof PlanCreateParams, Metadata>
  }),
)
