import { Effect, Encoding, Layer, Redacted, Schema } from "effect"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { Flag } from "@opencode-ai/core/flag/flag"

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

function validateCredential<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  credential: { readonly username: string; readonly password: typeof emptyCredential.password },
) {
  return Effect.gen(function* () {
    if (!Flag.OPENCODE_SERVER_PASSWORD) return yield* effect

    if (credential.username !== (Flag.OPENCODE_SERVER_USERNAME ?? "opencode")) {
      return yield* new Unauthorized({ message: "Unauthorized" })
    }
    if (Redacted.value(credential.password) !== Flag.OPENCODE_SERVER_PASSWORD) {
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

export const authorizationLayer = Layer.succeed(
  Authorization,
  Authorization.of({
    basic: (effect, { credential }) => validateCredential(effect, credential),
    authToken: (effect, { credential }) =>
      Effect.gen(function* () {
        return yield* validateCredential(effect, yield* decodeCredential(Redacted.value(credential)))
      }),
  }),
)
