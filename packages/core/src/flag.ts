export * as Flag from "./flag.js"

import { Context, Effect, Layer, Record } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { ConfigFlag } from "@opencode/schema/config/flag"
import type { Document, Entry } from "@opencode/schema/config"
import { App } from "./app.js"
import { Config } from "./config.js"

export type Key = ConfigFlag.Key

export interface State {
  readonly enabled: boolean
  /** Where `enabled` came from, highest priority first. */
  readonly source: "env" | "config" | "default"
}

export interface Interface {
  readonly resolve: (entries: readonly Entry[]) => Record<Key, State>
  readonly all: Effect.Effect<Record<Key, State>>
  readonly enabled: (key: Key) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Flag") {}

/**
 * `OPENCODE_FLAGS`, a comma-separated list such as `schedules,-media_blob`; a leading `-` turns a flag off, and
 * `all` turns every flag on unless the same list opts one out, as in `all,-media_blob`.
 */
export const Overrides = Context.Reference<string | undefined>("@opencode/Flag/Overrides", {
  defaultValue: () => process.env.OPENCODE_FLAGS,
})

// Any other channel, such as a release or a branch preview build, keeps flags off so none turns on by accident.
const onByDefault = (channel: string) => channel === "local" || channel === "dev"

/**
 * Resolves every flag: `OPENCODE_FLAGS` (`-key`, then `all`), then `experimental.<key>` from the highest-priority
 * document that sets `experimental` (the same document every other `experimental` setting reads), then `all_flags: true`
 * from the highest-priority document that sets `all_flags`, so a global switch survives a project's own `experimental`
 * block, then on for local and dev builds. `all_flags: false` falls through rather than turning flags off.
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
  const all = env.get(ConfigFlag.wildcard) === true
  const experimental = Config.latest(input.entries, "experimental")
  const allFlags =
    input.entries.findLast(
      (entry): entry is Document => entry.type === "document" && entry.info.experimental?.all_flags !== undefined,
    )?.info.experimental?.all_flags === true
  return Record.map(ConfigFlag.registry, (_, key): State => {
    const override = env.get(key) ?? (all ? true : undefined)
    const configured = experimental?.[key] ?? (allFlags ? true : undefined)
    const [enabled, source]: [boolean, State["source"]] =
      override !== undefined
        ? [override, "env"]
        : configured !== undefined
          ? [configured, "config"]
          : [onByDefault(input.channel), "default"]
    return { enabled, source }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const app = yield* App.Service
    const config = yield* Config.Service
    const overrides = yield* Overrides
    const resolveEntries = (entries: readonly Entry[]) => resolve({ entries, channel: app.channel, overrides })
    const all = Effect.gen(function* () {
      return resolveEntries(yield* config.entries())
    })
    return Service.of({
      resolve: resolveEntries,
      all,
      enabled: (key) => Effect.map(all, (flags) => flags[key].enabled),
    })
  }),
)

export const testLayer = (
  entries: Entry[] = [],
  options?: { readonly app?: Partial<App.Info>; readonly overrides?: string },
) =>
  Layer.fresh(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        App.layer(options?.app),
        Config.testLayer(entries),
        Layer.succeed(Overrides, options?.overrides),
      ),
    ),
  )

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [App.node, Config.node],
})

/** Every flag with its value and where it came from, read from the location's Config on each call. */
export const all = Service.use((flags) => flags.all)

export const enabled = (key: Key) => Service.use((flags) => flags.enabled(key))
