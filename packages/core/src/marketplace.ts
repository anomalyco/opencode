import semver from "semver"
import {
  evaluateMarketplaceCompatibility,
  type MarketplaceCompatibility,
  type MarketplaceCompatibilityContext,
  type MarketplaceCompatibilityResult,
} from "./marketplace-compatibility"
import { marketplaceDigest, marketplaceShortId, stableMarketplaceValue } from "./marketplace-digest"
import { adaptCodexMarketplace } from "./marketplace-codex"

export type MarketplaceKind = "plugin" | "skill" | "agent" | "command" | "mcp" | "bundle"
export type MarketplaceTrust = "official" | "verified" | "community" | "private"
export type MarketplaceConfiguredTrust = Extract<MarketplaceTrust, "community" | "private">
export type MarketplaceStatus = "available" | "installed" | "update"
export type MarketplaceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type MarketplaceSource = {
  id: string
  name: string
  url: string
  reference?: string
  enabled?: boolean
  trust?: MarketplaceTrust
  format?: "auto" | "opencode" | "codex"
  header_env?: Record<string, string>
  /** Resolved only at runtime. Never persist this field. */
  headers?: Record<string, string>
}

export type MarketplacePublisher = {
  name: string
  url?: string
  verified?: boolean
}

export type MarketplacePluginSpec = string | [string, Record<string, unknown>]

export type MarketplaceIcon = {
  "src-light": string
  "src-dark"?: string
}

export type MarketplaceSkill = {
  id: string
  name: string
  description?: string
  path?: string
  url?: string
  enabled?: boolean
}

export type MarketplaceInstallPlan = {
  plugins?: MarketplacePluginSpec[]
  skills?: {
    paths?: string[]
    urls?: string[]
    items?: MarketplaceSkill[]
  }
  agents?: Record<string, Record<string, unknown>>
  commands?: Record<string, Record<string, unknown>>
  mcp?: Record<string, Record<string, unknown>>
  instructions?: string[]
}

export type MarketplaceCatalogItem = {
  id: string
  name: string
  description: string
  kind: MarketplaceKind
  version: string
  publisher?: MarketplacePublisher
  homepage?: string
  repository?: string
  license?: string
  tags?: string[]
  featured?: boolean
  icon?: MarketplaceIcon
  brand_color?: string
  compatibility?: MarketplaceCompatibility
  permissions?: string[]
  setup?: string[]
  requires_restart?: boolean
  install: MarketplaceInstallPlan
}

export type MarketplaceInstalledSnapshot = Omit<MarketplaceCatalogItem, "install">

export type MarketplaceCatalog = {
  schema: "opencode.marketplace/v1"
  id: string
  name: string
  description?: string
  publisher?: MarketplacePublisher
  homepage?: string
  updated_at?: string
  items: MarketplaceCatalogItem[]
}

export type MarketplaceRestoreValue = {
  existed: boolean
  value?: unknown
}

export type MarketplacePluginRestore = {
  identity: string
  previous: MarketplacePluginSpec[]
}

export type MarketplaceReceipt = {
  plugins?: MarketplacePluginRestore[]
  skills?: {
    paths?: Record<string, boolean>
    urls?: Record<string, boolean>
  }
  agents?: Record<string, MarketplaceRestoreValue>
  commands?: Record<string, MarketplaceRestoreValue>
  mcp?: Record<string, MarketplaceRestoreValue>
  instructions?: Record<string, boolean>
}

export type MarketplaceInstalled = {
  source: string
  source_url?: string
  source_trust?: MarketplaceTrust
  catalog: string
  catalog_name?: string
  item: string
  name: string
  kind: MarketplaceKind
  version: string
  publisher?: string
  fingerprint: string
  listing_digest?: string
  plan_digest?: string
  priority?: number
  installed_at: string
  updated_at: string
  snapshot?: MarketplaceInstalledSnapshot
  plan: MarketplaceInstallPlan
  materialized_plan?: MarketplaceInstallPlan
  active_plan?: MarketplaceInstallPlan
  receipt: MarketplaceReceipt
  enabled?: boolean
  disabled_skills?: string[]
  disabled_mcp?: string[]
  catalog_digest?: string
  manifest_digest?: string
  materialized_digest?: string
  artifact_digests?: string[]
}

export type MarketplaceState = {
  revision?: number
  sources?: MarketplaceSource[]
  installed?: Record<string, MarketplaceInstalled>
}

export type MarketplaceHostConfig = {
  plugin?: MarketplacePluginSpec[]
  skills?: {
    paths?: string[]
    urls?: string[]
    [key: string]: unknown
  }
  agent?: Record<string, unknown>
  command?: Record<string, unknown>
  mcp?: Record<string, unknown>
  instructions?: string[]
  marketplace?: MarketplaceState
  [key: string]: unknown
}

export type MarketplaceListing = {
  key: string
  source: MarketplaceSource
  catalog: MarketplaceCatalog
  item: MarketplaceCatalogItem
  orphaned?: boolean
  catalog_url?: string
  catalog_digest?: string
  listing_digest?: string
  plan_digest?: string
  compatibility?: MarketplaceCompatibilityResult
}

export type MarketplaceLoadError = {
  source: MarketplaceSource
  message: string
}

export type MarketplaceLoadResult = {
  listings: MarketplaceListing[]
  errors: MarketplaceLoadError[]
}

export type MarketplaceCacheSummary = {
  root: string
  objects: number
  total_bytes: number
  fetch_entries: number
  materializations: number
}

export type MarketplaceView = {
  state: MarketplaceState
  listings: MarketplaceListing[]
  errors: MarketplaceLoadError[]
  cache: MarketplaceCacheSummary
  next_cursor?: string
}

export type MarketplacePlanResult =
  | {
      ok: true
      plan_id: string
      expires_at: string
      key: string
      action: "install" | "update"
      listing_digest: string
      plan_digest: string
      compatibility: MarketplaceCompatibilityResult
      trust_warning: boolean
      conflicts: MarketplaceConflict[]
      permissions: string[]
      summary: string
    }
  | {
      ok: false
      reason: "not_found" | "materialization" | "incompatible"
      message: string
    }

export type MarketplaceMutationResult =
  | {
      ok: true
      changed: boolean
      view: MarketplaceView
      connect_mcp: string[]
      preserved: string[]
    }
  | {
      ok: false
      reason:
        | "conflict"
        | "revision"
        | "trust"
        | "not_found"
        | "materialization"
        | "incompatible"
        | "plan_not_found"
        | "plan_expired"
        | "plan_consumed"
      message: string
      revision?: number
      conflicts?: MarketplaceConflict[]
    }

export type MarketplaceConflict = {
  path: string
  current: unknown
  incoming: unknown
}

export type MarketplaceInstallResult =
  | {
      ok: true
      config: MarketplaceHostConfig
      conflicts: []
    }
  | {
      ok: false
      conflicts: MarketplaceConflict[]
    }

export type MarketplaceUninstallResult = {
  config: MarketplaceHostConfig
  preserved: string[]
}

export type MarketplaceToggleResult =
  | {
      ok: true
      config: MarketplaceHostConfig
      conflicts: []
      preserved: string[]
    }
  | {
      ok: false
      conflicts: MarketplaceConflict[]
    }

export type MarketplaceSkillComponent = MarketplaceSkill & {
  source: "item" | "path" | "url"
}

type MarketplaceInstalledEntry = {
  key: string
  installed: MarketplaceInstalled
}

export const OFFICIAL_MARKETPLACE_SOURCE: MarketplaceSource = {
  id: "opencode",
  name: "OpenCode",
  url: "builtin://opencode",
  enabled: true,
  trust: "official",
}

