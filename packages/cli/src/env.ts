import { Config } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

// The opencode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The legacy
// name is still honored.
export const password = Config.redacted("OPENCODE_PASSWORD").pipe(
  Config.orElse(() => Config.redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

// Whether servers require authentication. Prefer a positive environment
// variable so deployments can opt out with an explicit `false`.
export const auth = Config.boolean("OPENCODE_AUTH").pipe(Config.withDefault(true))

export * as Env from "./env"
