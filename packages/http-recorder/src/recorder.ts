import { Effect, PlatformError, Ref, Scope } from "effect"
import type * as CassetteService from "./cassette"
import type { SecretFinding } from "./redaction"
import type { Cassette, CassetteMetadata, Interaction } from "./schema"

export class UnsafeCassetteError extends Error {
  readonly _tag = "UnsafeCassetteError"
  constructor(
    readonly cassetteName: string,
    readonly findings: ReadonlyArray<SecretFinding>,
  ) {
    super(
      `Refusing to write cassette "${cassetteName}" because it contains possible secrets: ${findings
        .map((finding) => `${finding.path} (${finding.reason})`)
        .join(", ")}`,
    )
  }
}

export type ResolvedMode = "record" | "replay" | "passthrough"

const isCI = () => {
  const value = process.env.CI
  return value !== undefined && value !== "" && value !== "false" && value !== "0"
}

export const resolveAutoMode = (
  cassette: CassetteService.Interface,
  name: string,
): Effect.Effect<ResolvedMode> =>
  Effect.gen(function* () {
    if (isCI()) return "replay"
    return (yield* cassette.exists(name)) ? "replay" : "record"
  })

export const appendOrFail = (
  cassette: CassetteService.Interface,
  name: string,
  interaction: Interaction,
  metadata: CassetteMetadata | undefined,
): Effect.Effect<Cassette, UnsafeCassetteError> =>
  cassette.append(name, interaction, metadata).pipe(
    Effect.orDie,
    Effect.flatMap(({ cassette: result, findings }) =>
      findings.length === 0 ? Effect.succeed(result) : Effect.fail(new UnsafeCassetteError(name, findings)),
    ),
  )

export interface ReplayState<T> {
  readonly load: Effect.Effect<ReadonlyArray<T>, PlatformError.PlatformError>
  readonly cursor: Effect.Effect<number>
  readonly advance: Effect.Effect<void>
}

export const makeReplayState = <T>(
  cassette: CassetteService.Interface,
  name: string,
  project: (cassette: Cassette) => ReadonlyArray<T>,
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
