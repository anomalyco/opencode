import { Config } from "effect"
import { InstallationChannel } from "../installation/version"

/** Read env var with dual prefix support: YUNPAT_* takes precedence over OPENCODE_* */
function env(suffix: string): string | undefined {
  return process.env[`YUNPAT_${suffix}`] ?? process.env[`OPENCODE_${suffix}`]
}

function truthy(suffix: string) {
  const value = env(suffix)?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(suffix: string) {
  const value = env(suffix)?.toLowerCase()
  return value === "false" || value === "0"
}

// Channels that default to the new effect-httpapi server backend. The legacy
// hono backend remains the default for stable (`prod`/`latest`) installs.
const HTTPAPI_DEFAULT_ON_CHANNELS = new Set(["dev", "beta", "local"])

function number(suffix: string) {
  const value = env(suffix)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const OPENCODE_EXPERIMENTAL = truthy("EXPERIMENTAL")
const OPENCODE_DISABLE_CLAUDE_CODE = truthy("DISABLE_CLAUDE_CODE")
const OPENCODE_DISABLE_CLAUDE_CODE_SKILLS =
  OPENCODE_DISABLE_CLAUDE_CODE || truthy("DISABLE_CLAUDE_CODE_SKILLS")
const copy = env("EXPERIMENTAL_DISABLE_COPY_ON_SELECT")

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OPENCODE_AUTO_SHARE: truthy("AUTO_SHARE"),
  OPENCODE_AUTO_HEAP_SNAPSHOT: truthy("AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: env("GIT_BASH_PATH"),
  OPENCODE_CONFIG: env("CONFIG"),
  OPENCODE_CONFIG_CONTENT: env("CONFIG_CONTENT"),
  OPENCODE_DISABLE_AUTOUPDATE: truthy("DISABLE_AUTOUPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthy("ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthy("DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthy("DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthy("SHOW_TTFD"),
  OPENCODE_PERMISSION: env("PERMISSION"),
  OPENCODE_DISABLE_DEFAULT_PLUGINS: truthy("DISABLE_DEFAULT_PLUGINS"),
  OPENCODE_DISABLE_LSP_DOWNLOAD: truthy("DISABLE_LSP_DOWNLOAD"),
  OPENCODE_ENABLE_EXPERIMENTAL_MODELS: truthy("ENABLE_EXPERIMENTAL_MODELS"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthy("DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_MODELS_FETCH: truthy("DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MOUSE: truthy("DISABLE_MOUSE"),
  OPENCODE_DISABLE_CLAUDE_CODE,
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: OPENCODE_DISABLE_CLAUDE_CODE || truthy("DISABLE_CLAUDE_CODE_PROMPT"),
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS,
  OPENCODE_DISABLE_EXTERNAL_SKILLS: truthy("DISABLE_EXTERNAL_SKILLS"),
  OPENCODE_FAKE_VCS: env("FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: env("SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: env("SERVER_USERNAME"),
  OPENCODE_ENABLE_QUESTION_TOOL: truthy("ENABLE_QUESTION_TOOL"),

  // Experimental
  OPENCODE_EXPERIMENTAL,
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_ICON_DISCOVERY"),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_ENABLE_EXA: truthy("ENABLE_EXA") || OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_EXA"),
  OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS: number("EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: number("EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  OPENCODE_EXPERIMENTAL_OXFMT: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_OXFMT"),
  OPENCODE_EXPERIMENTAL_LSP_TY: truthy("EXPERIMENTAL_LSP_TY"),
  OPENCODE_EXPERIMENTAL_LSP_TOOL: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_LSP_TOOL"),
  OPENCODE_EXPERIMENTAL_PLAN_MODE: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_PLAN_MODE"),
  OPENCODE_EXPERIMENTAL_MARKDOWN: !falsy("EXPERIMENTAL_MARKDOWN"),
  OPENCODE_MODELS_URL: env("MODELS_URL"),
  OPENCODE_MODELS_PATH: env("MODELS_PATH"),
  OPENCODE_DISABLE_EMBEDDED_WEB_UI: truthy("DISABLE_EMBEDDED_WEB_UI"),
  OPENCODE_DB: env("DB"),
  OPENCODE_DISABLE_CHANNEL_DB: truthy("DISABLE_CHANNEL_DB"),
  OPENCODE_SKIP_MIGRATIONS: truthy("SKIP_MIGRATIONS"),
  OPENCODE_STRICT_CONFIG_DEPS: truthy("STRICT_CONFIG_DEPS"),

  OPENCODE_WORKSPACE_ID: env("WORKSPACE_ID"),
  // Defaults to true on dev/beta/local channels so internal users exercise the
  // new effect-httpapi server backend. Stable (`prod`/`latest`) installs stay
  // on the legacy hono backend until the rollout is complete. An explicit env
  // var ("true"/"1" or "false"/"0") always wins, providing an opt-in for
  // stable users and an escape hatch for dev/beta users.
  OPENCODE_EXPERIMENTAL_HTTPAPI:
    truthy("EXPERIMENTAL_HTTPAPI") ||
    (!falsy("EXPERIMENTAL_HTTPAPI") && HTTPAPI_DEFAULT_ON_CHANNELS.has(InstallationChannel)),
  OPENCODE_EXPERIMENTAL_WORKSPACES: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_WORKSPACES"),
  OPENCODE_EXPERIMENTAL_EVENT_SYSTEM: OPENCODE_EXPERIMENTAL || truthy("EXPERIMENTAL_EVENT_SYSTEM"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_TUI_CONFIG() {
    return env("TUI_CONFIG")
  },
  get OPENCODE_CONFIG_DIR() {
    return env("CONFIG_DIR")
  },
  get OPENCODE_PURE() {
    return truthy("PURE")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return env("PLUGIN_META_FILE")
  },
  get OPENCODE_CLIENT() {
    return env("CLIENT") ?? "cli"
  },
}
