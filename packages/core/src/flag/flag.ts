import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const IMECODE_EXPERIMENTAL = truthy("IMECODE_EXPERIMENTAL")
const copy = process.env["IMECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? IMECODE_EXPERIMENTAL : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  IMECODE_AUTO_HEAP_SNAPSHOT: truthy("IMECODE_AUTO_HEAP_SNAPSHOT"),
  IMECODE_GIT_BASH_PATH: process.env["IMECODE_GIT_BASH_PATH"],
  IMECODE_CONFIG: process.env["IMECODE_CONFIG"],
  IMECODE_CONFIG_CONTENT: process.env["IMECODE_CONFIG_CONTENT"],
  IMECODE_DISABLE_AUTOUPDATE: truthy("IMECODE_DISABLE_AUTOUPDATE"),
  IMECODE_ALWAYS_NOTIFY_UPDATE: truthy("IMECODE_ALWAYS_NOTIFY_UPDATE"),
  IMECODE_DISABLE_PRUNE: truthy("IMECODE_DISABLE_PRUNE"),
  IMECODE_DISABLE_TERMINAL_TITLE: truthy("IMECODE_DISABLE_TERMINAL_TITLE"),
  IMECODE_SHOW_TTFD: truthy("IMECODE_SHOW_TTFD"),
  IMECODE_DISABLE_AUTOCOMPACT: truthy("IMECODE_DISABLE_AUTOCOMPACT"),
  IMECODE_DISABLE_MODELS_FETCH: truthy("IMECODE_DISABLE_MODELS_FETCH"),
  IMECODE_DISABLE_MOUSE: truthy("IMECODE_DISABLE_MOUSE"),
  IMECODE_FAKE_VCS: process.env["IMECODE_FAKE_VCS"],
  IMECODE_SERVER_PASSWORD: process.env["IMECODE_SERVER_PASSWORD"],
  IMECODE_SERVER_USERNAME: process.env["IMECODE_SERVER_USERNAME"],

  // Experimental
  IMECODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("IMECODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  IMECODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("IMECODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  IMECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("IMECODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  IMECODE_MODELS_URL: process.env["IMECODE_MODELS_URL"],
  IMECODE_MODELS_PATH: process.env["IMECODE_MODELS_PATH"],
  IMECODE_DB: process.env["IMECODE_DB"],

  IMECODE_WORKSPACE_ID: process.env["IMECODE_WORKSPACE_ID"],
  IMECODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("IMECODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get IMECODE_DISABLE_PROJECT_CONFIG() {
    return truthy("IMECODE_DISABLE_PROJECT_CONFIG")
  },
  get IMECODE_TUI_CONFIG() {
    return process.env["IMECODE_TUI_CONFIG"]
  },
  get IMECODE_CONFIG_DIR() {
    return process.env["IMECODE_CONFIG_DIR"]
  },
  get IMECODE_PURE() {
    return truthy("IMECODE_PURE")
  },
  get IMECODE_PERMISSION() {
    return process.env["IMECODE_PERMISSION"]
  },
  get IMECODE_PLUGIN_META_FILE() {
    return process.env["IMECODE_PLUGIN_META_FILE"]
  },
  get IMECODE_CLIENT() {
    return process.env["IMECODE_CLIENT"] ?? "cli"
  },
}
