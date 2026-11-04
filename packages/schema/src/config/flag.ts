export * as ConfigFlag from "./flag.js"

import { Schema } from "effect"

/** `dev` flags are on in local and dev builds, `beta` flags also in beta builds, `ga` flags everywhere. */
export const Stage = Schema.Literals(["dev", "beta", "ga"])
export type Stage = typeof Stage.Type

/**
 * Every feature flag. Read one with Core's `Flag.enabled("<key>")`; `experimental.<key>` in config and
 * `OPENCODE_FLAGS` override its stage default.
 */
export const registry = {
  todo: {
    stage: "dev",
    description: "Enable the experimental todowrite tool.",
  },
  background_compaction: {
    stage: "dev",
    description:
      "Enable experimental background compaction: summarize the conversation in the background as it nears the compaction threshold, so automatic compaction does not wait for the summary. Background summaries that are never used still cost tokens.",
  },
  media_blob: {
    stage: "dev",
    description: "Store new session media once in a deduplicated blob table instead of inline in every message row.",
  },
  schedules: {
    stage: "dev",
    description: "Enable experimental scheduled tasks that wake a session with a prompt.",
  },
  artifacts: {
    stage: "dev",
    description: "Enable experimental artifacts backed by pluggable providers.",
  },
} as const satisfies Record<string, { readonly stage: Stage; readonly description: string }>
export type Key = keyof typeof registry

/** Where a flag's resolved value came from, highest priority first. */
export const Source = Schema.Literals(["env", "config", "stage"])
export type Source = typeof Source.Type

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  key: Schema.String,
  description: Schema.String,
  stage: Stage,
  enabled: Schema.Boolean,
  source: Source,
}).annotate({ identifier: "ConfigFlag.State" })

const defaults = {
  dev: "Defaults to on in local and dev builds and off in beta and latest.",
  beta: "Defaults to on in local, dev and beta builds and off in latest.",
  ga: "Defaults to on.",
} satisfies Record<Stage, string>

export const describe = (key: Key) => `${registry[key].description} ${defaults[registry[key].stage]}`
