// Environment variables a plugin or MCP server may inject into a spawned child.
// A denylist here is fail-open: every loader/toolchain variable a child honors
// (`GIT_CONFIG_*`, `NODE_EXTRA_CA_CERTS`, `ZDOTDIR`, `LD_PRELOAD`, ...) is a
// fresh bypass the moment it is not enumerated. Instead allowlist the names that
// can carry configuration or credentials for a downstream service, plus a small
// set of harmless process settings. Everything else is dropped.
const ALLOWED_PREFIXES = ["OPENCODE_"]
const ALLOWED_SUFFIXES = [
  "_KEY",
  "_TOKEN",
  "_SECRET",
  "_SECRETS",
  "_PASSWORD",
  "_PASS",
  "_CREDENTIAL",
  "_CREDENTIALS",
  "_URL",
  "_URI",
  "_DSN",
  "_ENDPOINT",
  "_HOST",
  "_PORT",
  "_ID",
  "_ACCOUNT",
  "_REGION",
  "_BUCKET",
  "_PROJECT",
  "_ORG",
  "_DOMAIN",
  "_FILE",
  "_PID",
]
const ALLOWED_KEYS = new Set([
  "TZ",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "LOG_LEVEL",
  "RUST_LOG",
  "NODE_ENV",
  "DEBUG",
])
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// Escape hatch for user-authored `mcp.environment` entries that the built-in
// allowlist does not cover (`PYTHONPATH`, `VIRTUAL_ENV`, `AWS_PROFILE`, ...).
// It is read from the parent process environment only, never from the env being
// sanitized, so an untrusted plugin or MCP server cannot widen its own allowlist.
const USER_ALLOWLIST_ENV = "OPENCODE_PLUGIN_ENV_ALLOW"

export function userPluginEnvAllowlist(env: NodeJS.ProcessEnv = process.env) {
  return new Set(
    (env[USER_ALLOWLIST_ENV] ?? "")
      .split(",")
      .map((name) => name.trim().toUpperCase())
      .filter((name) => ENV_NAME.test(name)),
  )
}

export function sanitizePluginEnv(
  env: NodeJS.ProcessEnv,
  allow?: ReadonlySet<string>,
): { env: NodeJS.ProcessEnv; dropped: string[] } {
  const dropped: string[] = []
  const kept = Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      if (allowed(key, allow)) return true
      // Names only, so a dropped credential value is never written to logs.
      dropped.push(key)
      return false
    }),
  )
  return { env: kept, dropped }
}

function allowed(key: string, allow?: ReadonlySet<string>) {
  if (!ENV_NAME.test(key)) return false
  const upper = key.toUpperCase()
  if (allow?.has(upper)) return true
  if (ALLOWED_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true
  if (ALLOWED_KEYS.has(upper)) return true
  return ALLOWED_SUFFIXES.some((suffix) => upper.endsWith(suffix))
}

export * as PluginEnv from "./plugin-env"
