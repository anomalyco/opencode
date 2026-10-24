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

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "OPENCODE_PASSWORD" && entry[0] !== "OPENCODE_SERVER_PASSWORD",
    ),
  )
}

// The TUI, tools, and local clients dial the server over loopback, which a configured proxy must
// never capture. Appends only the missing hosts to both spellings, preserving the user's own
// entries; mirrors the desktop exemption in packages/desktop/src/main/lifecycle/environment.ts.
export function ensureLoopbackNoProxy(env: Record<string, string | undefined>) {
  const loopback = ["127.0.0.1", "localhost", "::1"]

  ;["NO_PROXY", "no_proxy"].forEach((key) => {
    const items = (env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)

    loopback.forEach((host) => {
      if (!items.some((value) => value.toLowerCase() === host)) items.push(host)
    })
    env[key] = items.join(",")
  })
}

export * as Env from "./env"
