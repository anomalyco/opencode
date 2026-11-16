export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that enables all flags except opt-in-only flags, as in `all,-media_blob`. */
export const wildcard = "all"

/**
 * Flags default to on in local and dev builds and off in releases, except for `optInOnly` flags, which must be
 * named explicitly in `experimental.<key>` or `OPENCODE_FLAGS`. Read a flag with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  todo: "Enable the experimental todowrite tool.",
  background_compaction:
    "Enable experimental background compaction: summarize the conversation in the background as it nears the compaction threshold, so automatic compaction does not wait for the summary. Background summaries that are never used still cost tokens.",
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  schedules: "Enable experimental scheduled tasks that wake a session with a prompt.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  mcp_events:
    "Enable experimental MCP Events, a draft MCP extension: declare support to MCP servers and read the events of servers that offer them.",
  full_codemode:
    "Enable the full Code Mode work in progress. Off by default in every build, including local and dev; opt in with OPENCODE_FLAGS=full_codemode or experimental.full_codemode: true.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

export const optInOnly: ReadonlySet<Key> = new Set(["full_codemode"])
