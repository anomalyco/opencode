export * as ConfigFlag from "./flag.js"

import { Record, Schema } from "effect"

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
  side_chat:
    "Turn /btw into a side chat: follow-up questions in a side panel, and answers you can share with the agent.",
} as const satisfies Record<string, string>
export type Key = keyof typeof registry

/** One resolved flag: whether it is on, and where that came from, highest priority first. */
export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  enabled: Schema.Boolean,
  source: Schema.Literals(["env", "config", "default"]),
}).annotate({ identifier: "ConfigFlag.State" })

/** Every flag resolved for one location, as clients read them. */
export interface Resolved extends Schema.Schema.Type<typeof Resolved> {}
export const Resolved = Schema.Struct(Record.map(registry, () => State)).annotate({
  identifier: "ConfigFlag.Resolved",
})