const OFFICIAL_MARKETPLACE_CATALOG: MarketplaceCatalog = {
  schema: "opencode.marketplace/v1",
  id: "opencode",
  name: "OpenCode Marketplace",
  description: "The built-in OpenCode catalog. Additional catalogs can be added from the Sources tab.",
  publisher: {
    name: "OpenCode",
    url: "https://opencode.ai",
    verified: true,
  },
  items: [],
}

const KINDS = new Set<MarketplaceKind>(["plugin", "skill", "agent", "command", "mcp", "bundle"])
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_CATALOG_ITEMS = 2_000
const MAX_IDENTIFIER_LENGTH = 128

export function marketplaceSources(config: MarketplaceHostConfig) {
  const sources = new Map<string, MarketplaceSource>(
    OFFICIAL_MARKETPLACE_CATALOG.items.length ? [[OFFICIAL_MARKETPLACE_SOURCE.id, OFFICIAL_MARKETPLACE_SOURCE]] : [],
  )
  for (const source of config.marketplace?.sources ?? []) {
    if (source.id === OFFICIAL_MARKETPLACE_SOURCE.id) {
      sources.set(OFFICIAL_MARKETPLACE_SOURCE.id, {
        ...OFFICIAL_MARKETPLACE_SOURCE,
        enabled: source.enabled !== false,
      })
      continue
    }
    sources.set(source.id, { ...source, trust: configuredTrust(source.trust) })
  }
  return Array.from(sources.values())
}

