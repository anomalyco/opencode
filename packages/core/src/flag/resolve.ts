export * as FlagResolve from "./resolve.js"

import { Context, Record } from "effect"
import { ConfigFlag } from "@opencode/schema/config/flag"
import type { Document, Entry } from "@opencode/schema/config"

export interface State {
  readonly enabled: boolean
  /** Where `enabled` came from, highest priority first. */
  readonly source: "env" | "config" | "default"
}

/**
 * `OPENCODE_FLAGS`, a comma-separated list such as `artifacts,-media_blob`; a leading `-` turns a flag off, and
 * `all` enables all flags except opt-in-only flags and any disabled in the same list, as in `all,-media_blob`.
 */
export const Overrides = Context.Reference<string | undefined>("@opencode/Flag/Overrides", {
  defaultValue: () => process.env.OPENCODE_FLAGS,
})

// Any other channel, such as a release or a branch preview build, keeps flags off so none turns on by accident.
const onByDefault = (channel: string) => channel === "local" || channel === "dev"

/**
 * Resolves every flag: `OPENCODE_FLAGS` (`key` or `-key`, then `all`), then `experimental.<key>` from the highest-priority
 * document that sets `experimental` (the same document every other `experimental` setting reads), then `all_flags: true`
 * from the highest-priority document that sets `all_flags`, so a global switch survives a project's own `experimental`
 * block, then on for local and dev builds. `all_flags: false` falls through rather than turning flags off.
 * Opt-in-only flags skip both wildcards and default to off on every channel.
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
  const experimental = input.entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental !== undefined,
  )?.info.experimental
  const allFlags =
    input.entries.findLast(
      (entry): entry is Document => entry.type === "document" && entry.info.experimental?.all_flags !== undefined,
    )?.info.experimental?.all_flags === true
  return Record.map(ConfigFlag.registry, (_, key): State => {
    const optInOnly = ConfigFlag.optInOnly.has(key)
    const override = env.get(key) ?? (all && !optInOnly ? true : undefined)
    const configured = experimental?.[key] ?? (allFlags && !optInOnly ? true : undefined)
    const [enabled, source]: [boolean, State["source"]] =
      override !== undefined
        ? [override, "env"]
        : configured !== undefined
          ? [configured, "config"]
          : [!optInOnly && onByDefault(input.channel), "default"]
    return { enabled, source }
  })
}
