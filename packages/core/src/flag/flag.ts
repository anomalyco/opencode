import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["ARGUS_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("ARGUS_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  ARGUS_AUTO_HEAP_SNAPSHOT: truthy("ARGUS_AUTO_HEAP_SNAPSHOT"),
  ARGUS_GIT_BASH_PATH: process.env["ARGUS_GIT_BASH_PATH"],
  ARGUS_CONFIG: process.env["ARGUS_CONFIG"],
  ARGUS_CONFIG_CONTENT: process.env["ARGUS_CONFIG_CONTENT"],
  ARGUS_DISABLE_AUTOUPDATE: truthy("ARGUS_DISABLE_AUTOUPDATE"),
  ARGUS_ALWAYS_NOTIFY_UPDATE: truthy("ARGUS_ALWAYS_NOTIFY_UPDATE"),
  ARGUS_DISABLE_PRUNE: truthy("ARGUS_DISABLE_PRUNE"),
  ARGUS_DISABLE_TERMINAL_TITLE: truthy("ARGUS_DISABLE_TERMINAL_TITLE"),
  ARGUS_SHOW_TTFD: truthy("ARGUS_SHOW_TTFD"),
  ARGUS_DISABLE_AUTOCOMPACT: truthy("ARGUS_DISABLE_AUTOCOMPACT"),
  ARGUS_DISABLE_MODELS_FETCH: truthy("ARGUS_DISABLE_MODELS_FETCH"),
  ARGUS_DISABLE_MOUSE: truthy("ARGUS_DISABLE_MOUSE"),
  ARGUS_FAKE_VCS: process.env["ARGUS_FAKE_VCS"],
  ARGUS_SERVER_PASSWORD: process.env["ARGUS_SERVER_PASSWORD"],
  ARGUS_SERVER_USERNAME: process.env["ARGUS_SERVER_USERNAME"],
  ARGUS_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("ARGUS_DISABLE_FFF"),

  // Experimental
  ARGUS_EXPERIMENTAL_FILEWATCHER: Config.boolean("ARGUS_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("ARGUS_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("ARGUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  ARGUS_MODELS_URL: process.env["ARGUS_MODELS_URL"],
  ARGUS_MODELS_PATH: process.env["ARGUS_MODELS_PATH"],
  ARGUS_DB: process.env["ARGUS_DB"],

  ARGUS_WORKSPACE_ID: process.env["ARGUS_WORKSPACE_ID"],
  ARGUS_EXPERIMENTAL_WORKSPACES: enabledByExperimental("ARGUS_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get ARGUS_DISABLE_PROJECT_CONFIG() {
    return truthy("ARGUS_DISABLE_PROJECT_CONFIG")
  },
  get ARGUS_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("ARGUS_EXPERIMENTAL_REFERENCES")
  },
  get ARGUS_TUI_CONFIG() {
    return process.env["ARGUS_TUI_CONFIG"]
  },
  get ARGUS_CONFIG_DIR() {
    return process.env["ARGUS_CONFIG_DIR"]
  },
  get ARGUS_PURE() {
    return truthy("ARGUS_PURE")
  },
  get ARGUS_PERMISSION() {
    return process.env["ARGUS_PERMISSION"]
  },
  get ARGUS_PLUGIN_META_FILE() {
    return process.env["ARGUS_PLUGIN_META_FILE"]
  },
  get ARGUS_CLIENT() {
    return process.env["ARGUS_CLIENT"] ?? "cli"
  },
}
