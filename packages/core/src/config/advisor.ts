export * as ConfigAdvisor from "./advisor"

import { Advisor } from "@opencode-ai/schema/advisor"
import { Option, Schema } from "effect"

export function merge(previous: Advisor.Input | undefined, next: Advisor.Input | undefined): Advisor.Input | undefined {
  if (next === undefined) return previous
  if (next === false) return false
  return { ...(previous === false ? {} : previous), ...next }
}

/** Validate the merged setting. Throws when a partial object survived layering; use `tryResolve` to degrade instead. */
export function resolve(input: Advisor.Input | undefined): Advisor.Settings | undefined {
  if (input === undefined || input === false) return undefined
  return Schema.decodeUnknownSync(Advisor.Settings)(input)
}

/** Like `resolve`, but an incomplete setting yields `undefined` instead of throwing. */
export function tryResolve(input: Advisor.Input | undefined): Advisor.Settings | undefined {
  if (input === undefined || input === false) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Advisor.Settings)(input))
}

/** Human-readable reason a merged setting cannot be used, or `undefined` when it is complete or disabled. */
export function invalid(input: Advisor.Input | undefined): string | undefined {
  if (input === undefined || input === false || tryResolve(input) !== undefined) return undefined
  const missing = (["model", "maxUses"] as const).filter((key) => input[key] === undefined)
  return missing.length ? `missing ${missing.join(" and ")}` : "invalid value"
}
