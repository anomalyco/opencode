import { Config } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

let inheritedNoProxy: ReadonlyArray<readonly [string, string]> | undefined

// The opencode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The legacy
// name is still honored.
export const password = Config.Redacted("OPENCODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

export function session() {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      entry[0] !== "OPENCODE_PASSWORD" &&
      entry[0] !== "OPENCODE_SERVER_PASSWORD" &&
      (inheritedNoProxy === undefined || entry[0].toLowerCase() !== "no_proxy"),
  )
  return Object.fromEntries(inheritedNoProxy ? [...entries, ...inheritedNoProxy] : entries)
}

// Keep loopback traffic off configured proxies across Bun (reads lowercase `no_proxy` first)
// and WebSocketConstructor (reads uppercase `NO_PROXY` first) by writing one merged list to both.
// Preserves `*` intact because Node's EnvHttpProxyAgent checks `noProxy === "*"`.
export function ensureLoopbackNoProxy(env: Record<string, string | undefined> = process.env) {
  if (env === process.env && inheritedNoProxy === undefined) {
    inheritedNoProxy = Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0].toLowerCase() === "no_proxy",
    )
  }

  const raw = [env.NO_PROXY, env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
    (value?.split(",") ?? []).flatMap((item) => {
      const trimmed = item.trim()
      return trimmed ? [trimmed] : []
    }),
  )

  if (raw.includes("*")) {
    env.NO_PROXY = "*"
    env.no_proxy = "*"
    return
  }

  const seen = new Set<string>()
  const merged = raw
    .filter((item) => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(",")

  env.NO_PROXY = merged
  env.no_proxy = merged
}

export * as Env from "./env"