export function createMarketplaceSource(input: {
  url: string
  name?: string
  trust?: MarketplaceConfiguredTrust
  format?: MarketplaceSource["format"]
  header_env?: Record<string, string>
  headers?: Record<string, string>
}) {
  const url = normalizeMarketplaceURL(input.url)
  const host = sourceHost(url)
  return {
    id: `source-${marketplaceShortId(url)}`,
    name: input.name?.trim() || host || "Marketplace catalog",
    url,
    reference: input.url.trim(),
    enabled: true,
    trust: configuredTrust(input.trust),
    ...(input.format ? { format: input.format } : {}),
    ...(input.header_env ? { header_env: input.header_env } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  } satisfies MarketplaceSource
}

export function upsertMarketplaceSource(config: MarketplaceHostConfig, source: MarketplaceSource) {
  const next = clone(config)
  const sources = next.marketplace?.sources ?? []
  const safe =
    source.id === OFFICIAL_MARKETPLACE_SOURCE.id
      ? { ...OFFICIAL_MARKETPLACE_SOURCE, enabled: source.enabled !== false }
      : { ...source, trust: configuredTrust(source.trust) }
  next.marketplace = {
    ...next.marketplace,
    sources: [...sources.filter((item) => item.id !== safe.id), safe],
  }
  return next
}

export function toggleMarketplaceSource(config: MarketplaceHostConfig, id: string, enabled: boolean) {
  const source = marketplaceSources(config).find((item) => item.id === id)
  if (!source) return clone(config)
  return upsertMarketplaceSource(config, { ...source, enabled })
}

export function removeMarketplaceSource(config: MarketplaceHostConfig, id: string) {
  if (id === OFFICIAL_MARKETPLACE_SOURCE.id) return clone(config)
  const next = clone(config)
  next.marketplace = {
    ...next.marketplace,
    sources: (next.marketplace?.sources ?? []).filter((source) => source.id !== id),
  }
  return next
}

export async function loadMarketplace(input: {
  config: MarketplaceHostConfig
  fetch?: MarketplaceFetch
  timeout?: number
  compatibility?: MarketplaceCompatibilityContext
}): Promise<MarketplaceLoadResult> {
  const fetcher = input.fetch ?? globalThis.fetch
  const rows = await Promise.all(
    marketplaceSources(input.config)
      .filter((source) => source.enabled !== false)
      .map(async (source) => {
        try {
          const loaded =
            source.url === OFFICIAL_MARKETPLACE_SOURCE.url
              ? {
                  catalog: OFFICIAL_MARKETPLACE_CATALOG,
                  url: OFFICIAL_MARKETPLACE_SOURCE.url,
                  digest: undefined,
                }
              : await fetchMarketplaceCatalog(fetcher, source, input.timeout ?? 10_000)
          return { ok: true as const, source, ...loaded }
        } catch (error) {
          return { ok: false as const, source, error: error instanceof Error ? error.message : String(error) }
        }
      }),
  )

  const listings: MarketplaceListing[] = rows.flatMap((row) => {
    if (!row.ok) return []
    return row.catalog.items.map((item) => ({
      key: marketplaceKey(row.source.id, row.catalog.id, item.id),
      source: row.source,
      catalog: row.catalog,
      item,
      listing_digest: marketplaceListingDigest(item),
      plan_digest: marketplacePlanDigest(item.install),
      compatibility: evaluateMarketplaceCompatibility(item.compatibility, input.compatibility),
      catalog_url: row.url,
      ...(row.digest ? { catalog_digest: row.digest } : {}),
    }))
  })

  // Installation records remain manageable even when a catalog is disabled,
  // removed, unavailable, or withdraws an item. Synthesize a local listing
  // from the SQLite registry snapshot.
  const known = new Set(listings.map((listing) => listing.key))
  const sources = marketplaceSources(input.config)
  for (const [key, installed] of Object.entries(input.config.marketplace?.installed ?? {})) {
    if (known.has(key)) continue
    const source = sources.find((item) => item.id === installed.source) ?? {
      id: installed.source,
      name: installed.catalog_name ?? installed.source,
      url: installed.source_url ?? "builtin://installed",
      enabled: false,
      trust: installed.source_trust ?? "community",
    }
    const item = installed.snapshot
      ? { ...clone(installed.snapshot), install: clone(installed.plan) }
      : {
          id: installed.item,
          name: installed.name,
          description: "Installed marketplace item. Its catalog is currently unavailable or no longer lists it.",
          kind: installed.kind,
          version: installed.version,
          ...(installed.publisher ? { publisher: { name: installed.publisher } } : {}),
          install: clone(installed.plan),
        }
    listings.push({
      key,
      source,
      catalog: {
        schema: "opencode.marketplace/v1",
        id: installed.catalog,
        name: installed.catalog_name ?? installed.catalog,
        items: [],
      },
      item,
      orphaned: true,
      ...(installed.source_url ? { catalog_url: installed.source_url } : {}),
      ...(installed.catalog_digest ? { catalog_digest: installed.catalog_digest } : {}),
    })
  }

  return {
    listings: listings.toSorted((a, b) => {
      if (a.item.featured !== b.item.featured) return a.item.featured ? -1 : 1
      const name = a.item.name.localeCompare(b.item.name)
      if (name !== 0) return name
      return a.key.localeCompare(b.key)
    }),
    errors: rows.flatMap((row) => (row.ok ? [] : [{ source: row.source, message: row.error }])),
  }
}

async function fetchMarketplaceCatalog(fetcher: MarketplaceFetch, source: MarketplaceSource, timeout: number) {
  const load = async (url: string) => {
    const response = await fetcher(url, {
      headers: source.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    })
    const digest = response.headers.get("x-opencode-artifact-digest") ?? undefined
    const value = await readCatalogResponse(response)
    const catalog = resolveCatalogAssets(
      source.format === "codex" || (source.format !== "opencode" && isCodexMarketplace(value))
        ? await adaptCodexMarketplace(value, { fetcher, source, catalogURL: url })
        : parseMarketplaceCatalog(value),
      url,
    )
    return { catalog, url, digest }
  }
  const urls = marketplaceCatalogURLs(source)
  if (urls.length === 1) return load(urls[0]!)
  if (new URL(urls[0]!).protocol === "file:") {
    let lastError: unknown
    for (const url of urls) {
      try {
        return await load(url)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  return Promise.any(urls.map(load)).catch((error) => {
    if (!(error instanceof AggregateError)) throw error
    const messages = Array.from(
      new Set(
        error.errors.map((failure) => (failure instanceof Error ? failure.message : String(failure))).filter(Boolean),
      ),
    )
    throw new Error(messages.join("; ") || `No supported marketplace catalog found at ${source.url}`)
  })
}

function isCodexMarketplace(value: unknown) {
  return Boolean(value && typeof value === "object" && "plugins" in value && !("schema" in value))
}

export function parseMarketplaceCatalog(value: unknown): MarketplaceCatalog {
  const catalog = record(value, "catalog")
  if (catalog.schema !== "opencode.marketplace/v1") {
    throw new Error("Unsupported marketplace schema; expected opencode.marketplace/v1")
  }
  const values = array(catalog.items, "catalog.items")
  if (values.length > MAX_CATALOG_ITEMS) {
    throw new Error(`Marketplace catalog contains too many items; maximum is ${MAX_CATALOG_ITEMS}`)
  }
  const items = values.map((item, index) => parseItem(item, index))
  const ids = new Set<string>()
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate marketplace item id: ${item.id}`)
    ids.add(item.id)
  }
  const homepage = optionalWebURL(catalog.homepage, "catalog.homepage")
  return {
    schema: catalog.schema,
    id: identifier(catalog.id, "catalog.id"),
    name: text(catalog.name, "catalog.name"),
    ...(optionalText(catalog.description, "catalog.description") ? { description: catalog.description as string } : {}),
    ...(catalog.publisher === undefined ? {} : { publisher: parsePublisher(catalog.publisher, "catalog.publisher") }),
    ...(homepage ? { homepage } : {}),
    ...(optionalText(catalog.updated_at, "catalog.updated_at") ? { updated_at: catalog.updated_at as string } : {}),
    items,
  }
}

export function marketplaceStatus(config: MarketplaceHostConfig, listing: MarketplaceListing): MarketplaceStatus {
  const installed = config.marketplace?.installed?.[listing.key]
  if (!installed) return "available"
  if (listing.orphaned) return "installed"
  const changed = (installed.plan_digest ?? installed.fingerprint) !== marketplacePlanDigest(listing.item.install)
  if (semver.valid(installed.version) && semver.valid(listing.item.version)) {
    if (semver.gt(listing.item.version, installed.version)) return "update"
    // A catalog must never turn Update All into an implicit downgrade. A lower
    // version remains installed even if the catalog rewrites its metadata.
    if (semver.lt(listing.item.version, installed.version)) return "installed"
    return changed ? "update" : "installed"
  }
  if (installed.version !== listing.item.version) return "update"
  return changed ? "update" : "installed"
}

export function installMarketplaceItem(
  config: MarketplaceHostConfig,
  listing: MarketplaceListing,
  options?: { force?: boolean },
): MarketplaceInstallResult {
  const current = config.marketplace?.installed?.[listing.key]
  const base = current ? uninstallMarketplaceItem(config, listing.key).config : clone(config)
  const disabledSkills = current?.disabled_skills?.filter((id) =>
    marketplaceSkillComponents(listing.item.install).some((component) => component.id === id),
  )
  const disabledMcp =
    current?.disabled_mcp?.filter((id) => id in (listing.item.install.mcp ?? {})) ??
    marketplaceInitialDisabledMcp(listing.item.install)
  const enabled = current?.enabled !== false
  const state = {
    ...current,
    enabled,
    disabled_skills:
      disabledSkills ??
      marketplaceSkillComponents(listing.item.install)
        .filter((component) => component.enabled === false)
        .map((component) => component.id),
    disabled_mcp: disabledMcp,
  }
  const activePlan = marketplaceActivePlan(listing.item.install, state)
  const activeConflicts = marketplaceConflicts(base, activePlan)
  if (activeConflicts.length > 0 && options?.force !== true) return { ok: false, conflicts: activeConflicts }
  const receipt = applyPlan(base, activePlan)
  const now = new Date().toISOString()
  base.marketplace = {
    ...base.marketplace,
    installed: {
      ...base.marketplace?.installed,
      [listing.key]: {
        source: listing.source.id,
        source_url: listing.source.url,
        source_trust: listing.source.trust,
        catalog: listing.catalog.id,
        catalog_name: listing.catalog.name,
        item: listing.item.id,
        name: listing.item.name,
        kind: listing.item.kind,
        version: listing.item.version,
        publisher: listing.item.publisher?.name ?? listing.catalog.publisher?.name,
        fingerprint: marketplaceFingerprint(listing.item),
        listing_digest: marketplaceListingDigest(listing.item),
        plan_digest: marketplacePlanDigest(listing.item.install),
        installed_at: current?.installed_at ?? now,
        updated_at: now,
        snapshot: marketplaceSnapshot(listing.item),
        plan: clone(listing.item.install),
        active_plan: activePlan,
        receipt,
        enabled,
        ...(state.disabled_skills.length ? { disabled_skills: state.disabled_skills } : {}),
        ...(state.disabled_mcp.length ? { disabled_mcp: state.disabled_mcp } : {}),
      },
    },
  }
  return { ok: true, config: base, conflicts: [] }
}

export function uninstallMarketplaceItem(config: MarketplaceHostConfig, key: string): MarketplaceUninstallResult {
  const installed = config.marketplace?.installed?.[key]
  if (!installed) return { config: clone(config), preserved: [] }
  const next = clone(config)
  const preserved: string[] = []
  const successors = installedAfter(next, key)
  const plan = installedActivePlan(installed)
  restorePlugins(next, installed, plan, successors, preserved)
  restoreArray(next, "skills.paths", skillPaths(plan), installed.receipt.skills?.paths, successors, preserved)
  restoreArray(next, "skills.urls", skillURLs(plan), installed.receipt.skills?.urls, successors, preserved)
  restoreObject(next, "agent", plan.agents, installed.receipt.agents, successors, preserved)
  restoreObject(next, "command", plan.commands, installed.receipt.commands, successors, preserved)
  restoreObject(next, "mcp", plan.mcp, installed.receipt.mcp, successors, preserved)
  restoreArray(next, "instructions", plan.instructions, installed.receipt.instructions, successors, preserved)
  const entries = { ...next.marketplace?.installed }
  delete entries[key]
  next.marketplace = { ...next.marketplace, installed: entries }
  return { config: next, preserved }
}

export function marketplaceItemEnabled(config: MarketplaceHostConfig, key: string) {
  return config.marketplace?.installed?.[key]?.enabled !== false
}

export function marketplaceSkillEnabled(config: MarketplaceHostConfig, key: string, id: string) {
  const installed = config.marketplace?.installed?.[key]
  if (!installed) return false
  return !installed.disabled_skills?.includes(id)
}

export function marketplaceMcpEnabled(config: MarketplaceHostConfig, key: string, id: string) {
  const installed = config.marketplace?.installed?.[key]
  if (!installed) return false
  return !installed.disabled_mcp?.includes(id)
}

export function marketplaceEnabledMcpNames(config: MarketplaceHostConfig, key: string) {
  const installed = config.marketplace?.installed?.[key]
  if (!installed || installed.enabled === false) return []
  const disabled = new Set(installed.disabled_mcp ?? [])
  return Object.keys(installed.plan.mcp ?? {}).filter((name) => !disabled.has(name))
}

export function setMarketplaceItemEnabled(
  config: MarketplaceHostConfig,
  key: string,
  enabled: boolean,
): MarketplaceToggleResult {
  return reconfigureMarketplaceItem(config, key, { enabled })
}

export function setMarketplaceSkillEnabled(
  config: MarketplaceHostConfig,
  key: string,
  id: string,
  enabled: boolean,
): MarketplaceToggleResult {
  const installed = config.marketplace?.installed?.[key]
  if (
    !installed ||
    !marketplaceSkillComponents(installed.materialized_plan ?? installed.plan).some((component) => component.id === id)
  ) {
    return { ok: true, config: clone(config), conflicts: [], preserved: [] }
  }
  return reconfigureMarketplaceItem(config, key, {
    disabled_skills: enabled
      ? (installed.disabled_skills ?? []).filter((candidate) => candidate !== id)
      : Array.from(new Set([...(installed.disabled_skills ?? []), id])),
  })
}

export function setMarketplaceMcpEnabled(
  config: MarketplaceHostConfig,
  key: string,
  id: string,
  enabled: boolean,
): MarketplaceToggleResult {
  const installed = config.marketplace?.installed?.[key]
  if (!installed || !(id in ((installed.materialized_plan ?? installed.plan).mcp ?? {}))) {
    return { ok: true, config: clone(config), conflicts: [], preserved: [] }
  }
  return reconfigureMarketplaceItem(config, key, {
    disabled_mcp: enabled
      ? (installed.disabled_mcp ?? []).filter((candidate) => candidate !== id)
      : Array.from(new Set([...(installed.disabled_mcp ?? []), id])),
  })
}

export function marketplaceSkillComponents(plan: MarketplaceInstallPlan): MarketplaceSkillComponent[] {
  const items = (plan.skills?.items ?? []).map((item) => ({ ...item, source: "item" as const }))
  const itemPaths = new Set(items.flatMap((item) => (item.path ? [item.path] : [])))
  const itemURLs = new Set(items.flatMap((item) => (item.url ? [item.url] : [])))
  return [
    ...items,
    ...(plan.skills?.paths ?? [])
      .filter((value) => !itemPaths.has(value))
      .map((value) => ({
        id: `path:${value}`,
        name: skillSourceName(value),
        path: value,
        source: "path" as const,
      })),
    ...(plan.skills?.urls ?? [])
      .filter((value) => !itemURLs.has(value))
      .map((value) => ({
        id: `url:${value}`,
        name: skillSourceName(value),
        url: value,
        source: "url" as const,
      })),
  ]
}

export function marketplaceDisabledSkillNames(config: MarketplaceHostConfig) {
  return Object.values(config.marketplace?.installed ?? {}).flatMap((installed) => {
    const plan = installed.materialized_plan ?? installed.plan
    if (installed.enabled === false) return marketplaceSkillComponents(plan).map((component) => component.name)
    const disabled = new Set(installed.disabled_skills ?? [])
    return marketplaceSkillComponents(plan)
      .filter((component) => disabled.has(component.id))
      .map((component) => component.name)
  })
}

function reconfigureMarketplaceItem(
  config: MarketplaceHostConfig,
  key: string,
  patch: Partial<Pick<MarketplaceInstalled, "enabled" | "disabled_skills" | "disabled_mcp">>,
): MarketplaceToggleResult {
  const installed = config.marketplace?.installed?.[key]
  if (!installed) return { ok: true, config: clone(config), conflicts: [], preserved: [] }
  const state = { ...installed, ...patch }
  const removed = uninstallMarketplaceItem(config, key)
  const activePlan = marketplaceActivePlan(installed.materialized_plan ?? installed.plan, state)
  const conflicts = marketplaceConflicts(removed.config, activePlan)
  if (conflicts.length) return { ok: false, conflicts }

  const receipt = applyPlan(removed.config, activePlan)
  const next = {
    ...state,
    active_plan: activePlan,
    receipt,
    updated_at: new Date().toISOString(),
    ...(state.disabled_skills?.length ? {} : { disabled_skills: undefined }),
    ...(state.disabled_mcp?.length ? {} : { disabled_mcp: undefined }),
  }
  const entries = removed.config.marketplace?.installed ?? {}
  const order = Object.keys(config.marketplace?.installed ?? {})
  removed.config.marketplace = {
    ...removed.config.marketplace,
    installed: Object.fromEntries(
      order.flatMap((candidate) => {
        if (candidate === key) return [[key, next]]
        const value = entries[candidate]
        return value ? [[candidate, value]] : []
      }),
    ),
  }
  return { ok: true, config: removed.config, conflicts: [], preserved: removed.preserved }
}

export function marketplaceActivePlan(
  plan: MarketplaceInstallPlan,
  state: Pick<MarketplaceInstalled, "enabled" | "disabled_skills" | "disabled_mcp">,
): MarketplaceInstallPlan {
  if (state.enabled === false) return {}
  const disabledSkills = new Set(state.disabled_skills ?? [])
  const items = (plan.skills?.items ?? []).filter((item) => !disabledSkills.has(item.id))
  const itemPaths = new Set((plan.skills?.items ?? []).flatMap((item) => (item.path ? [item.path] : [])))
  const itemURLs = new Set((plan.skills?.items ?? []).flatMap((item) => (item.url ? [item.url] : [])))
  const paths = Array.from(
    new Set([
      ...(plan.skills?.paths ?? []).filter((value) => !itemPaths.has(value) && !disabledSkills.has(`path:${value}`)),
      ...items.flatMap((item) => (item.path ? [item.path] : [])),
    ]),
  )
  const urls = Array.from(
    new Set([
      ...(plan.skills?.urls ?? []).filter((value) => !itemURLs.has(value) && !disabledSkills.has(`url:${value}`)),
      ...items.flatMap((item) => (item.url ? [item.url] : [])),
    ]),
  )
  const disabledMcp = new Set(state.disabled_mcp ?? [])
  return {
    ...clone(plan),
    ...(plan.skills
      ? {
          skills: {
            ...(paths.length ? { paths } : {}),
            ...(urls.length ? { urls } : {}),
            ...(items.length ? { items } : {}),
          },
        }
      : {}),
    ...(plan.mcp
      ? {
          mcp: Object.fromEntries(
            Object.entries(plan.mcp).map(([id, value]) => {
              if (disabledMcp.has(id))
                return [id, { ...value, enabled: false, ...(value.disabled === true ? { disabled: true } : {}) }]
              if (value.enabled === false || value.disabled === true) {
                return [id, { ...value, enabled: true, ...(value.disabled === true ? { disabled: false } : {}) }]
              }
              return [id, clone(value)]
            }),
          ),
        }
      : {}),
  }
}

function installedActivePlan(installed: MarketplaceInstalled) {
  if (installed.active_plan) return installed.active_plan
  if (installed.enabled === false) return {}
  return installed.materialized_plan ?? installed.plan
}

export function marketplaceInitialDisabledMcp(plan: MarketplaceInstallPlan) {
  return Object.entries(plan.mcp ?? {})
    .filter(([, value]) => value.enabled === false || value.disabled === true)
    .map(([id]) => id)
}

function skillPaths(plan: MarketplaceInstallPlan) {
  return Array.from(
    new Set([
      ...(plan.skills?.paths ?? []),
      ...(plan.skills?.items ?? []).flatMap((item) => (item.path ? [item.path] : [])),
    ]),
  )
}

function skillURLs(plan: MarketplaceInstallPlan) {
  return Array.from(
    new Set([
      ...(plan.skills?.urls ?? []),
      ...(plan.skills?.items ?? []).flatMap((item) => (item.url ? [item.url] : [])),
    ]),
  )
}

function skillSourceName(value: string) {
  const raw = (() => {
    try {
      return new URL(value).pathname
    } catch {
      return value
    }
  })()
  return decodeURIComponent(
    raw
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || value,
  ).replace(/\.(git|md)$/i, "")
}

export function marketplaceConflicts(config: MarketplaceHostConfig, plan: MarketplaceInstallPlan) {
  const conflicts: MarketplaceConflict[] = []
  for (const plugin of plan.plugins ?? []) {
    const current = (config.plugin ?? []).filter((item) => pluginIdentity(item) === pluginIdentity(plugin))
    if (current.length > 0 && !equal(current, [plugin])) {
      conflicts.push({ path: `plugin.${pluginIdentity(plugin)}`, current, incoming: plugin })
    }
  }
  collectObjectConflicts(conflicts, "agent", config.agent, plan.agents)
  collectObjectConflicts(conflicts, "command", config.command, plan.commands)
  collectObjectConflicts(conflicts, "mcp", config.mcp, plan.mcp)
  return conflicts
}

export function marketplacePermissions(item: MarketplaceCatalogItem) {
  const permissions = new Set(item.permissions ?? [])
  if (item.install.plugins?.length) permissions.add("Runs third-party plugin code inside OpenCode")
  if (marketplaceSkillComponents(item.install).length) {
    permissions.add("Adds instructions that agents can load on demand")
  }
  if (Object.keys(item.install.agents ?? {}).length) permissions.add("Adds or replaces agent configuration")
  if (Object.keys(item.install.commands ?? {}).length) permissions.add("Adds slash commands")
  if (Object.keys(item.install.mcp ?? {}).length) permissions.add("Starts or connects to MCP servers")
  if (item.install.instructions?.length) permissions.add("Adds persistent project instructions")
  return Array.from(permissions)
}

export function marketplacePlanSummary(plan: MarketplaceInstallPlan) {
  const skillCount = marketplaceSkillComponents(plan).length
  return (
    [
      plan.plugins?.length ? `${plan.plugins.length} plugin${plan.plugins.length === 1 ? "" : "s"}` : undefined,
      skillCount ? `${skillCount} skill${skillCount === 1 ? "" : "s"}` : undefined,
      Object.keys(plan.agents ?? {}).length
        ? `${Object.keys(plan.agents ?? {}).length} agent${Object.keys(plan.agents ?? {}).length === 1 ? "" : "s"}`
        : undefined,
      Object.keys(plan.commands ?? {}).length
        ? `${Object.keys(plan.commands ?? {}).length} command${Object.keys(plan.commands ?? {}).length === 1 ? "" : "s"}`
        : undefined,
      Object.keys(plan.mcp ?? {}).length
        ? `${Object.keys(plan.mcp ?? {}).length} MCP server${Object.keys(plan.mcp ?? {}).length === 1 ? "" : "s"}`
        : undefined,
      plan.instructions?.length
        ? `${plan.instructions.length} instruction file${plan.instructions.length === 1 ? "" : "s"}`
        : undefined,
    ]
      .filter((item): item is string => item !== undefined)
      .join(", ") || "No configuration changes"
  )
}

export function normalizeMarketplaceURL(value: string) {
  const url = value.trim()
  if (!url) throw new Error("Marketplace catalog URL is required")
  if (url.startsWith("builtin://")) return url
  if (url.startsWith("github:")) {
    const repo = url.slice("github:".length).replace(/^\/+/, "")
    const [owner, name, ...parts] = repo.split("/")
    if (!owner || !name) throw new Error("GitHub marketplace source must use github:owner/repository")
    if (parts.length) return `https://raw.githubusercontent.com/${owner}/${name}/HEAD/${parts.join("/")}`
    return `https://github.com/${owner}/${name.replace(/\.git$/, "")}.git`
  }
  const parsed = new URL(url)
  if (parsed.username || parsed.password) throw new Error("Marketplace source URLs cannot contain credentials")
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "file:") {
    throw new Error("Marketplace sources must use HTTPS, loopback HTTP, file:, github:, or builtin:")
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new Error("Marketplace sources must use HTTPS; HTTP is only allowed for loopback development servers")
  }
  // Fragments are never sent to a server and make the same catalog hash to
  // multiple source IDs, so canonicalize them away. Local files do not use a
  // query string either, and stripping it keeps one canonical registry key per file.
  parsed.hash = ""
  if (parsed.protocol === "file:") {
    parsed.search = ""
    return parsed.href
  }
  if (parsed.hostname === "github.com") {
    const [owner, repo, action, branch, ...parts] = parsed.pathname.split("/").filter(Boolean)
    if (!owner || !repo) throw new Error("Invalid GitHub marketplace URL")
    if (action === "blob" && branch && parts.length) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${parts.join("/")}`
    }
    if (!action) return `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`
  }
  return parsed.href
}

function marketplaceCatalogURLs(input: MarketplaceSource) {
  const source = normalizeMarketplaceURL(input.url)
  const url = new URL(source)
  if (url.protocol === "file:" && url.pathname.endsWith("/")) {
    const opencode = [new URL(".opencode/marketplace.json", url).href]
    const codex = [
      new URL(".agents/plugins/marketplace.json", url).href,
      new URL(".github/plugin/marketplace.json", url).href,
      new URL(".plugin/marketplace.json", url).href,
      new URL(".claude-plugin/marketplace.json", url).href,
    ]
    if (input.format === "codex") return [...codex, new URL("marketplace.json", url).href]
    if (input.format === "opencode") return [...opencode, new URL("marketplace.json", url).href]
    return [...opencode, new URL("marketplace.json", url).href, ...codex]
  }
  const repository = `${url.origin}${url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")}`
  if (url.hostname === "github.com") {
    const [owner, name] = url.pathname.split("/").filter(Boolean)
    const root = `https://raw.githubusercontent.com/${owner}/${name?.replace(/\.git$/, "")}/HEAD/`
    const opencode = [`${root}.opencode/marketplace.json`]
    const plugins = [
      `${root}marketplace.json`,
      `${root}.agents/plugins/marketplace.json`,
      `${root}.github/plugin/marketplace.json`,
      `${root}.plugin/marketplace.json`,
      `${root}.claude-plugin/marketplace.json`,
    ]
    if (input.format === "opencode") return [...opencode, `${root}marketplace.json`]
    if (input.format === "codex") return [...plugins.slice(1), plugins[0]!]
    return [...opencode, ...plugins]
  }
  const opencode = [
    `${repository}/-/raw/HEAD/.opencode/marketplace.json`,
    `${repository}/raw/HEAD/.opencode/marketplace.json`,
    `${repository}/raw/branch/main/.opencode/marketplace.json`,
  ]
  const plugins = [
    `${repository}/-/raw/HEAD/.agents/plugins/marketplace.json`,
    `${repository}/-/raw/HEAD/.github/plugin/marketplace.json`,
    `${repository}/-/raw/HEAD/.plugin/marketplace.json`,
    `${repository}/-/raw/HEAD/.claude-plugin/marketplace.json`,
    `${repository}/-/raw/HEAD/marketplace.json`,
  ]
  const repositories =
    input.format === "opencode" ? opencode : input.format === "codex" ? plugins : [...opencode, ...plugins]
  if (source.endsWith(".git")) return repositories
  if (url.search || /\.[^/]+$/.test(url.pathname)) return [source]
  return [source, ...repositories]
}

function parseItem(value: unknown, index: number): MarketplaceCatalogItem {
  const label = `catalog.items[${index}]`
  const item = record(value, label)
  const kind = text(item.kind, `${label}.kind`)
  if (!KINDS.has(kind as MarketplaceKind)) throw new Error(`Unsupported marketplace kind: ${kind}`)
  const homepage = optionalWebURL(item.homepage, `${label}.homepage`)
  const repository = optionalWebURL(item.repository, `${label}.repository`)
  const icon = item.icon === undefined ? undefined : parseIcon(item.icon, `${label}.icon`)
  const brandColor = item.brand_color === undefined ? undefined : color(item.brand_color, `${label}.brand_color`)
  return {
    id: identifier(item.id, `${label}.id`),
    name: text(item.name, `${label}.name`),
    description: text(item.description, `${label}.description`),
    kind: kind as MarketplaceKind,
    version: text(item.version, `${label}.version`),
    ...(item.publisher === undefined ? {} : { publisher: parsePublisher(item.publisher, `${label}.publisher`) }),
    ...(homepage ? { homepage } : {}),
    ...(repository ? { repository } : {}),
    ...(optionalText(item.license, `${label}.license`) ? { license: item.license as string } : {}),
    ...(item.tags === undefined ? {} : { tags: strings(item.tags, `${label}.tags`) }),
    ...(typeof item.featured === "boolean" ? { featured: item.featured } : {}),
    ...(icon ? { icon } : {}),
    ...(brandColor ? { brand_color: brandColor } : {}),
    ...(item.compatibility === undefined
      ? {}
      : { compatibility: parseCompatibility(item.compatibility, `${label}.compatibility`) }),
    ...(item.permissions === undefined ? {} : { permissions: strings(item.permissions, `${label}.permissions`) }),
    ...(item.setup === undefined ? {} : { setup: strings(item.setup, `${label}.setup`) }),
    ...(typeof item.requires_restart === "boolean" ? { requires_restart: item.requires_restart } : {}),
    install: parsePlan(item.install, `${label}.install`),
  }
}

function parsePublisher(value: unknown, label: string): MarketplacePublisher {
  const publisher = record(value, label)
  const url = optionalWebURL(publisher.url, `${label}.url`)
  return {
    name: text(publisher.name, `${label}.name`),
    ...(url ? { url } : {}),
    ...(typeof publisher.verified === "boolean" ? { verified: publisher.verified } : {}),
  }
}

function parseCompatibility(value: unknown, label: string) {
  const compatibility = record(value, label)
  return {
    ...(optionalText(compatibility.opencode, `${label}.opencode`)
      ? { opencode: compatibility.opencode as string }
      : {}),
    ...(compatibility.platforms === undefined
      ? {}
      : { platforms: strings(compatibility.platforms, `${label}.platforms`) }),
    ...(compatibility.architectures === undefined
      ? {}
      : { architectures: strings(compatibility.architectures, `${label}.architectures`) }),
    ...(compatibility.runtimes === undefined ? {} : { runtimes: strings(compatibility.runtimes, `${label}.runtimes`) }),
    ...(compatibility.capabilities === undefined
      ? {}
      : { capabilities: strings(compatibility.capabilities, `${label}.capabilities`) }),
  }
}

function parsePlan(value: unknown, label: string): MarketplaceInstallPlan {
  const plan = record(value, label)
  const parsedPlugins = plan.plugins === undefined ? undefined : plugins(plan.plugins, `${label}.plugins`)
  if (parsedPlugins) {
    const identities = new Set<string>()
    for (const plugin of parsedPlugins) {
      const identity = pluginIdentity(plugin)
      if (identities.has(identity)) throw new Error(`${label}.plugins contains duplicate package identity: ${identity}`)
      identities.add(identity)
    }
  }
  return {
    ...(parsedPlugins ? { plugins: parsedPlugins } : {}),
    ...(plan.skills === undefined ? {} : { skills: parseSkills(plan.skills, `${label}.skills`) }),
    ...(plan.agents === undefined ? {} : { agents: objectMap(plan.agents, `${label}.agents`) }),
    ...(plan.commands === undefined ? {} : { commands: objectMap(plan.commands, `${label}.commands`) }),
    ...(plan.mcp === undefined ? {} : { mcp: objectMap(plan.mcp, `${label}.mcp`) }),
    ...(plan.instructions === undefined ? {} : { instructions: strings(plan.instructions, `${label}.instructions`) }),
  }
}

function parseSkills(value: unknown, label: string) {
  const skills = record(value, label)
  const items =
    skills.items === undefined
      ? undefined
      : array(skills.items, `${label}.items`).map((value, index) => {
          const item = record(value, `${label}.items[${index}]`)
          return {
            id: identifier(item.id, `${label}.items[${index}].id`),
            name: text(item.name, `${label}.items[${index}].name`),
            ...(optionalText(item.description, `${label}.items[${index}].description`)
              ? { description: item.description as string }
              : {}),
            ...(optionalText(item.path, `${label}.items[${index}].path`) ? { path: item.path as string } : {}),
            ...(optionalText(item.url, `${label}.items[${index}].url`) ? { url: item.url as string } : {}),
            ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
          }
        })
  if (items) {
    const ids = new Set<string>()
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`${label}.items contains duplicate skill id: ${item.id}`)
      ids.add(item.id)
    }
  }
  return {
    ...(skills.paths === undefined ? {} : { paths: strings(skills.paths, `${label}.paths`) }),
    ...(skills.urls === undefined ? {} : { urls: strings(skills.urls, `${label}.urls`) }),
    ...(items ? { items } : {}),
  }
}

function plugins(value: unknown, label: string): MarketplacePluginSpec[] {
  return array(value, label).map((item, index) => {
    if (typeof item === "string" && item.trim()) return item.trim()
    if (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "string" &&
      item[0].trim() &&
      isRecord(item[1])
    ) {
      return [item[0].trim(), item[1]]
    }
    throw new Error(`${label}[${index}] must be a plugin package string or [package, options] tuple`)
  })
}

function objectMap(value: unknown, label: string) {
  const input = record(value, label)
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, record(item, `${label}.${key}`)]))
}

