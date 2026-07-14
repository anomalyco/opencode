import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

/** Resolve KANCODE_* first, then OPENCODE_* (same suffix). */
export function envAlias(suffix: string) {
  return process.env[`KANCODE_${suffix}`] ?? process.env[`OPENCODE_${suffix}`]
}

function truthyAlias(suffix: string) {
  const value = envAlias(suffix)?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = envAlias("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = envAlias("DISABLE_FFF")

function enabledByExperimental(suffix: string) {
  return envAlias(suffix) === undefined ? truthyAlias("EXPERIMENTAL") : truthyAlias(suffix)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENCODE_AUTO_HEAP_SNAPSHOT: truthyAlias("AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: envAlias("GIT_BASH_PATH"),
  get OPENCODE_CONFIG() {
    return envAlias("CONFIG")
  },
  get OPENCODE_CONFIG_CONTENT() {
    return envAlias("CONFIG_CONTENT")
  },
  OPENCODE_DISABLE_AUTOUPDATE: truthyAlias("DISABLE_AUTOUPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthyAlias("ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthyAlias("DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthyAlias("DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthyAlias("SHOW_TTFD"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthyAlias("DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_MODELS_FETCH: truthyAlias("DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MOUSE: truthyAlias("DISABLE_MOUSE"),
  OPENCODE_FAKE_VCS: envAlias("FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: envAlias("SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: envAlias("SERVER_USERNAME"),
  OPENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthyAlias("DISABLE_FFF"),

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthyAlias("EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_MODELS_URL: envAlias("MODELS_URL"),
  OPENCODE_MODELS_PATH: envAlias("MODELS_PATH"),
  OPENCODE_DB: envAlias("DB"),

  OPENCODE_WORKSPACE_ID: envAlias("WORKSPACE_ID"),
  OPENCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthyAlias("DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("EXPERIMENTAL_REFERENCES")
  },
  get OPENCODE_TUI_CONFIG() {
    return envAlias("TUI_CONFIG")
  },
  get OPENCODE_CONFIG_DIR() {
    return envAlias("CONFIG_DIR")
  },
  get OPENCODE_PURE() {
    return truthyAlias("PURE")
  },
  get OPENCODE_PERMISSION() {
    return envAlias("PERMISSION")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return envAlias("PLUGIN_META_FILE")
  },
  get OPENCODE_CLIENT() {
    return envAlias("CLIENT") ?? "cli"
  },
}
