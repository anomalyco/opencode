export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that enables all flags except opt-in-only flags, as in `all,-media_blob`. */
export const wildcard = "all"

/**
 * Flags default to on in local and dev builds and off in releases, except for `optInOnly` flags, which must be
 * named explicitly in `experimental.<key>` or `OPENCODE_FLAGS`. Read a flag with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  todo: "Enable the experimental todowrite tool. Off by default in every build, including local and dev; opt in with OPENCODE_FLAGS=todo or experimental.todo: true.",
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  automations:
    "Run a prompt or Code Mode action on a timer, or on a connected MCP server's push event when mcp_events is enabled.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  video_generate:
    "Enable experimental video generation: the HTTP API that starts a video job and stores the result, and the agent tool that saves the videos into the workspace.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  mcp_events:
    "Enable experimental MCP Events, a draft MCP extension: declare support to MCP servers and read the events of servers that offer them.",
  recommended_api: "Use each model's recommended API from models.dev instead of the first API it lists.",
  full_codemode: "Enable the full Code Mode work in progress.",
  machines: "Let a tool path name a machine, as in gpu:/work/train.py, and act on that machine's files and processes.",
  home_memory:
    "Give sessions in the home folder a persistent memory/, docs/ and scripts/ workspace the agent can use freely, tidied by a daily maintenance session that reads the day's home-folder conversations.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

export const optInOnly: ReadonlySet<Key> = new Set(["todo"])

/** Earlier names of a flag, still read from `experimental.<name>` and `OPENCODE_FLAGS` when the new key is unset. */
export const aliases = {
  schedules: "automations",
} as const satisfies Record<string, Key>