function collectObjectConflicts(
  conflicts: MarketplaceConflict[],
  root: string,
  current: Record<string, unknown> | undefined,
  incoming: Record<string, Record<string, unknown>> | undefined,
) {
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (!(key in (current ?? {}))) continue
    if (equal(current?.[key], value)) continue
    conflicts.push({ path: `${root}.${key}`, current: current?.[key], incoming: value })
  }
}

function applyPlan(config: MarketplaceHostConfig, plan: MarketplaceInstallPlan): MarketplaceReceipt {
  const receipt: MarketplaceReceipt = {}
  if (plan.plugins?.length) {
    receipt.plugins = plan.plugins.map((plugin) => {
      const identity = pluginIdentity(plugin)
      const previous = (config.plugin ?? []).filter((item) => pluginIdentity(item) === identity)
      config.plugin = [...(config.plugin ?? []).filter((item) => pluginIdentity(item) !== identity), clone(plugin)]
      return { identity, previous: clone(previous) }
    })
  }
  if (skillPaths(plan).length || skillURLs(plan).length) {
    receipt.skills = {}
    if (skillPaths(plan).length) {
      receipt.skills.paths = addArray(config, "skills.paths", skillPaths(plan))
    }
    if (skillURLs(plan).length) {
      receipt.skills.urls = addArray(config, "skills.urls", skillURLs(plan))
    }
  }
  if (Object.keys(plan.agents ?? {}).length) receipt.agents = applyObject(config, "agent", plan.agents ?? {})
  if (Object.keys(plan.commands ?? {}).length) receipt.commands = applyObject(config, "command", plan.commands ?? {})
  if (Object.keys(plan.mcp ?? {}).length) receipt.mcp = applyObject(config, "mcp", plan.mcp ?? {})
  if (plan.instructions?.length) receipt.instructions = addArray(config, "instructions", plan.instructions)
  return receipt
}

