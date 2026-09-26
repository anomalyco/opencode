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

// Opt-in escape hatch for deployments that intentionally run without authentication. There is no
// loopback restriction: this also disables auth for non-loopback binds, which is the intended
// behaviour for trusted-LAN use.
export const disableAuth = Config.string("OPENCODE_DISABLE_AUTH").pipe(
  Config.withDefault(""),
  Config.map((value) => value === "1" || value.toLowerCase() === "true"),
)

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

export * as Env from "./env"
