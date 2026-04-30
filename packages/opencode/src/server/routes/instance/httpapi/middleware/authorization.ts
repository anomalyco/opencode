import { Config, Context, Effect, Encoding, Layer, Option, Redacted, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Authorization extends HttpApiMiddleware.Service<Authorization>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: Unauthorized,
    security: {
      basic: HttpApiSecurity.basic,
      authToken: HttpApiSecurity.apiKey({ in: "query", key: "auth_token" }),
    },
  },
) {}

export class ServerAuthConfig extends Context.Service<
  ServerAuthConfig,
  {
    readonly password: string | undefined
    readonly username: string
  }
>()("@opencode/ExperimentalHttpApiServerAuthConfig") {
  static readonly layer = (input: Context.Service.Shape<typeof ServerAuthConfig>) =>
    Layer.succeed(ServerAuthConfig, ServerAuthConfig.of(input))

  static readonly defaultLayer = Layer.effect(
    ServerAuthConfig,
    Effect.gen(function* () {
      const config = yield* Config.all({
        password: Config.string("OPENCODE_SERVER_PASSWORD").pipe(Config.option),
        username: Config.string("OPENCODE_SERVER_USERNAME").pipe(Config.withDefault("opencode")),
      })
      return ServerAuthConfig.of({
        password: Option.getOrUndefined(config.password),
        username: config.username,
      })
    }),
  )
}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: Redacted.Redacted },
  config: Context.Service.Shape<typeof ServerAuthConfig>,
) {
  return Effect.gen(function* () {
    if (!config.password) return yield* effect

    if (credential.username !== config.username) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    if (Redacted.value(credential.password) !== config.password) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    return yield* effect
  })
}

function decodeCredential(input: string) {
  const emptyCredential = {
    username: "",
    password: Redacted.make(""),
  }

  return Encoding.decodeBase64String(input)
    .asEffect()
    .pipe(
      Effect.match({
        onFailure: () => emptyCredential,
        onSuccess: (header) => {
          const parts = header.split(":")
          if (parts.length !== 2) return emptyCredential
          return {
            username: parts[0],
            password: Redacted.make(parts[1]),
          }
        },
      }),
    )
}

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuthConfig
    return Authorization.of({
      basic: (effect, { credential }) => validateCredential(effect, credential, config),
      authToken: (effect, { credential }) =>
        decodeCredential(Redacted.value(credential)).pipe(
          Effect.flatMap((decoded) => validateCredential(effect, decoded, config)),
        ),
    })
  }),
)
