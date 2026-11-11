export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that turns every flag on, as in `all,-media_blob`. It is not a flag key. */
export const wildcard = "all"

/**
 * Every feature flag, by key, with what it turns on. A flag is on in local and dev builds and off in released ones;
 * `experimental.<key>` in config and `OPENCODE_FLAGS` override that, and `OPENCODE_FLAGS=all` or
 * `experimental.all_flags: true` turn every flag on. Read one with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  todo: "Enable the experimental todowrite tool.",
  background_compaction:
    "Enable experimental background compaction: summarize the conversation in the background as it nears the compaction threshold, so automatic compaction does not wait for the summary. Background summaries that are never used still cost tokens.",
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  schedules: "Enable experimental scheduled tasks that wake a session with a prompt.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  codemode_vm: "Run the Code Mode execute tool on the experimental bytecode VM instead of the legacy interpreter.",
  shell_timeout_background: "Move foreground shell commands to the background when their timeout expires.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  mcp_events:
    "Enable experimental MCP Events, a draft MCP extension: declare support to MCP servers and read the events of servers that offer them.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry
