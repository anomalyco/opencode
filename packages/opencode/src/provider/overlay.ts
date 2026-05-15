import { Hash } from "@opencode-ai/core/util/hash"

import type { ProviderID } from "@/provider/schema"
import type { Provider } from "@/provider/provider"

interface OverlayState {
  cachedProviders: Record<ProviderID, Provider.Info>
  cleanedDatabase: Readonly<Record<ProviderID, Provider.Info>>
}

/**
 * Pure single-provider env-overlay step. See `overlay.test.ts` for the
 * exhaustive precedence table.
 */
export function resolveEnvOverlay(
  cached: Provider.Info | undefined,
  candidate: Provider.Info,
  apiKey: string | undefined,
): Provider.Info | undefined {
  if (!apiKey) {
    if (cached?.source === "env") return undefined
    return cached
  }
  if (cached && cached.source !== "env") {
    if (!cached.key && candidate.env.length === 1) return { ...cached, key: apiKey }
    return cached
  }
  // Multi-env candidate: cached.key has no single source of truth, preserve it.
  const nextKey = candidate.env.length === 1 ? apiKey : cached?.key
  if (cached && cached.key === nextKey) return cached
  if (cached) return { ...cached, key: nextKey }
  return { ...candidate, source: "env", key: nextKey }
}

export function currentProviders(
  s: OverlayState,
  envs: Record<string, string | undefined>,
): Record<ProviderID, Provider.Info> {
  const result: Record<ProviderID, Provider.Info> = { ...s.cachedProviders }
  for (const [id, info] of Object.entries(s.cleanedDatabase)) {
    const providerID = id as ProviderID
    // Empty/whitespace env values count as absent. Non-blank values are
    // passed through verbatim — trimming a real key would be silently wrong.
    const apiKey = info.env.map((k) => envs[k]).find(isNonBlank)
    const next = resolveEnvOverlay(result[providerID], info, apiKey)
    if (next) result[providerID] = next
    else delete result[providerID]
  }
  return result
}

export function isNonBlank(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== ""
}

// JSON.stringify drops functions silently and throws on BigInt. Tag both so
// distinct closures (e.g. AWS `coalesceProvider`) and BigInt values produce
// stable, distinct hashes. Anonymous arrows collide on `__fn:anon` — that is
// intentional: the per-call `fetch` wrapper built in `resolveSDK` would
// otherwise bust the SDK cache on every invocation.
//
// CAVEAT: same-named closures from unrelated callers (e.g. a third-party
// plugin storing a `coalesceProvider` in `provider.options`) collide and may
// silently serve a stale SDK. Plugin authors must keep stateful closures out
// of `provider.options` outside the per-call `fetch` convention.
//
// TODO(hash): swap for `effect/Hash` + `Equal.equals` with WeakMap-tracked
// function identity to fix the named-collision risk.
export function hashIdentity(parts: Record<string, unknown>): string {
  return Hash.fast(
    JSON.stringify(parts, (_key, value) => {
      if (typeof value === "function") return `__fn:${value.name || "anon"}`
      if (typeof value === "bigint") return `${value.toString()}n`
      return value
    }),
  )
}

export * as ProviderOverlay from "./overlay"
