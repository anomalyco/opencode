export * as ConfigCache from "./cache.js"

import type { Entry } from "@opencode/schema/config"
import type { ConfigCache } from "@opencode/schema/config/cache"

/** Select whole provider rule arrays from the highest-priority document defining them. */
export function resolve(entries: readonly Entry[], input: ConfigCache.When & { readonly provider: string }) {
  const document = entries.findLast(
    (entry) => entry.type === "document" && Object.hasOwn(entry.info.cache ?? {}, input.provider),
  )
  if (document?.type !== "document") return
  const conditions = ["agent", "model", "subagent"] as const
  const matches = (document.info.cache?.[input.provider] ?? [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => conditions.every((key) => rule.when?.[key] === undefined || input[key] === rule.when[key]))
  if (matches.length === 0) return
  const duplicates = matches.some((match, index) =>
    matches
      .slice(index + 1)
      .some((other) => conditions.every((key) => match.rule.when?.[key] === other.rule.when?.[key])),
  )
  const winners = matches.filter(({ rule }) =>
    matches.every((other) =>
      conditions.every((key) => other.rule.when?.[key] === undefined || rule.when?.[key] === other.rule.when[key]),
    ),
  )
  if (duplicates || winners.length !== 1) {
    const source = document.path ? ` in ${document.path}` : ""
    throw new Error(
      `Ambiguous cache rules${source}: ${matches.map(({ index }) => `cache[${JSON.stringify(input.provider)}][${index}]`).join(", ")}. ` +
        `Matched agent=${input.agent}, model=${input.model}, subagent=${input.subagent}. ` +
        "Remove duplicate conditions or add a rule containing all matching conditions.",
    )
  }
  return { ...winners[0]!, source: document.path }
}
