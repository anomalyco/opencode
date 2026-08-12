import { Config, Option } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

/** Product env is MOKS_* only. OPENCODE_* must not leak personal OpenCode into moks. */
function env(name: string): string | undefined {
  return process.env[`MOKS_${name}`]
}

function truthyDual(name: string): boolean {
  return truthy(`MOKS_${name}`)
}

function enabledByExperimental(name: string) {
  return env(name) === undefined ? truthyDual("EXPERIMENTAL") : truthyDual(name)
}

/** Effect Config.TrueValues (case-insensitive). Present-but-invalid → false (no OPENCODE fallthrough). */
function configTruthy(value: string) {
  const v = value.trim().toLowerCase()
  return v === "true" || v === "yes" || v === "on" || v === "1" || v === "y"
}

function dualConfigBoolean(name: string) {
  return Config.option(Config.string(`MOKS_${name}`)).pipe(
    Config.map((value) => (Option.isSome(value) ? configTruthy(value.value) : false)),
  )
}

const copy = env("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = env("DISABLE_FFF")

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENCODE_AUTO_HEAP_SNAPSHOT: truthyDual("AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: env("GIT_BASH_PATH"),
  get OPENCODE_CONFIG() {
    return env("CONFIG")
  },
  get OPENCODE_CONFIG_CONTENT() {
    return env("CONFIG_CONTENT")
  },
  OPENCODE_DISABLE_AUTOUPDATE: truthyDual("DISABLE_AUTOUPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthyDual("ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthyDual("DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthyDual("DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthyDual("SHOW_TTFD"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthyDual("DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_MODELS_FETCH: truthyDual("DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MOUSE: truthyDual("DISABLE_MOUSE"),
  OPENCODE_FAKE_VCS: env("FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: env("SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: env("SERVER_USERNAME"),
  OPENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthyDual("DISABLE_FFF"),

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: dualConfigBoolean("EXPERIMENTAL_FILEWATCHER"),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: dualConfigBoolean("EXPERIMENTAL_DISABLE_FILEWATCHER"),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthyDual("EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_MODELS_URL: env("MODELS_URL"),
  OPENCODE_MODELS_PATH: env("MODELS_PATH"),
  OPENCODE_DB: env("DB"),

  OPENCODE_WORKSPACE_ID: env("WORKSPACE_ID"),
  OPENCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthyDual("DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("EXPERIMENTAL_REFERENCES")
  },
  get OPENCODE_TUI_CONFIG() {
    return env("TUI_CONFIG")
  },
  get OPENCODE_CONFIG_DIR() {
    return env("CONFIG_DIR")
  },
  get OPENCODE_PURE() {
    return truthyDual("PURE")
  },
  get OPENCODE_PERMISSION() {
    return env("PERMISSION")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return env("PLUGIN_META_FILE")
  },
  get OPENCODE_CLIENT() {
    return env("CLIENT") ?? "cli"
  },
}