function addArray(
  config: MarketplaceHostConfig,
  path: "skills.paths" | "skills.urls" | "instructions",
  values: string[],
) {
  const current = readArray(config, path)
  const receipt = Object.fromEntries(values.map((value) => [value, current.includes(value)]))
  writeArray(config, path, Array.from(new Set([...current, ...values])))
  return receipt
}

function applyObject(
  config: MarketplaceHostConfig,
  root: "agent" | "command" | "mcp",
  values: Record<string, Record<string, unknown>>,
) {
  const current = config[root] ?? {}
  const receipt = Object.fromEntries(
    Object.entries(values).map(([key]) => [
      key,
      key in current ? { existed: true, value: clone(current[key]) } : { existed: false },
    ]),
  )
  config[root] = { ...current, ...clone(values) }
  return receipt
}

function restorePlugins(
  config: MarketplaceHostConfig,
  installed: MarketplaceInstalled,
  plan: MarketplaceInstallPlan,
  successors: MarketplaceInstalledEntry[],
  preserved: string[],
) {
  for (const plugin of plan.plugins ?? []) {
    const identity = pluginIdentity(plugin)
    const receipt = installed.receipt.plugins?.find((item) => item.identity === identity)
    if (claimPlugin(successors, identity, plugin, receipt?.previous)) continue
    if (!receipt) {
      preserved.push(`plugin.${identity}`)
      continue
    }
    const current = (config.plugin ?? []).filter((item) => pluginIdentity(item) === identity)
    if (!equal(current, [plugin])) {
      preserved.push(`plugin.${identity}`)
      continue
    }
    config.plugin = [
      ...(config.plugin ?? []).filter((item) => pluginIdentity(item) !== identity),
      ...clone(receipt.previous),
    ]
  }
}

