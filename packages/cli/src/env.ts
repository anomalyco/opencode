import { Config } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

// The opencode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The legacy
// name is still honored.
export const password = Config.Redacted("OPENCODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

// Forces screen reader mode on or off, overriding the config file. The --screen-reader flag wins over it.
// An unrecognised value is treated as unset so a stray value cannot stop startup.
export const screenReader = Config.Boolean("OPENCODE_SCREEN_READER").pipe(
  Config.orElse(() => Config.succeed(undefined)),
)

// https://no-color.org: any non-empty value turns color off.
export const noColor = Config.String("NO_COLOR").pipe(Config.withDefault(""))

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

export * as Env from "./env"
