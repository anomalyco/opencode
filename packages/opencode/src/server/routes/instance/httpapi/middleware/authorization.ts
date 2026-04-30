import { ConfigService } from "@/effect/config-service"
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

export class ServerAuthConfig extends ConfigService.Service<ServerAuthConfig>()(
  "@opencode/ExperimentalHttpApiServerAuthConfig",
  {
    password: Config.string("OPENCODE_SERVER_PASSWORD").pipe(Config.option),
    username: Config.string("OPENCODE_SERVER_USERNAME").pipe(Config.withDefault("opencode")),
  },
) {}

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: Redacted.Redacted },
  config: Context.Service.Shape<typeof ServerAuthConfig>,
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