function restoreObject(
  config: MarketplaceHostConfig,
  root: "agent" | "command" | "mcp",
  values: Record<string, Record<string, unknown>> | undefined,
  receipt: Record<string, MarketplaceRestoreValue> | undefined,
  successors: MarketplaceInstalledEntry[],
  preserved: string[],
) {
  if (!values) return
  const current = { ...(config[root] ?? {}) }
  for (const [key, value] of Object.entries(values)) {
    const previous = receipt?.[key]
    if (claimObject(successors, root, key, value, previous)) continue
    if (!previous) {
      preserved.push(`${root}.${key}`)
      continue
    }
    if (!equal(current[key], value)) {
      preserved.push(`${root}.${key}`)
      continue
    }
    if (previous.existed) current[key] = clone(previous.value)
    else delete current[key]
  }
  config[root] = current
}

function restoreArray(
  config: MarketplaceHostConfig,
  path: "skills.paths" | "skills.urls" | "instructions",
  values: string[] | undefined,
  receipt: Record<string, boolean> | undefined,
  successors: MarketplaceInstalledEntry[],
  preserved: string[],
) {
  if (!values) return
  let current = readArray(config, path)
  for (const value of values) {
    const existed = receipt?.[value]
    if (claimArray(successors, path, value, existed)) continue
    if (existed === undefined) {
      preserved.push(`${path}.${value}`)
      continue
    }
    if (existed) continue
    if (!current.includes(value)) {
      preserved.push(`${path}.${value}`)
      continue
    }
    current = current.filter((item) => item !== value)
  }
  writeArray(config, path, current)
}

