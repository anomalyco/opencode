import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["PENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["PENCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("PENCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  PENCODE_AUTO_HEAP_SNAPSHOT: truthy("PENCODE_AUTO_HEAP_SNAPSHOT"),
  PENCODE_GIT_BASH_PATH: process.env["PENCODE_GIT_BASH_PATH"],
  PENCODE_CONFIG: process.env["PENCODE_CONFIG"],
  PENCODE_CONFIG_CONTENT: process.env["PENCODE_CONFIG_CONTENT"],
  PENCODE_DISABLE_AUTOUPDATE: truthy("PENCODE_DISABLE_AUTOUPDATE"),
  PENCODE_ALWAYS_NOTIFY_UPDATE: truthy("PENCODE_ALWAYS_NOTIFY_UPDATE"),
  PENCODE_DISABLE_PRUNE: truthy("PENCODE_DISABLE_PRUNE"),
  PENCODE_DISABLE_TERMINAL_TITLE: truthy("PENCODE_DISABLE_TERMINAL_TITLE"),
  PENCODE_SHOW_TTFD: truthy("PENCODE_SHOW_TTFD"),
  PENCODE_DISABLE_AUTOCOMPACT: truthy("PENCODE_DISABLE_AUTOCOMPACT"),
  PENCODE_DISABLE_MODELS_FETCH: truthy("PENCODE_DISABLE_MODELS_FETCH"),
  PENCODE_DISABLE_MOUSE: truthy("PENCODE_DISABLE_MOUSE"),
  PENCODE_FAKE_VCS: process.env["PENCODE_FAKE_VCS"],
  PENCODE_SERVER_PASSWORD: process.env["PENCODE_SERVER_PASSWORD"],
  PENCODE_SERVER_USERNAME: process.env["PENCODE_SERVER_USERNAME"],
  PENCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("PENCODE_DISABLE_FFF"),

  // Experimental
  PENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("PENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  PENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("PENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  PENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("PENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  PENCODE_MODELS_URL: process.env["PENCODE_MODELS_URL"],
  PENCODE_MODELS_PATH: process.env["PENCODE_MODELS_PATH"],
  PENCODE_DB: process.env["PENCODE_DB"],

  PENCODE_WORKSPACE_ID: process.env["PENCODE_WORKSPACE_ID"],
  PENCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("PENCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get PENCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("PENCODE_DISABLE_PROJECT_CONFIG")
  },
  get PENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("PENCODE_EXPERIMENTAL_REFERENCES")
  },
  get PENCODE_TUI_CONFIG() {
    return process.env["PENCODE_TUI_CONFIG"]
  },
  get PENCODE_CONFIG_DIR() {
    return process.env["PENCODE_CONFIG_DIR"]
  },
  get PENCODE_PURE() {
    return truthy("PENCODE_PURE")
  },
  get PENCODE_PERMISSION() {
    return process.env["PENCODE_PERMISSION"]
  },
  get PENCODE_PLUGIN_META_FILE() {
    return process.env["PENCODE_PLUGIN_META_FILE"]
  },
  get PENCODE_CLIENT() {
    return process.env["PENCODE_CLIENT"] ?? "cli"
  },
}
