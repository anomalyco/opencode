export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that enables all flags except opt-in-only flags, as in `all,-media_blob`. */
export const wildcard = "all"

/**
 * Flags default to on in local and dev builds and off in releases, except for `optInOnly` flags, which must be
 * named explicitly in `experimental.<key>` or `OPENCODE_FLAGS`. Read a flag with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  todo: "Enable the experimental todowrite tool.",
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  automations:
    "Run a prompt or Code Mode action on a timer, or on a connected MCP server's push event when mcp_events is enabled.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  video_generate: "Enable the experimental video generation API.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  mcp_events:
    "Enable experimental MCP Events, a draft MCP extension: declare support to MCP servers and read the events of servers that offer them.",
  full_codemode:
    "Enable the full Code Mode work in progress. Off by default in every build, including local and dev; opt in with OPENCODE_FLAGS=full_codemode or experimental.full_codemode: true.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

export const optInOnly: ReadonlySet<Key> = new Set(["full_codemode"])

/**
 * Flags read before any config loads, such as when the database opens. Only `OPENCODE_FLAGS` and the build channel
 * set them: they have no `experimental.<key>` setting, and `experimental.all_flags` leaves them alone.
 */
export const envOnly = [] as const satisfies ReadonlyArray<Key>
/** A flag that `experimental.<key>` can set. */
export type ConfigKey = Exclude<Key, (typeof envOnly)[number]>

const envOnlyKeys: ReadonlySet<Key> = new Set(envOnly)
export const configurable = (key: Key): key is ConfigKey => !envOnlyKeys.has(key)

/** Earlier names of a flag, still read from `experimental.<name>` and `OPENCODE_FLAGS` when the new key is unset. */
export const aliases = {
  schedules: "automations",
} as const satisfies Record<string, Key>
