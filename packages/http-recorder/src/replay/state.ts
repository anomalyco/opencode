import { Effect, Exit, HashSet, Ref, Scope, SynchronizedRef } from "effect"
import type { Interaction } from "../cassette/model.js"
import type { CassetteNotFoundError, Interface, InvalidCassetteError } from "../cassette/store.js"

const isCI = () => {
  const value = process.env.CI
  return value !== undefined && value !== "" && value !== "false" && value !== "0"
}

export const resolveAutoMode = (
  cassette: Interface,
  name: string,
): Effect.Effect<"record" | "replay" | "passthrough"> =>
  Effect.gen(function* () {
    if (isCI()) return "replay"
    return (yield* cassette.exists(name)) ? "replay" : "record"
  })

export interface ReplayState<T> {
  readonly claim: <E>(
    validate: (interaction: T | undefined, index: number, interactions: ReadonlyArray<T>) => Effect.Effect<void, E>,
  ) => Effect.Effect<
    { readonly interaction: T; readonly index: number },
    CassetteNotFoundError | InvalidCassetteError | E
  >
}
export interface ReplayPoolState<T> {
  readonly claim: <E>(
    select: (interactions: ReadonlyArray<T>, used: HashSet.HashSet<number>) => Effect.Effect<number, E>,
  ) => Effect.Effect<
    { readonly interaction: T; readonly index: number },
    CassetteNotFoundError | InvalidCassetteError | E
  >
}

export const makeReplayPoolState = <T>(
  cassette: Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayPoolState<T>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const load = yield* Effect.cached(cassette.read(name).pipe(Effect.map(project)))
    const claimed = yield* SynchronizedRef.make(HashSet.empty<number>())
    const attempted = yield* Ref.make(false)
    yield* Effect.addFinalizer((exit) =>
      Exit.isFailure(exit)
        ? Effect.void
        : Effect.gen(function* () {
            const used = yield* SynchronizedRef.get(claimed)
            if (HashSet.isEmpty(used) && (yield* Ref.get(attempted))) return yield* Effect.void
            const interactions = yield* load.pipe(
              Effect.catchTag("CassetteNotFoundError", () => Effect.succeed([] as ReadonlyArray<T>)),
              Effect.orDie,
            )
            if (HashSet.size(used) < interactions.length)
              return yield* Effect.die(
                new Error(
                  `Unused recorded interactions in ${name}: used ${HashSet.size(used)} of ${interactions.length}`,
                ),
              )
            return yield* Effect.void
          }),
    )
    return {
      claim: (select) =>
        Ref.set(attempted, true).pipe(
          Effect.andThen(load),
          Effect.flatMap((interactions) =>
            SynchronizedRef.modifyEffect(claimed, (used) =>
              Effect.gen(function* () {
                const index = yield* select(interactions, used)
                const interaction = interactions[index]
                if (interaction === undefined || HashSet.has(used, index))
                  return yield* Effect.die("Replay selected an unavailable interaction")
                return [{ interaction, index }, HashSet.add(used, index)] as const
              }),
            ),
          ),
        ),
    }
  })

export const makeReplayState = <T>(
  cassette: Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayState<T>, never, Scope.Scope> =>
  makeReplayPoolState(cassette, name, project).pipe(
    Effect.map((pool) => ({
      claim: (validate) =>
        pool.claim((interactions, used) => {
          const index = HashSet.size(used)
          return validate(interactions[index], index, interactions).pipe(Effect.as(index))
        }),
    })),
  )