function installedAfter(config: MarketplaceHostConfig, key: string): MarketplaceInstalledEntry[] {
  const entries = Object.entries(config.marketplace?.installed ?? {})
  const index = entries.findIndex(([candidate]) => candidate === key)
  if (index < 0) return []
  return entries.slice(index + 1).map(([candidate, installed]) => ({ key: candidate, installed }))
}

function claimPlugin(
  successors: MarketplaceInstalledEntry[],
  identity: string,
  value: MarketplacePluginSpec,
  previous: MarketplacePluginSpec[] | undefined,
) {
  let claimed = false
  for (const entry of successors) {
    const candidate = (installedActivePlan(entry.installed).plugins ?? []).find(
      (item) => pluginIdentity(item) === identity,
    )
    if (!candidate) continue
    claimed = true
    const receipt = entry.installed.receipt.plugins?.find((item) => item.identity === identity)
    if (!receipt || !previous || !equal(receipt.previous, [value])) continue
    receipt.previous = clone(previous)
    return true
  }
  return claimed
}

function claimObject(
  successors: MarketplaceInstalledEntry[],
  root: "agent" | "command" | "mcp",
  key: string,
  value: Record<string, unknown>,
  previous: MarketplaceRestoreValue | undefined,
) {
  let claimed = false
  for (const entry of successors) {
    const plan = installedObject(installedActivePlan(entry.installed), root)
    if (!plan || !(key in plan)) continue
    claimed = true
    const receipt = installedObjectReceipt(entry.installed.receipt, root)
    const prior = receipt?.[key]
    if (!prior?.existed || !previous || !equal(prior.value, value)) continue
    receipt![key] = clone(previous)
    return true
  }
  return claimed
}

function installedObject(plan: MarketplaceInstallPlan, root: "agent" | "command" | "mcp") {
  if (root === "agent") return plan.agents
  if (root === "command") return plan.commands
  return plan.mcp
}

function installedObjectReceipt(receipt: MarketplaceReceipt, root: "agent" | "command" | "mcp") {
  if (root === "agent") return receipt.agents
  if (root === "command") return receipt.commands
  return receipt.mcp
}

function claimArray(
  successors: MarketplaceInstalledEntry[],
  path: "skills.paths" | "skills.urls" | "instructions",
  value: string,
  existed: boolean | undefined,
) {
  let claimed = false
  for (const entry of successors) {
    if (!installedArray(installedActivePlan(entry.installed), path).includes(value)) continue
    claimed = true
    const receipt = installedArrayReceipt(entry.installed.receipt, path)
    if (receipt?.[value] !== true || existed === undefined) continue
    receipt[value] = existed
    return true
  }
  return claimed
}

function installedArray(plan: MarketplaceInstallPlan, path: "skills.paths" | "skills.urls" | "instructions") {
  if (path === "instructions") return plan.instructions ?? []
  return path === "skills.paths" ? skillPaths(plan) : skillURLs(plan)
}

function installedArrayReceipt(receipt: MarketplaceReceipt, path: "skills.paths" | "skills.urls" | "instructions") {
  if (path === "instructions") return receipt.instructions
  return receipt.skills?.[path === "skills.paths" ? "paths" : "urls"]
}

function readArray(config: MarketplaceHostConfig, path: "skills.paths" | "skills.urls" | "instructions") {
  if (path === "instructions") return config.instructions ?? []
  return config.skills?.[path === "skills.paths" ? "paths" : "urls"] ?? []
}

function writeArray(
  config: MarketplaceHostConfig,
  path: "skills.paths" | "skills.urls" | "instructions",
  values: string[],
) {
  if (path === "instructions") {
    config.instructions = values
    return
  }
  const key = path === "skills.paths" ? "paths" : "urls"
  config.skills = { ...config.skills, [key]: values }
}

function pluginIdentity(plugin: MarketplacePluginSpec) {
  const spec = Array.isArray(plugin) ? plugin[0] : plugin
  return spec.match(/^((?:@[^/@\s]+\/)?[^@/:\s]+)(?:@.*)?$/)?.[1] ?? spec
}

function marketplaceKey(source: string, catalog: string, item: string) {
  return `${source}:${catalog}:${item}`
}

