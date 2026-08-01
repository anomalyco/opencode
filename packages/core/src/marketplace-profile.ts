import {
  marketplaceSkillComponents,
  type MarketplaceSource,
  type MarketplaceState,
  type MarketplaceTrust,
} from "./marketplace"

export type MarketplaceProfileSource = {
  id: string
  name: string
  url: string
  trust?: MarketplaceTrust
  format?: MarketplaceSource["format"]
}

export type MarketplaceProfilePackage = {
  key: string
  source: string
  catalog: string
  item: string
  name: string
  kind: string
  version: string
  listing_digest?: string
  plan_digest?: string
  priority?: number
  enabled: boolean
  components: {
    skills: Record<string, boolean>
    mcp: Record<string, boolean>
  }
}

export type MarketplaceProfile = {
  schema: "opencode.marketplace.profile/v2"
  name: string
  description?: string
  generated_at: string
  sources: MarketplaceProfileSource[]
  packages: MarketplaceProfilePackage[]
}

export function exportMarketplaceProfile(
  state: MarketplaceState,
  options: { name?: string; description?: string; generatedAt?: string } = {},
): MarketplaceProfile {
  const sources = new Map<string, MarketplaceProfileSource>()

  for (const source of state.sources ?? []) {
    sources.set(source.id, {
      id: source.id,
      name: source.name,
      url: source.reference ?? source.url,
      ...(source.trust ? { trust: source.trust } : {}),
      ...(source.format ? { format: source.format } : {}),
    })
  }

  for (const installed of Object.values(state.installed ?? {})) {
    if (sources.has(installed.source) || !installed.source_url) continue
    sources.set(installed.source, {
      id: installed.source,
      name: installed.catalog_name ?? installed.source,
      url: installed.source_url,
      ...(installed.source_trust ? { trust: installed.source_trust } : {}),
    })
  }

  const packages = Object.entries(state.installed ?? {})
    .map(([key, installed]) => {
      const disabledSkills = new Set(installed.disabled_skills ?? [])
      const disabledMcp = new Set(installed.disabled_mcp ?? [])
      return {
        key,
        source: installed.source,
        catalog: installed.catalog,
        item: installed.item,
        name: installed.name,
        kind: installed.kind,
        version: installed.version,
        ...(installed.listing_digest ? { listing_digest: installed.listing_digest } : {}),
        ...(installed.plan_digest ? { plan_digest: installed.plan_digest } : {}),
        ...(installed.priority !== undefined ? { priority: installed.priority } : {}),
        enabled: installed.enabled !== false,
        components: {
          skills: Object.fromEntries(
            marketplaceSkillComponents(installed.plan)
              .map((component) => [component.id, !disabledSkills.has(component.id)] as const)
              .toSorted(([left], [right]) => left.localeCompare(right)),
          ),
          mcp: Object.fromEntries(
            Object.keys(installed.plan.mcp ?? {})
              .map((name) => [name, !disabledMcp.has(name)] as const)
              .toSorted(([left], [right]) => left.localeCompare(right)),
          ),
        },
      } satisfies MarketplaceProfilePackage
    })
    .toSorted((left, right) => left.key.localeCompare(right.key))

  return {
    schema: "opencode.marketplace.profile/v2",
    name: options.name?.trim() || "default",
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    generated_at: options.generatedAt ?? new Date().toISOString(),
    sources: Array.from(sources.values()).toSorted((left, right) => left.id.localeCompare(right.id)),
    packages,
  }
}

export function parseMarketplaceProfile(value: unknown): MarketplaceProfile {
  const profile = profileRecord(value, "Marketplace profile")
  if (profile.schema !== "opencode.marketplace.profile/v1" && profile.schema !== "opencode.marketplace.profile/v2") {
    throw new Error("Unsupported Marketplace profile schema")
  }
  if (!Array.isArray(profile.sources) || !Array.isArray(profile.packages)) {
    throw new Error("Marketplace profile sources and packages must be arrays")
  }
  if (profile.sources.length > 100 || profile.packages.length > 2_000) {
    throw new Error("Marketplace profile exceeds source or package limits")
  }
  const sources = profile.sources.map((value, index) => {
    const source = profileRecord(value, `Marketplace profile source ${index}`)
    const trust = source.trust
    if (trust !== undefined && !["official", "verified", "community", "private"].includes(String(trust))) {
      throw new Error(`Marketplace profile source ${index} has invalid trust`)
    }
    const format = source.format
    if (format !== undefined && !["auto", "opencode", "codex"].includes(String(format))) {
      throw new Error(`Marketplace profile source ${index} has invalid format`)
    }
    return {
      id: profileText(source.id, `Marketplace profile source ${index}.id`),
      name: profileText(source.name, `Marketplace profile source ${index}.name`),
      url: profileText(source.url, `Marketplace profile source ${index}.url`),
      ...(trust ? { trust: trust as MarketplaceTrust } : {}),
      ...(format ? { format: format as MarketplaceSource["format"] } : {}),
    }
  })
  const packages = profile.packages.map((value, index) => {
    const item = profileRecord(value, `Marketplace profile package ${index}`)
    const components = profileRecord(item.components, `Marketplace profile package ${index}.components`)
    if (typeof item.enabled !== "boolean")
      throw new Error(`Marketplace profile package ${index}.enabled must be boolean`)
    if (item.priority !== undefined && (typeof item.priority !== "number" || !Number.isFinite(item.priority))) {
      throw new Error(`Marketplace profile package ${index}.priority must be a finite number`)
    }
    return {
      key: profileText(item.key, `Marketplace profile package ${index}.key`),
      source: profileText(item.source, `Marketplace profile package ${index}.source`),
      catalog: profileText(item.catalog, `Marketplace profile package ${index}.catalog`),
      item: profileText(item.item, `Marketplace profile package ${index}.item`),
      name: profileText(item.name, `Marketplace profile package ${index}.name`),
      kind: profileText(item.kind, `Marketplace profile package ${index}.kind`),
      version: profileText(item.version, `Marketplace profile package ${index}.version`),
      ...(typeof item.listing_digest === "string" ? { listing_digest: item.listing_digest } : {}),
      ...(typeof item.plan_digest === "string" ? { plan_digest: item.plan_digest } : {}),
      ...(typeof item.priority === "number" ? { priority: item.priority } : {}),
      enabled: item.enabled,
      components: {
        skills: profileBooleanMap(components.skills, `Marketplace profile package ${index}.components.skills`),
        mcp: profileBooleanMap(components.mcp, `Marketplace profile package ${index}.components.mcp`),
      },
    }
  })
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("Duplicate Marketplace profile source")
  }
  if (new Set(packages.map((item) => item.key)).size !== packages.length) {
    throw new Error("Duplicate Marketplace profile package")
  }
  return {
    schema: "opencode.marketplace.profile/v2",
    name: profileText(profile.name, "Marketplace profile name"),
    ...(typeof profile.description === "string" ? { description: profile.description } : {}),
    generated_at: profileText(profile.generated_at, "Marketplace profile generated_at"),
    sources,
    packages,
  }
}

function profileRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function profileText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function profileBooleanMap(value: unknown, label: string) {
  const record = profileRecord(value, label)
  return Object.fromEntries(
    Object.entries(record).map(([key, enabled]) => {
      if (typeof enabled !== "boolean") throw new Error(`${label}.${key} must be boolean`)
      return [key, enabled]
    }),
  )
}
