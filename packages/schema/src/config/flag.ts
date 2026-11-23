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
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  video_generate:
    "Enable experimental video generation: the HTTP API that starts a video job and stores the result, and the agent tool that saves the videos into the workspace.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  recommended_api: "Use each model's recommended API from models.dev instead of the first API it lists.",
  full_codemode: "Enable the full Code Mode work in progress.",
  machines: "Let a tool path name a machine, as in gpu:/work/train.py, and act on that machine's files and processes.",
  home_memory:
    "Give sessions in the home folder a persistent memory/, docs/ and scripts/ workspace the agent can use freely, tidied by a daily maintenance session that reads the day's home-folder conversations.",
  project_overlay:
    "Load a personal config dir for each project from ~/.config/opencode/project/<project-id>/, read like an extra .opencode dir that ranks above the repo's own, and let home memory keep the skills it builds for the user there.",
  sqlite_fts:
    "Build an SQLite full-text index of session titles and message text in the background, and enable the opencode.session.search and opencode.session.read tools. The index covers every session in the database and starts while any loaded location enables it; SQLite keeps it current from then on, also after this is turned off.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

export const optInOnly: ReadonlySet<Key> = new Set(["todo"])
