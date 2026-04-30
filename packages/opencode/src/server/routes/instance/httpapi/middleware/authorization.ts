import { Config, Effect, Encoding, Layer, Option, Redacted, Schema } from "effect"
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

const emptyCredential = {
  username: "",
  password: Redacted.make(""),
}

const authConfig = Config.all({
  password: Config.string("OPENCODE_SERVER_PASSWORD").pipe(Config.option),
  username: Config.string("OPENCODE_SERVER_USERNAME").pipe(Config.withDefault("opencode")),
})

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: typeof emptyCredential.password },
  config: Config.Success<typeof authConfig>,
) {
  return Effect.gen(function* () {
    if (Option.isNone(config.password) || config.password.value === "") return yield* effect

    if (credential.username !== config.username) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    if (Redacted.value(credential.password) !== config.password.value) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    return yield* effect
  })
}

function decodeCredential(input: string) {
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
    const config = yield* authConfig
    return Authorization.of({
      basic: (effect, { credential }) => validateCredential(effect, credential, config),
      authToken: (effect, { credential }) =>
        Effect.gen(function* () {
          return yield* validateCredential(effect, yield* decodeCredential(Redacted.value(credential)), config)
        }),
    })
  }),
)
