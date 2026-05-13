import { Effect, Layer, Redacted, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { ServerAuthBasic } from "@/server/auth/basic"
import { ServerAuthConfig } from "@/server/auth/config"

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

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: Redacted.Redacted<string> },
) {
  return Effect.gen(function* () {
    const config = ServerAuthConfig.resolve()
    if (config.mode === "disabled") return yield* effect
    if (config.mode !== "basic") return yield* effect
    if (credential.username !== config.basic.username) return yield* new Unauthorized({ message: "Unauthorized" })
    if (Redacted.value(credential.password) !== config.basic.password)
      return yield* new Unauthorized({ message: "Unauthorized" })
    return yield* effect
  })
}

export const authorizationLayer = Layer.succeed(
  Authorization,
  Authorization.of({
    basic: (effect, { credential }) => validateCredential(effect, credential),
    authToken: (effect, { credential }) =>
      Effect.gen(function* () {
        const config = ServerAuthConfig.resolve()
        if (config.mode !== "basic") return yield* effect
        const decoded = ServerAuthBasic.decode(Redacted.value(credential))
        if (!decoded) return yield* new Unauthorized({ message: "Unauthorized" })
        return yield* validateCredential(effect, {
          username: decoded.username,
          password: Redacted.make(decoded.password),
        })
      }),
  }),
)