export function marketplaceFingerprint(item: MarketplaceCatalogItem) {
  return marketplaceListingDigest(item)
}

export function marketplaceListingDigest(item: MarketplaceCatalogItem) {
  return marketplaceDigest(item)
}

export function marketplacePlanDigest(plan: MarketplaceInstallPlan) {
  return marketplaceDigest(plan)
}

async function readCatalogResponse(response: Response) {
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) {
    throw new Error(`Marketplace catalog exceeds ${MAX_CATALOG_BYTES} bytes`)
  }

  const reader = response.body?.getReader()
  if (!reader) return JSON.parse(await response.text())
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_CATALOG_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error(`Marketplace catalog exceeds ${MAX_CATALOG_BYTES} bytes`)
    }
    chunks.push(next.value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

function optionalWebURL(value: unknown, label: string) {
  if (value === undefined) return undefined
  const raw = text(value, label)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL`)
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use HTTP or HTTPS`)
  }
  if (parsed.username || parsed.password) throw new Error(`${label} cannot contain credentials`)
  return parsed.href
}

function parseIcon(value: unknown, label: string): MarketplaceIcon {
  if (typeof value === "string") return { "src-light": iconAsset(value, label) }
  const icon = record(value, label)
  return {
    "src-light": iconAsset(icon["src-light"], `${label}.src-light`),
    ...(icon["src-dark"] === undefined ? {} : { "src-dark": iconAsset(icon["src-dark"], `${label}.src-dark`) }),
  }
}

function iconAsset(value: unknown, label: string) {
  const raw = text(value, label)
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw
  if (raw.startsWith("./")) {
    if (raw.includes("\\") || raw.split("/").includes("..")) {
      throw new Error(`${label} must stay inside the catalog directory`)
    }
    return raw
  }
  return optionalWebURL(raw, label)!
}

function resolveCatalogAssets(catalog: MarketplaceCatalog, source: string): MarketplaceCatalog {
  const base = normalizeMarketplaceURL(source)
  return {
    ...catalog,
    items: catalog.items.map((item) => ({
      ...item,
      ...(item.icon
        ? {
            icon: {
              "src-light": resolveCatalogAsset(item.icon["src-light"], base, "catalog item icon"),
              ...(item.icon["src-dark"]
                ? { "src-dark": resolveCatalogAsset(item.icon["src-dark"], base, "catalog item icon") }
                : {}),
            },
          }
        : {}),
      install: resolveCatalogPlan(item.install, base),
    })),
  }
}

function resolveCatalogPlan(plan: MarketplaceInstallPlan, source: string): MarketplaceInstallPlan {
  const plugins = plan.plugins?.map((plugin, index) => resolveCatalogPlugin(plugin, source, index))
  const mcp = Object.fromEntries(
    Object.entries(plan.mcp ?? {}).map(([name, config]) => [
      name,
      resolveCatalogMcp(config, source, `install.mcp.${name}`),
    ]),
  )
  const relativeSkillPaths = (plan.skills?.paths ?? []).filter((value) => value.startsWith("./"))
  const skillPaths = (plan.skills?.paths ?? []).filter((value) => !value.startsWith("./"))
  const skillURLs = Array.from(
    new Set([
      ...(plan.skills?.urls ?? []).map((value, index) =>
        resolveCatalogAsset(value, source, `install.skills.urls[${index}]`, true),
      ),
      ...relativeSkillPaths.map((value, index) =>
        resolveCatalogAsset(value, source, `install.skills.paths[${index}]`, true),
      ),
    ]),
  )
  const skillItems = (plan.skills?.items ?? []).map((item, index) => resolveCatalogSkill(item, source, index))

  return {
    ...clone(plan),
    ...(plugins ? { plugins } : {}),
    ...(plan.mcp ? { mcp } : {}),
    ...(plan.skills
      ? {
          skills: {
            ...(skillPaths.length ? { paths: skillPaths } : {}),
            ...(skillURLs.length ? { urls: skillURLs } : {}),
            ...(skillItems.length ? { items: skillItems } : {}),
          },
        }
      : {}),
    ...(plan.instructions
      ? {
          instructions: plan.instructions.map((value, index) =>
            resolveCatalogAsset(value, source, `install.instructions[${index}]`),
          ),
        }
      : {}),
  }
}

function resolveCatalogMcp(config: Record<string, unknown>, source: string, label: string) {
  if (config.type !== "local" || !Array.isArray(config.command)) return clone(config)
  return {
    ...clone(config),
    command: config.command.map((value, index) =>
      typeof value === "string" && value.startsWith("./")
        ? resolveCatalogAsset(value, source, `${label}.command[${index}]`)
        : value,
    ),
  }
}

function resolveCatalogPlugin(plugin: MarketplacePluginSpec, source: string, index: number): MarketplacePluginSpec {
  const spec = Array.isArray(plugin) ? plugin[0] : plugin
  const resolved = resolveCatalogAsset(spec, source, `install.plugins[${index}]`)
  return Array.isArray(plugin) ? [resolved, clone(plugin[1])] : resolved
}

function resolveCatalogSkill(item: MarketplaceSkill, source: string, index: number): MarketplaceSkill {
  if (item.path?.startsWith("./")) {
    const { path: _path, ...rest } = item
    return {
      ...rest,
      url: resolveCatalogAsset(item.path, source, `install.skills.items[${index}].path`, true),
    }
  }
  if (!item.url) return clone(item)
  return {
    ...clone(item),
    url: resolveCatalogAsset(item.url, source, `install.skills.items[${index}].url`, item.url.endsWith("/")),
  }
}

function resolveCatalogAsset(value: string, source: string, label: string, directory = false) {
  if (!value.startsWith("./")) return value
  const pathname = value.split(/[?#]/)[0] ?? value
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    throw new Error(`${label} contains invalid URL encoding`)
  }
  if (value.includes("\\") || decoded.split("/").includes("..")) {
    throw new Error(`${label} must stay inside the catalog directory`)
  }
  const relative = directory && !pathname.endsWith("/") ? `${pathname}/${value.slice(pathname.length)}` : value
  return new URL(relative, source).href
}

function color(value: unknown, label: string) {
  const result = text(value, label)
  if (!/^#[0-9a-f]{6}$/i.test(result)) throw new Error(`${label} must be a six-digit hex color`)
  return result.toUpperCase()
}

export function marketplaceSnapshot(item: MarketplaceCatalogItem): MarketplaceInstalledSnapshot {
  const { install: _, ...snapshot } = item
  return clone(snapshot)
}

function configuredTrust(value: MarketplaceTrust | undefined): MarketplaceConfiguredTrust {
  return value === "private" ? "private" : "community"
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function identifier(value: unknown, label: string) {
  const result = text(value, label)
  if (result.length > MAX_IDENTIFIER_LENGTH || result.includes(":") || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(
      `${label} must be at most ${MAX_IDENTIFIER_LENGTH} characters and cannot contain colons or control characters`,
    )
  }
  return result
}

function sourceHost(value: string) {
  if (value.startsWith("builtin://")) return value.slice("builtin://".length)
  try {
    const url = new URL(value)
    if (url.protocol !== "file:") return url.hostname
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean)
    return parts.at(-1) ?? url.hostname
  } catch {
    return ""
  }
}

function stable(value: unknown): string {
  return stableMarketplaceValue(value)
}

function equal(a: unknown, b: unknown) {
  return stable(a) === stable(b)
}

function clone<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(clone) as Value
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as Value
  }
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function strings(value: unknown, label: string) {
  return array(value, label).map((item, index) => text(item, `${label}[${index}]`))
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalText(value: unknown, label: string) {
  if (value === undefined) return false
  text(value, label)
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
