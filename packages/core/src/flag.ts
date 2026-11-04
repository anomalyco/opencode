export * as Flag from "./flag.js"

import { Context, Effect, Option, Record } from "effect"
import { ConfigFlag } from "@opencode/schema/config/flag"
import type { Entry } from "@opencode/schema/config"
import { App } from "./app.js"
import { Config } from "./config.js"

export type Key = ConfigFlag.Key
export type State = ConfigFlag.State

/** `OPENCODE_FLAGS`, a comma-separated list such as `schedules,-media_blob`; a leading `-` turns a flag off. */
export const Overrides = Context.Reference<string | undefined>("@opencode/Flag/Overrides", {
  defaultValue: () => process.env.OPENCODE_FLAGS,
})

// Unknown channels, such as branch preview builds, count as latest so a flag never turns on by accident.
const channelRank = new Map([
  ["local", 0],
  ["dev", 0],
  ["beta", 1],
])
const stageRank = { dev: 0, beta: 1, ga: 2 } satisfies { readonly [S in ConfigFlag.Stage]: number }

export const onByDefault = (stage: ConfigFlag.Stage, channel: string) =>
  (channelRank.get(channel) ?? 2) <= stageRank[stage]

/**
 * Resolves every flag: `OPENCODE_FLAGS`, then `experimental.<key>` from the highest-priority document that sets
 * `experimental` (the same document every other `experimental` setting reads), then the stage default for `channel`.
 * A remote kill switch belongs above `OPENCODE_FLAGS` here.
 */
export function resolve(input: {
  readonly entries: readonly Entry[]
  readonly channel: string
  readonly overrides?: string
}) {
  const env = new Map(
    (input.overrides ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item): [string, boolean] => (item.startsWith("-") ? [item.slice(1), false] : [item, true])),
  )
  const experimental = Config.latest(input.entries, "experimental")
  return Record.map(ConfigFlag.registry, (flag, key): State => {
    const override = env.get(key)
    const configured = experimental?.[key]
    const [enabled, source]: [boolean, ConfigFlag.Source] =
      override !== undefined
        ? [override, "env"]
        : configured !== undefined
          ? [configured, "config"]
          : [onByDefault(flag.stage, input.channel), "stage"]
    return { key, description: flag.description, stage: flag.stage, enabled, source }
  })
}

/** {@link resolve} for this process's channel and `OPENCODE_FLAGS`, for synchronous readers of config entries. */
export const resolver = Effect.gen(function* () {
  const app = yield* App.Metadata
  const overrides = yield* Overrides
  return (entries: readonly Entry[]) => resolve({ entries, channel: app.channel, overrides })
})

/** Every flag with its stage and source, read from the Config in scope on each call. */
export const all = Effect.gen(function* () {
  const config = yield* Effect.serviceOption(Config.Service)
  const entries = Option.isSome(config) ? yield* config.value.entries() : []
  const read = yield* resolver
  return read(entries)
})

export const enabled = (key: Key) => all.pipe(Effect.map((flags) => flags[key].enabled))
