import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["APEX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["APEX_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("APEX_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  APEX_AUTO_HEAP_SNAPSHOT: truthy("APEX_AUTO_HEAP_SNAPSHOT"),
  APEX_GIT_BASH_PATH: process.env["APEX_GIT_BASH_PATH"],
  APEX_CONFIG: process.env["APEX_CONFIG"],
  APEX_CONFIG_CONTENT: process.env["APEX_CONFIG_CONTENT"],
  APEX_DISABLE_AUTOUPDATE: truthy("APEX_DISABLE_AUTOUPDATE"),
  APEX_ALWAYS_NOTIFY_UPDATE: truthy("APEX_ALWAYS_NOTIFY_UPDATE"),
  APEX_DISABLE_PRUNE: truthy("APEX_DISABLE_PRUNE"),
  APEX_DISABLE_TERMINAL_TITLE: truthy("APEX_DISABLE_TERMINAL_TITLE"),
  APEX_SHOW_TTFD: truthy("APEX_SHOW_TTFD"),
  APEX_DISABLE_AUTOCOMPACT: truthy("APEX_DISABLE_AUTOCOMPACT"),
  APEX_DISABLE_MODELS_FETCH: truthy("APEX_DISABLE_MODELS_FETCH"),
  APEX_DISABLE_MOUSE: truthy("APEX_DISABLE_MOUSE"),
  APEX_FAKE_VCS: process.env["APEX_FAKE_VCS"],
  APEX_SERVER_PASSWORD: process.env["APEX_SERVER_PASSWORD"],
  APEX_SERVER_USERNAME: process.env["APEX_SERVER_USERNAME"],
  APEX_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("APEX_DISABLE_FFF"),

  // Experimental
  APEX_EXPERIMENTAL_FILEWATCHER: Config.boolean("APEX_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  APEX_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("APEX_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  APEX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("APEX_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  APEX_MODELS_URL: process.env["APEX_MODELS_URL"],
  APEX_MODELS_PATH: process.env["APEX_MODELS_PATH"],
  APEX_DB: process.env["APEX_DB"],

  APEX_WORKSPACE_ID: process.env["APEX_WORKSPACE_ID"],
  APEX_EXPERIMENTAL_WORKSPACES: enabledByExperimental("APEX_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get APEX_DISABLE_PROJECT_CONFIG() {
    return truthy("APEX_DISABLE_PROJECT_CONFIG")
  },
  get APEX_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("APEX_EXPERIMENTAL_REFERENCES")
  },
  get APEX_TUI_CONFIG() {
    return process.env["APEX_TUI_CONFIG"]
  },
  get APEX_CONFIG_DIR() {
    return process.env["APEX_CONFIG_DIR"]
  },
  get APEX_PURE() {
    return truthy("APEX_PURE")
  },
  get APEX_PERMISSION() {
    return process.env["APEX_PERMISSION"]
  },
  get APEX_PLUGIN_META_FILE() {
    return process.env["APEX_PLUGIN_META_FILE"]
  },
  get APEX_CLIENT() {
    return process.env["APEX_CLIENT"] ?? "cli"
  },
}
