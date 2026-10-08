export * as ConfigCache from "./cache.js"

import { Result } from "effect"
import type { Entry } from "@opencode/schema/config"
import type { ConfigCache } from "@opencode/schema/config/cache"

const conditions = ["agent", "model", "subagent"] as const

/** Select whole provider rule arrays from the highest-priority document defining them. */
export function resolve(entries: readonly Entry[], input: ConfigCache.When & { readonly provider: string }) {
  const document = entries.findLast(
    (entry) => entry.type === "document" && Object.hasOwn(entry.info.cache ?? {}, input.provider),
  )
  if (document?.type !== "document") return Result.succeed(undefined)
  return select(document.info.cache?.[input.provider] ?? [], input).pipe(
    Result.map((match) => match && { ...match, source: document.path }),
    Result.mapError(
      (message) => `cache[${JSON.stringify(input.provider)}]${document.path ? ` in ${document.path}` : ""}: ${message}`,
    ),
  )
}

/** Exact conditions partition requests into finitely many distinct matching sets. */
export function validate(rules: readonly ConfigCache.Rule[]) {
  const mixed = rules.findIndex(
    (rule) =>
      rule.options.cache_control !== undefined &&
      (rule.options.prompt_cache_retention !== undefined || rule.options.prompt_cache_options !== undefined),
  )
  if (mixed !== -1) return `Rule [${mixed}] combines cache_control with OpenAI prompt cache options`

  // undefined represents every agent/model ID not explicitly mentioned in a condition.
  const agents = [undefined, ...new Set(rules.flatMap((rule) => rule.when?.agent ?? []))]
  const models = [undefined, ...new Set(rules.flatMap((rule) => rule.when?.model ?? []))]
  const contexts = agents.flatMap((agent) =>
    models.flatMap((model) => [false, true].map((subagent) => ({ agent, model, subagent }))),
  )
  for (const context of contexts) {
    const selected = select(rules, context)
    if (Result.isFailure(selected)) return selected.failure
  }
}

function select(
  rules: readonly ConfigCache.Rule[],
  input: ConfigCache.When,
): Result.Result<{ rule: ConfigCache.Rule; index: number } | undefined, string> {
  const matches = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => conditions.every((key) => rule.when?.[key] === undefined || input[key] === rule.when[key]))
  if (matches.length === 0) return Result.succeed(undefined)
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
  if (duplicates || winners.length !== 1)
    return Result.fail(
      `Ambiguous cache rules ${matches.map(({ index }) => `[${index}]`).join(", ")}. ` +
        `Matched agent=${input.agent ?? "(other)"}, model=${input.model ?? "(other)"}, subagent=${input.subagent}. ` +
        "Remove duplicate conditions or add a rule containing all matching conditions.",
    )
  return Result.succeed(winners[0])
}
