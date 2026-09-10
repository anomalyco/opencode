import { Context, Effect, Option } from "effect"

// Fiber-scoped aggregate authority keeps the replay bridge free of closure and Session assumptions.

export interface Scope {
  readonly aggregates: ReadonlySet<string>
}

export class Service extends Context.Service<Service, Scope>()("@opencode/SessionReplayPermit") {}

/** Missing total coverage is a programming defect; ordinary fence refusal occurs before EventV2. */
export const require_ = (aggregates: readonly string[]) =>
  Effect.serviceOption(Service).pipe(
    Effect.flatMap((found) => {
      if (Option.isSome(found) && aggregates.every((aggregate) => found.value.aggregates.has(aggregate)))
        return Effect.void
      const covered = Option.isSome(found) ? [...found.value.aggregates].join(", ") : "<none>"
      return Effect.die(
        new Error(
          `unguarded EventV2 Session replay for aggregate(s) [${aggregates.join(", ")}] — ` +
            `permit covers [${covered}]. Route this replay through SessionMutation.replayLeased so a ` +
            `closing branch can refuse it before projector SQL runs.`,
        ),
      )
    }),
  )

export * as SessionReplayPermit from "./replay-permit"
