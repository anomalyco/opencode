import { Context } from "effect"

// Origin allowlist for the OpenCode local HTTP/WebSocket server.
//
// The list is intentionally narrow to prevent a malicious cross-origin context
// (e.g. another locally-running web app, an XSS'd opencode.ai subdomain, or a
// DNS-rebound attacker domain) from driving the local API, which exposes shell
// execution, PTY upgrades, MCP installation, and other privileged primitives.
//
// Only origins that ship and run the OpenCode UI/SDK are listed here.
// Additional origins can be added per-instance via `--cors` or the `server.cors`
// config field.
//
// Notes:
// - An absent Origin header (`undefined`) is allowed: non-browser clients (CLI,
//   SDKs, language runtimes) do not send Origin. Browser-originated requests
//   always include Origin.
// - `http://localhost:*` and `http://127.0.0.1:*` are NOT trusted by default.
//   Any other browser context listening on loopback (other dev tools, container
//   UIs, etc.) would otherwise be implicitly trusted.
// - `*.opencode.ai` wildcards are NOT trusted; only the canonical hosts are.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://opencode.ai",
  "https://app.opencode.ai",
  "oc://renderer",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
])

export type CorsOptions = { readonly cors?: ReadonlyArray<string> }

export const CorsConfig = Context.Reference<CorsOptions | undefined>("@opencode/ServerCorsConfig", {
  defaultValue: () => undefined,
})

export function isAllowedCorsOrigin(input: string | undefined, opts?: CorsOptions): boolean {
  if (!input) return true
  if (ALLOWED_ORIGINS.has(input)) return true
  return opts?.cors?.includes(input) ?? false
}

export function isAllowedRequestOrigin(
  input: string | undefined,
  host: string | undefined,
  opts?: CorsOptions,
): boolean {
  if (!input) return true
  if (host && sameHost(input, host)) return true
  return isAllowedCorsOrigin(input, opts)
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
