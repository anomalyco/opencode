import type { MarketplaceState } from "./marketplace"

export type MarketplaceLock = {
  schema: "opencode.marketplace.lock/v1"
  generated_at: string
  packages: ReadonlyArray<{
    key: string
    source_url?: string
    catalog: string
    item: string
    version: string
    listing_digest?: string
    plan_digest?: string
    materialized_digest?: string
    artifact_digests: readonly string[]
  }>
}

export function exportMarketplaceLock(
  state: MarketplaceState,
  generatedAt = new Date().toISOString(),
): MarketplaceLock {
  return {
    schema: "opencode.marketplace.lock/v1",
    generated_at: generatedAt,
    packages: Object.entries(state.installed ?? {})
      .map(([key, installed]) => ({
        key,
        ...(installed.source_url ? { source_url: installed.source_url } : {}),
        catalog: installed.catalog,
        item: installed.item,
        version: installed.version,
        ...(installed.listing_digest ? { listing_digest: installed.listing_digest } : {}),
        ...(installed.plan_digest ? { plan_digest: installed.plan_digest } : {}),
        ...(installed.materialized_digest ? { materialized_digest: installed.materialized_digest } : {}),
        artifact_digests: [...(installed.artifact_digests ?? [])].toSorted(),
      }))
      .toSorted((left, right) => left.key.localeCompare(right.key)),
  }
}

export function verifyMarketplaceLock(state: MarketplaceState, lock: MarketplaceLock) {
  const errors: string[] = []
  const expected = new Map(lock.packages.map((item) => [item.key, item]))
  for (const [key, installed] of Object.entries(state.installed ?? {})) {
    const item = expected.get(key)
    if (!item) {
      errors.push(`Unexpected installed package: ${key}`)
      continue
    }
    expected.delete(key)
    if (item.version !== installed.version)
      errors.push(`${key}: expected version ${item.version}, found ${installed.version}`)
    if (item.listing_digest && item.listing_digest !== installed.listing_digest)
      errors.push(`${key}: listing digest mismatch`)
    if (item.plan_digest && item.plan_digest !== installed.plan_digest) errors.push(`${key}: plan digest mismatch`)
    if (item.materialized_digest && item.materialized_digest !== installed.materialized_digest) {
      errors.push(`${key}: materialized digest mismatch`)
    }
    const actualArtifacts = [...(installed.artifact_digests ?? [])].toSorted()
    if (JSON.stringify(item.artifact_digests) !== JSON.stringify(actualArtifacts))
      errors.push(`${key}: artifact digest mismatch`)
  }
  for (const key of expected.keys()) errors.push(`Missing installed package: ${key}`)
  return { ok: errors.length === 0, errors }
}

export function parseMarketplaceLock(value: unknown): MarketplaceLock {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Marketplace lock must be an object")
  const lock = value as Record<string, unknown>
  if (
    lock.schema !== "opencode.marketplace.lock/v1" ||
    typeof lock.generated_at !== "string" ||
    !Array.isArray(lock.packages)
  ) {
    throw new Error("Unsupported Marketplace lock")
  }
  if (lock.packages.length > 2_000) throw new Error("Marketplace lock contains too many packages")
  const packages = lock.packages.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Marketplace lock package ${index} must be an object`)
    }
    const item = value as Record<string, unknown>
    const text = (field: string) => {
      const entry = item[field]
      if (typeof entry !== "string" || !entry) throw new Error(`Marketplace lock package ${index}.${field} is required`)
      return entry
    }
    if (!Array.isArray(item.artifact_digests) || item.artifact_digests.some((digest) => typeof digest !== "string")) {
      throw new Error(`Marketplace lock package ${index}.artifact_digests must be a string array`)
    }
    return {
      key: text("key"),
      ...(typeof item.source_url === "string" ? { source_url: item.source_url } : {}),
      catalog: text("catalog"),
      item: text("item"),
      version: text("version"),
      ...(typeof item.listing_digest === "string" ? { listing_digest: item.listing_digest } : {}),
      ...(typeof item.plan_digest === "string" ? { plan_digest: item.plan_digest } : {}),
      ...(typeof item.materialized_digest === "string" ? { materialized_digest: item.materialized_digest } : {}),
      artifact_digests: [...item.artifact_digests].toSorted(),
    }
  })
  if (new Set(packages.map((item) => item.key)).size !== packages.length) {
    throw new Error("Marketplace lock contains duplicate package keys")
  }
  return {
    schema: "opencode.marketplace.lock/v1",
    generated_at: lock.generated_at,
    packages: packages.toSorted((left, right) => left.key.localeCompare(right.key)),
  }
}
