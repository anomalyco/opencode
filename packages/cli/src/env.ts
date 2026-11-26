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

// The token a terminal that implements the Program Resume Protocol (OSC 7577) gives its first process. Only the TUI
// reports with it. It leaves the environment when this module loads, which index.ts makes happen before any command
// runs. Nothing OpenCode starts inherits it: the background service, tool commands, editors, and plugins could
// otherwise replace the TUI's resume command, or register one the terminal later runs outside OpenCode's permissions.
// The protocol's token is 22 to 64 bytes of [A-Za-z0-9_-]; a terminal could not verify a report signed with another.
export const programResumeToken = /^[\w-]{22,64}$/.test(process.env.OSC7577_TOKEN ?? "")
  ? process.env.OSC7577_TOKEN
  : undefined
delete process.env.OSC7577_TOKEN

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

export * as Env from "./env"
