import { Effect, Ref, Scope } from "effect"
import type * as CassetteService from "./cassette"
import type { CassetteNotFoundError } from "./cassette"
import type { Interaction } from "./schema"

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
  readonly load: Effect.Effect<ReadonlyArray<T>, CassetteNotFoundError>
  readonly cursor: Effect.Effect<number>
  readonly advance: Effect.Effect<void>
}

export const makeReplayState = <T>(
  cassette: CassetteService.Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayState<T>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const load = yield* Effect.cached(cassette.read(name).pipe(Effect.map(project)))
    const position = yield* Ref.make(0)

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const used = yield* Ref.get(position)
        if (used === 0) return
        const interactions = yield* load.pipe(Effect.orDie)
        if (used < interactions.length)
          yield* Effect.die(
            new Error(`Unused recorded interactions in ${name}: used ${used} of ${interactions.length}`),
          )
      }),
    )

    return { load, cursor: Ref.get(position), advance: Ref.update(position, (n) => n + 1) }
  })
