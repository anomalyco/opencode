export * as ConfigFlag from "./flag.js"

/** The `OPENCODE_FLAGS` entry that enables all flags except opt-in-only flags, as in `all,-media_blob`. */
export const wildcard = "all"

/**
 * `OPENCODE_FLAGS`, a comma-separated list such as `schedules,-media_blob`, as the setting of each key it names; a
 * leading `-` turns a key off, and a later entry for the same key wins.
 */
export const overrides = (list: string | undefined) =>
  new Map(
    (list ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item): [string, boolean] => (item.startsWith("-") ? [item.slice(1), false] : [item, true])),
  )

/** Any other channel, such as a release or a branch preview build, keeps flags off so none turns on by accident. */
export const onByDefault = (channel: string) => channel === "local" || channel === "dev"

/**
 * Flags default to on in local and dev builds and off in releases, except for `optInOnly` flags, which must be
 * named explicitly in `experimental.<key>` or `OPENCODE_FLAGS`. Read a flag with Core's `Flag.enabled("<key>")`.
 */
export const registry = {
  todo: "Enable the experimental todowrite tool. Off by default in every build, including local and dev; opt in with OPENCODE_FLAGS=todo or experimental.todo: true.",
  media_blob: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  artifacts: "Enable experimental artifacts backed by pluggable providers.",
  console_watches:
    "Watch Slack threads, GitHub pull requests, issues, commits and Actions runs, and the workspace's MCP servers' events through OpenCode Console, and wake sessions when they change.",
  recommended_api: "Use each model's recommended API from models.dev instead of the first API it lists.",
  full_codemode: "Enable the full Code Mode work in progress.",
  codemode_agents:
    "Let Code Mode scripts start subagents with agent() and make single model calls with llm(), each optionally returning a value checked against a schema, so one script can fan work out, verify it and combine the results.",
  machines: "Let a tool path name a machine, as in gpu:/work/train.py, and act on that machine's files and processes.",
  home_memory:
    "Give sessions in the home folder a persistent memory/, docs/ and scripts/ workspace the agent can use freely, tidied by a daily maintenance session that reads the day's home-folder conversations.",
  project_overlay:
    "Load a personal config dir for each project from ~/.config/opencode/project/<project-id>/, read like an extra .opencode dir that ranks above the repo's own, and let home memory keep the skills it builds for the user there.",
  opencode_api:
    'Let Code Mode scripts call the OpenCode HTTP API with fetch("opencode:///api/..."), in-process and already signed in, with calls checked as the equivalent opencode api shell command. On by default in local and dev builds and unavailable in releases.',
  mcp_skills:
    "Load skills from MCP servers that offer them (the io.modelcontextprotocol/skills extension), named <server>:<skill>. A server that offers skills no longer has its instructions included.",
  compaction_jobs:
    "List a session's subagents, with their session IDs, and its running background jobs in its compaction checkpoints, so the agent can still continue or account for them after compacting.",
  sqlite_fts:
    "Build an SQLite full-text index of session titles and message text in the background, and enable the opencode.session.search and opencode.session.read tools. The index covers every session in the database and starts while any loaded location enables it; SQLite keeps it current from then on, also after this is turned off.",
  browser_stream_tunnel:
    "Stream remote desktop browser TCP traffic over one prewarmed, ticket-authenticated binary WebSocket per live browser attachment instead of per-chunk RPC.",
  rich_media:
    "Send attached videos to models that accept video input. In the TUI, also show videos inline, in a fullscreen viewer and in picture-in-picture.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

/** Flags the server reports to clients at `GET /api/experimental/flag`, so they can adapt their UI. */
export const ui: readonly Key[] = ["full_codemode"]

export const optInOnly: ReadonlySet<Key> = new Set(["todo"])

/** Flags that stay off outside local and dev builds, whatever `OPENCODE_FLAGS` or config say. */
export const localOnly: ReadonlySet<Key> = new Set(["opencode_api"])
