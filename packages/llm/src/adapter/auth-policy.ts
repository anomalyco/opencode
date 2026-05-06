import { Config, Effect, Redacted } from "effect"
import { Headers } from "effect/unstable/http"
import type { AuthInput } from "./auth"

type Secret = Redacted.Redacted<string>

export class MissingCredentialError extends Error {
  readonly _tag = "MissingCredentialError"

  constructor(readonly source: string) {
    super(`Missing auth credential: ${source}`)
  }
}

export type CredentialError = MissingCredentialError | Config.ConfigError

export interface Credential {
  readonly load: Effect.Effect<Secret, CredentialError>
  readonly orElse: (that: Credential) => Credential
  readonly bearer: () => Policy
  readonly header: (name: string) => Policy
  readonly pipe: <A>(f: (self: Credential) => A) => A
}

export interface Policy {
  readonly apply: (input: AuthInput) => Effect.Effect<Headers.Headers, CredentialError>
  readonly andThen: (that: Policy) => Policy
  readonly orElse: (that: Policy) => Policy
  readonly pipe: <A>(f: (self: Policy) => A) => A
}

const credential = (load: Effect.Effect<Secret, CredentialError>): Credential => {
  const self: Credential = {
    load,
    orElse: (that) => credential(load.pipe(Effect.catch(() => that.load))),
    bearer: () => fromCredential(self, (secret) => ({ authorization: `Bearer ${secret}` })),
    header: (name) => fromCredential(self, (secret) => ({ [name]: secret })),
    pipe: (f) => f(self),
  }
  return self
}

const policy = (apply: Policy["apply"]): Policy => {
  const self: Policy = {
    apply,
    andThen: (that) =>
      policy((input) =>
        apply(input).pipe(Effect.flatMap((headers) => that.apply({ ...input, headers }))),
      ),
    orElse: (that) => policy((input) => apply(input).pipe(Effect.catch(() => that.apply(input)))),
    pipe: (f) => f(self),
  }
  return self
}

const fromCredential = (source: Credential, render: (secret: string) => Headers.Input) =>
  policy((input) =>
    source.load.pipe(
      Effect.map((secret) => Headers.setAll(input.headers, render(Redacted.value(secret)))),
    ),
  )

export const value = (secret: string, source = "value") =>
  optional(secret, source)

export const optional = (secret: string | undefined, source = "optional value") =>
  credential(
    secret === undefined || secret === ""
      ? Effect.fail(new MissingCredentialError(source))
      : Effect.succeed(Redacted.make(secret)),
  )

export const config = (name: string) =>
  credential(
    Effect.gen(function* () {
      return yield* Config.redacted(name)
    }),
  )

export const effect = (load: Effect.Effect<Secret, CredentialError>) => credential(load)

export const none = policy((input) => Effect.succeed(input.headers))

export const headers = (input: Headers.Input) => policy((auth) => Effect.succeed(Headers.setAll(auth.headers, input)))

export const bearer = (source: Credential) => source.bearer()

export const header = (name: string) => (source: Credential) => source.header(name)

export * as AuthPolicy from "./auth-policy"
