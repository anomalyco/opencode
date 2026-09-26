import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

// The desktop always attaches to an external opencode server instead of spawning its own sidecar.
// The target defaults to a fixed loopback origin; OPENCODE_EXTERNAL_SERVER_URL may override it, but
// only with an http loopback origin, because the main-process credential injector matches just
// http://127.0.0.1/* and http://localhost/* (packages/desktop/src/main/windows/security.ts:43). A
// malformed, non-loopback, https, or IPv6 override falls back to the default rather than disabling
// attach. The password comes from one 0600 env-style file that is also the server's systemd
// `EnvironmentFile`, so both processes read the same credential. The renderer never sees either.
// Uncached so editing the file takes effect on the next connect.
const defaultURL = "http://127.0.0.1:7700"
const loopbackHosts = new Set(["127.0.0.1", "localhost"])

export function externalServerConfig(): { url: string; password: string | null } {
  const env = readEnvFile()
  return {
    url: loopbackOrigin(env["OPENCODE_EXTERNAL_SERVER_URL"]) ?? defaultURL,
    password: env["OPENCODE_PASSWORD"] || env["OPENCODE_SERVER_PASSWORD"] || null,
  }
}

function readEnvFile(): Record<string, string> {
  const file = path.join(process.env["HOME"] ?? homedir(), ".config", "opencode", "external-server.env")
  try {
    return parseEnv(readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

function parseEnv(content: string) {
  const entries = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=")
      if (separator <= 0) return
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const
    })
    .filter((entry): entry is readonly [string, string] => entry !== undefined)
  return Object.fromEntries(entries)
}

// The main-process credential injector only matches http loopback origins
// (packages/desktop/src/main/windows/security.ts:43-47), so an https, remote, or IPv6 target would
// silently fail authentication. Return undefined so the caller falls back to the default origin.
function loopbackOrigin(raw: string | undefined) {
  if (!raw || !URL.canParse(raw)) return
  const url = new URL(raw)
  if (url.protocol !== "http:") return
  if (!loopbackHosts.has(url.hostname)) return
  return url.origin
}
