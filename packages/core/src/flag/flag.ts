import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["LEAKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["LEAKCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("LEAKCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  LEAKCODE_AUTO_HEAP_SNAPSHOT: truthy("LEAKCODE_AUTO_HEAP_SNAPSHOT"),
  LEAKCODE_GIT_BASH_PATH: process.env["LEAKCODE_GIT_BASH_PATH"],
  LEAKCODE_CONFIG: process.env["LEAKCODE_CONFIG"],
  LEAKCODE_CONFIG_CONTENT: process.env["LEAKCODE_CONFIG_CONTENT"],
  LEAKCODE_DISABLE_AUTOUPDATE: truthy("LEAKCODE_DISABLE_AUTOUPDATE"),
  LEAKCODE_ALWAYS_NOTIFY_UPDATE: truthy("LEAKCODE_ALWAYS_NOTIFY_UPDATE"),
  LEAKCODE_DISABLE_PRUNE: truthy("LEAKCODE_DISABLE_PRUNE"),
  LEAKCODE_DISABLE_TERMINAL_TITLE: truthy("LEAKCODE_DISABLE_TERMINAL_TITLE"),
  LEAKCODE_SHOW_TTFD: truthy("LEAKCODE_SHOW_TTFD"),
  LEAKCODE_DISABLE_AUTOCOMPACT: truthy("LEAKCODE_DISABLE_AUTOCOMPACT"),
  LEAKCODE_DISABLE_MODELS_FETCH: truthy("LEAKCODE_DISABLE_MODELS_FETCH"),
  LEAKCODE_DISABLE_MOUSE: truthy("LEAKCODE_DISABLE_MOUSE"),
  LEAKCODE_FAKE_VCS: process.env["LEAKCODE_FAKE_VCS"],
  LEAKCODE_SERVER_PASSWORD: process.env["LEAKCODE_SERVER_PASSWORD"],
  LEAKCODE_SERVER_USERNAME: process.env["LEAKCODE_SERVER_USERNAME"],
  LEAKCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("LEAKCODE_DISABLE_FFF"),

  // Experimental
  LEAKCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("LEAKCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LEAKCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("LEAKCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  LEAKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("LEAKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  LEAKCODE_MODELS_URL: process.env["LEAKCODE_MODELS_URL"],
  LEAKCODE_MODELS_PATH: process.env["LEAKCODE_MODELS_PATH"],
  LEAKCODE_DB: process.env["LEAKCODE_DB"],

  LEAKCODE_WORKSPACE_ID: process.env["LEAKCODE_WORKSPACE_ID"],
  LEAKCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("LEAKCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get LEAKCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("LEAKCODE_DISABLE_PROJECT_CONFIG")
  },
  get LEAKCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("LEAKCODE_EXPERIMENTAL_REFERENCES")
  },
  get LEAKCODE_TUI_CONFIG() {
    return process.env["LEAKCODE_TUI_CONFIG"]
  },
  get LEAKCODE_CONFIG_DIR() {
    return process.env["LEAKCODE_CONFIG_DIR"]
  },
  get LEAKCODE_PURE() {
    return truthy("LEAKCODE_PURE")
  },
  get LEAKCODE_PERMISSION() {
    return process.env["LEAKCODE_PERMISSION"]
  },
  get LEAKCODE_PLUGIN_META_FILE() {
    return process.env["LEAKCODE_PLUGIN_META_FILE"]
  },
  get LEAKCODE_CLIENT() {
    return process.env["LEAKCODE_CLIENT"] ?? "cli"
  },
}
