import { Effect } from "effect"
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
