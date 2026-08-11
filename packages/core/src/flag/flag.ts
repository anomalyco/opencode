import { Config } from "effect"

/**
 * Every flag is addressable as `OPVIERA_*`, with the upstream `OPENCODE_*` name still honoured as
 * a fallback.
 *
 * Aliasing rather than renaming is deliberate: these names are read via bare `process.env` across
 * many files and hardcoded throughout the test suite, so a hard rename is the same class of change
 * as the config-filename rename that broke ~120 tests. The keys below stay `OPENCODE_*` for that
 * reason — they are internal identifiers, and only the ENV VAR a user types is brand-visible.
 *
 * Non-prefixed keys (`OTEL_*`) pass through untouched: they are OpenTelemetry standard names, not
 * ours to rebrand.
 */
export function envName(key: string) {
  return key.startsWith("OPENCODE_") ? `OPVIERA_${key.slice("OPENCODE_".length)}` : key
}

export function env(key: string) {
  return process.env[envName(key)] ?? process.env[key]
}

export function truthy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = env("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = env("OPENCODE_DISABLE_FFF")

function enabledByExperimental(key: string) {
  return env(key) === undefined ? truthy("OPENCODE_EXPERIMENTAL") : truthy(key)
}

/** Effect Config equivalent of the alias: prefer the Opviera name, fall back to upstream. */
function boolConfig(key: string) {
  return Config.boolean(envName(key)).pipe(
    Config.orElse(() => Config.boolean(key)),
    Config.withDefault(false),
  )
}

export const Flag = {
  /**
   * Read an aliased env var by its upstream key: `OPVIERA_X` wins, `OPENCODE_X` is the fallback.
   * Exposed here so the handful of call sites that read env directly (logging, websearch, auth
   * content) get the same aliasing as the flags below without importing a second symbol.
   */
  env,

  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENCODE_AUTO_HEAP_SNAPSHOT: truthy("OPENCODE_AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: env("OPENCODE_GIT_BASH_PATH"),
  OPENCODE_CONFIG: env("OPENCODE_CONFIG"),
  OPENCODE_CONFIG_CONTENT: env("OPENCODE_CONFIG_CONTENT"),
  // Always on. The upstream updater checks opencode.ai, npm, Homebrew, Chocolatey, Scoop and the
  // GitHub releases API one second after the TUI starts — none of which distribute Opviera.
  OPENCODE_DISABLE_AUTOUPDATE: true,
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthy("OPENCODE_ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthy("OPENCODE_DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthy("OPENCODE_DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthy("OPENCODE_SHOW_TTFD"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthy("OPENCODE_DISABLE_AUTOCOMPACT"),
  // Always on. Opviera's catalog is provisioned from the gateway's own model list, so it reflects
  // the key's policy exactly. Letting models.opencode.ai repopulate the catalog would reintroduce
  // providers this build deliberately removed.
  OPENCODE_DISABLE_MODELS_FETCH: true,
  OPENCODE_DISABLE_MOUSE: truthy("OPENCODE_DISABLE_MOUSE"),
  OPENCODE_FAKE_VCS: env("OPENCODE_FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: env("OPENCODE_SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: env("OPENCODE_SERVER_USERNAME"),
  OPENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OPENCODE_DISABLE_FFF"),

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: boolConfig("OPENCODE_EXPERIMENTAL_FILEWATCHER"),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: boolConfig("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER"),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_MODELS_URL: env("OPENCODE_MODELS_URL"),
  OPENCODE_MODELS_PATH: env("OPENCODE_MODELS_PATH"),
  OPENCODE_DB: env("OPENCODE_DB"),

  OPENCODE_WORKSPACE_ID: env("OPENCODE_WORKSPACE_ID"),
  OPENCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("OPENCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OPENCODE_EXPERIMENTAL_REFERENCES")
  },
  get OPENCODE_TUI_CONFIG() {
    return env("OPENCODE_TUI_CONFIG")
  },
  get OPENCODE_CONFIG_DIR() {
    return env("OPENCODE_CONFIG_DIR")
  },
  get OPENCODE_PURE() {
    return truthy("OPENCODE_PURE")
  },
  get OPENCODE_PERMISSION() {
    return env("OPENCODE_PERMISSION")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return env("OPENCODE_PLUGIN_META_FILE")
  },
  get OPENCODE_CLIENT() {
    return env("OPENCODE_CLIENT") ?? "cli"
  },
}
