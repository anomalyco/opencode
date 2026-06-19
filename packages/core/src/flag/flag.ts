import { Config } from "effect"

// Mammouth Code fork: every OPENCODE_* env flag is also readable under the
// MAMMOUTH_* namespace (preferred), falling back to the upstream OPENCODE_*
// variable. The property names below stay OPENCODE_* so upstream consumers are
// unchanged; only the underlying env lookup is dual-namespaced.
function mammouthKey(key: string) {
  return key.startsWith("OPENCODE_") ? "MAMMOUTH_" + key.slice("OPENCODE_".length) : key
}

function env(key: string) {
  return process.env[mammouthKey(key)] ?? process.env[key]
}

export function truthy(key: string) {
  const value = env(key)?.toLowerCase()
  return value === "true" || value === "1"
}

// Effect boolean Config that reads MAMMOUTH_* first, then falls back to OPENCODE_*.
function dualBoolean(key: string) {
  return Config.boolean(mammouthKey(key)).pipe(Config.orElse(() => Config.boolean(key)))
}

const copy = env("OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = env("OPENCODE_DISABLE_FFF")

function enabledByExperimental(key: string) {
  return env(key) === undefined ? truthy("OPENCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENCODE_AUTO_HEAP_SNAPSHOT: truthy("OPENCODE_AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: env("OPENCODE_GIT_BASH_PATH"),
  OPENCODE_CONFIG: env("OPENCODE_CONFIG"),
  OPENCODE_CONFIG_CONTENT: env("OPENCODE_CONFIG_CONTENT"),
  OPENCODE_DISABLE_AUTOUPDATE: truthy("OPENCODE_DISABLE_AUTOUPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthy("OPENCODE_ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthy("OPENCODE_DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthy("OPENCODE_DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthy("OPENCODE_SHOW_TTFD"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthy("OPENCODE_DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_MODELS_FETCH: truthy("OPENCODE_DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MOUSE: truthy("OPENCODE_DISABLE_MOUSE"),
  OPENCODE_FAKE_VCS: env("OPENCODE_FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: env("OPENCODE_SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: env("OPENCODE_SERVER_USERNAME"),
  OPENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OPENCODE_DISABLE_FFF"),

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: dualBoolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: dualBoolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
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
