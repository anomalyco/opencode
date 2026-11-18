export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that turns every flag on, as in `all,-media_blob`. It is not a flag key. */
export const wildcard = "all"

/**
 * Every feature flag, by key, with what it turns on. Flags default to on in local and dev builds and off in releases;
 * `experimental.<key>` in config and `OPENCODE_FLAGS` override that, and `OPENCODE_FLAGS=all` or
 * `experimental.all_flags: true` turn every flag on. Read one with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  automations:
    "Run a prompt or Code Mode action on a timer, or on a connected MCP server's push event when mcp_events is enabled.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  video_generate: "Enable the experimental video generation API.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  mcp_events:
    "Enable experimental MCP Events, a draft MCP extension: declare support to MCP servers and read the events of servers that offer them.",
  full_codemode: "Enable the full Code Mode work in progress.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

/** Earlier names of a flag, still read from `experimental.<name>` and `OPENCODE_FLAGS` when the new key is unset. */
export const aliases = {
  schedules: "automations",
} as const satisfies Record<string, Key>
