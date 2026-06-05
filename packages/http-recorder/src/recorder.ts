import { Effect, Scope, SynchronizedRef } from "effect"
import type * as CassetteService from "./cassette.js"
import type { CassetteNotFoundError } from "./cassette.js"
import type { Interaction } from "./schema.js"

const isCI = () => {
  const value = process.env.CI
  return value !== undefined && value !== "" && value !== "false" && value !== "0"
}

export const resolveAutoMode = (
  cassette: CassetteService.Interface,
  name: string,
): Effect.Effect<"record" | "replay" | "passthrough"> =>
  Effect.gen(function* () {
    if (isCI()) return "replay"
    return (yield* cassette.exists(name)) ? "replay" : "record"
  })

export interface ReplayState<T> {
  readonly claim: <E>(
    validate: (interaction: T | undefined, index: number, interactions: ReadonlyArray<T>) => Effect.Effect<void, E>,
  ) => Effect.Effect<{ readonly interaction: T; readonly index: number }, CassetteNotFoundError | E>
}

export const makeReplayState = <T>(
  cassette: CassetteService.Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayState<T>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const load = yield* Effect.cached(cassette.read(name).pipe(Effect.map(project)))
    const position = yield* SynchronizedRef.make(0)

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const used = yield* SynchronizedRef.get(position)
        if (used === 0) return yield* Effect.void
        const interactions = yield* load.pipe(Effect.orDie)
        if (used < interactions.length)
          return yield* Effect.die(
            new Error(`Unused recorded interactions in ${name}: used ${used} of ${interactions.length}`),
          )
        return yield* Effect.void
      }),
    )

    return {
      claim: (validate) =>
        Effect.flatMap(load, (interactions) =>
          SynchronizedRef.modifyEffect(position, (index) =>
            Effect.gen(function* () {
              const interaction = interactions[index]
              yield* validate(interaction, index, interactions)
              if (interaction === undefined)
                return yield* Effect.die("Replay validation accepted a missing interaction")
              return [{ interaction, index }, index + 1] as const
            }),
          ),
        ),
    }
  })
