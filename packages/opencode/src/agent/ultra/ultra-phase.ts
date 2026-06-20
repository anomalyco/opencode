import * as Tool from "@/tool/tool"
import { Schema } from "effect"
import { use as useUltra, type Phase } from "./ultra-state"

export const Parameters = Schema.Struct({
  phase: Schema.Literals(["planning", "building", "verifying", "iterating", "complete"]).annotate({
    description: "The phase to transition to",
  }),
})

export const UltraPhaseTool = Tool.define(
  "ultra_phase",
  Effect.gen(function* () {
    const ultra = yield* useUltra

    return {
      description: [
        "Transition the Ultra agent to a new phase.",
        "Valid transitions: planning→building, building→verifying, verifying→iterating|complete, iterating→verifying.",
        "Use this to manually advance the state machine when the LLM decides the current phase is done.",
      ].join(" "),
      parameters: Parameters,
      execute: (args, ctx) =>
        Effect.gen(function* () {
          const state = yield* ultra.get(ctx.sessionID)
          if (!state) {
            return {
              title: "Phase Transition",
              metadata: {},
              output: "ERROR: Ultra state not initialized. Start with a fresh session.",
            }
          }

          const result = yield* ultra.transition(ctx.sessionID, args.phase as Phase).pipe(
            Effect.catchAll((error) => Effect.succeed(error)),
          )

          if (result instanceof Error) {
            return {
              title: "Phase Transition",
              metadata: { error: true },
              output: `TRANSITION FAILED: ${result.message}\n\nCurrent phase: ${state.phase}`,
            }
          }

          const updated = yield* ultra.get(ctx.sessionID)
          return {
            title: "Phase Transition",
            metadata: { phase: updated?.phase },
            output: [
              `Phase transitioned: ${state.phase} → ${updated?.phase}`,
              "",
              updated?.phase === "planning"
                ? "Now in PLANNING phase. Read the codebase, understand requirements, and write a plan. Do NOT edit files."
                : updated?.phase === "building"
                  ? "Now in BUILDING phase. Implement the plan. All tools are available."
                  : updated?.phase === "verifying"
                    ? `Now in VERIFYING phase. Run ultra_verify to test. Retry ${updated.retries}/${10}.`
                    : updated?.phase === "iterating"
                      ? `Now in ITERATING phase. Fix failures. Retry ${updated.retries}/${10}.`
                      : "COMPLETE. All work is done.",
            ].join("\n"),
          }
        }),
    }
  }),
)
