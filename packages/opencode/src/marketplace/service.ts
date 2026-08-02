import { Context, Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import {
  createMarketplaceSource,
  loadMarketplace,
  marketplaceActivePlan,
  marketplaceConflicts,
  marketplaceEnabledMcpNames,
  marketplaceFingerprint,
  marketplaceInitialDisabledMcp,
  marketplacePermissions,
  marketplacePlanSummary,
  marketplaceSkillComponents,
  marketplaceSnapshot,
  marketplaceStatus,
  removeMarketplaceSource,
  toggleMarketplaceSource,
  upsertMarketplaceSource,
  type MarketplaceConfiguredTrust,
  type MarketplaceHostConfig,
  type MarketplaceInstalled,
  type MarketplaceListing,
  type MarketplaceMutationResult,
  type MarketplacePlanResult,
  type MarketplaceSource,
  type MarketplaceState,
  type MarketplaceView,
} from "@opencode-ai/core/marketplace"
import {
  exportMarketplaceProfile,
  parseMarketplaceProfile,
  type MarketplaceProfile,
} from "@opencode-ai/core/marketplace-profile"
import { exportMarketplaceLock, verifyMarketplaceLock, type MarketplaceLock } from "@opencode-ai/core/marketplace-lock"
import { Config } from "@/config/config"
import { composeMarketplaceConfig } from "./overlay"
import * as MarketplaceRegistry from "./registry"
import * as MarketplaceCache from "./cache"
import { resolveMarketplaceSourceReference } from "./source"
import { createMarketplacePlanStore } from "./plan-store"

export type InstallInput = {
  planId: string
  expectedRevision: number
  force?: boolean
  acceptUntrusted?: boolean
}

export type UpdateAllInput = {
  expectedRevision: number
  force?: boolean
  acceptUntrusted?: boolean
}

export type ToggleInput = {
  key: string
  expectedRevision: number
  component: "package" | "skill" | "mcp"
  id?: string
  enabled: boolean
}

export type SourceAddInput = {
  expectedRevision: number
  url: string
  name?: string
  trust?: MarketplaceConfiguredTrust
  format?: MarketplaceSource["format"]
  headerEnv?: Record<string, string>
}

export type IconInput = {
  key: string
  variant: "src-light" | "src-dark"
}

export type ProfilePlanInput = {
  profile: unknown
  mode?: "merge" | "replace"
}

export interface Interface {
  readonly get: (options?: { refresh?: boolean; cursor?: string; limit?: number }) => Effect.Effect<MarketplaceView>
  readonly icon: (input: IconInput) => Effect.Effect<{ data_url?: string }>
  readonly plan: (key: string) => Effect.Effect<MarketplacePlanResult>
  readonly install: (input: InstallInput) => Effect.Effect<MarketplaceMutationResult>
  readonly updateAll: (input: UpdateAllInput) => Effect.Effect<MarketplaceMutationResult>
  readonly updatePlan: () => Effect.Effect<
    | {
        ok: true
        plan_id: string
        expires_at: string
        actions: Array<{ key: string; action: "update" }>
        trust_warning: boolean
        conflicts: Awaited<ReturnType<typeof marketplaceConflicts>>
      }
    | { ok: false; reason: "materialization" | "incompatible"; message: string }
  >
  readonly uninstall: (input: { key: string; expectedRevision: number }) => Effect.Effect<MarketplaceMutationResult>
  readonly toggle: (input: ToggleInput) => Effect.Effect<MarketplaceMutationResult>
  readonly sourceAdd: (input: SourceAddInput) => Effect.Effect<MarketplaceMutationResult>
  readonly sourceToggle: (input: {
    id: string
    expectedRevision: number
    enabled: boolean
  }) => Effect.Effect<MarketplaceMutationResult>
  readonly sourceRemove: (input: { id: string; expectedRevision: number }) => Effect.Effect<MarketplaceMutationResult>
  readonly profileExport: (input?: { name?: string; description?: string }) => Effect.Effect<MarketplaceProfile>
  readonly profilePlan: (input: ProfilePlanInput) => Effect.Effect<
    | {
        ok: true
        plan_id: string
        expires_at: string
        actions: Array<{ key: string; action: "install" | "update" }>
        trust_warning: boolean
        conflicts: Awaited<ReturnType<typeof marketplaceConflicts>>
      }
    | { ok: false; reason: "not_found" | "materialization" | "incompatible" | "digest"; message: string }
  >
  readonly profileApply: (input: InstallInput) => Effect.Effect<MarketplaceMutationResult>
  readonly lockExport: () => Effect.Effect<MarketplaceLock>
  readonly lockVerify: (lock: MarketplaceLock) => Effect.Effect<{ ok: boolean; errors: string[] }>
  readonly audit: (limit?: number) => ReturnType<MarketplaceRegistry.Interface["audit"]>
  readonly cachePrune: (input?: { maxAgeDays?: number }) => Effect.Effect<MarketplaceView["cache"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplaceService") {}
export const MarketplaceService = Service

function clone<T>(value: T): T {
  return structuredClone(value)
}

function publicSource(source: MarketplaceSource): MarketplaceSource {
  const { headers: _headers, ...value } = source
  return value
}

function publicState(state: MarketplaceState): MarketplaceState {
  return {
    revision: state.revision ?? 0,
    ...(state.sources ? { sources: state.sources.map(publicSource) } : {}),
    ...(state.installed
      ? {
          installed: Object.fromEntries(
            Object.entries(state.installed).map(([key, installed]) => {
              const {
                materialized_plan: _materializedPlan,
                active_plan: _activePlan,
                artifact_digests: _artifactDigests,
                catalog_digest: _catalogDigest,
                manifest_digest: _manifestDigest,
                materialized_digest: _materializedDigest,
                ...value
              } = installed
              const skills = marketplaceSkillComponents(installed.materialized_plan ?? installed.plan).map(
                ({ source: _source, path: _path, url: _url, ...skill }) => skill,
              )
              return [
                key,
                {
                  ...value,
                  plan: {
                    ...value.plan,
                    ...(skills.length ? { skills: { items: skills } } : {}),
                  },
                  receipt: {},
                },
              ]
            }),
          ),
        }
      : {}),
  }
}

function runtimeState(state: MarketplaceState): MarketplaceState {
  return {
    ...state,
    sources: state.sources?.map((source) => ({
      ...source,
      ...(source.header_env
        ? {
            headers: Object.fromEntries(
              Object.entries(source.header_env).flatMap(([name, variable]) => {
                if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(name)) return []
                if (["connection", "content-length", "host", "transfer-encoding"].includes(name.toLowerCase()))
                  return []
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) return []
                const value = process.env[variable]
                return value === undefined ? [] : [[name, value]]
              }),
            ),
          }
        : {}),
    })),
  }
}

function publicListing(listing: MarketplaceListing): MarketplaceListing {
  return {
    ...listing,
    source: publicSource(listing.source),
  }
}

function revisionFailure(expected: number, actual: number): MarketplaceMutationResult {
  return {
    ok: false,
    reason: "revision",
    message: `Marketplace state changed concurrently (expected revision ${expected}, actual ${actual})`,
    revision: actual,
  }
}

function notFound(message: string): MarketplaceMutationResult {
  return { ok: false, reason: "not_found", message }
}

function stateWithout(state: MarketplaceState, key: string): MarketplaceState {
  const installed = { ...(state.installed ?? {}) }
  delete installed[key]
  return {
    ...clone(state),
    installed,
  }
}

function trusted(source: MarketplaceSource) {
  return source.trust === "official" || source.trust === "verified"
}

function sourceHeaders(source: MarketplaceSource, target: string) {
  if (!source.headers) return undefined
  try {
    const left = new URL(source.url)
    const right = new URL(target)
    if (!["http:", "https:"].includes(left.protocol) || !["http:", "https:"].includes(right.protocol)) {
      return undefined
    }
    return left.origin === right.origin ? source.headers : undefined
  } catch {
    return undefined
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* MarketplaceRegistry.Service
    const cache = yield* MarketplaceCache.Service
    const config = yield* Config.Service
    const compatibility = {
      opencode: InstallationVersion,
      platform: process.platform,
      architecture: process.arch,
      runtimes: ["bun", "node"],
      capabilities: ["plugins", "skills", "agents", "commands", "mcp", "instructions"],
    }
    const plans = createMarketplacePlanStore<{
      entries: Array<{ key: string; listing: MarketplaceListing; installed: MarketplaceInstalled }>
      conflicts: Awaited<ReturnType<typeof marketplaceConflicts>>
      trustWarning: boolean
      sources?: MarketplaceSource[]
      replace?: boolean
    }>()

    const loadView = Effect.fnUntraced(function* (state: MarketplaceState, refresh: boolean) {
      const loaded = yield* Effect.tryPromise({
        try: () =>
          loadMarketplace({
            config: { marketplace: runtimeState(state) },
            fetch: cache.fetcher(refresh ? "refresh" : "cache-first"),
            compatibility,
          }),
        catch: (error) => error,
      }).pipe(Effect.orDie)
      return {
        state: publicState(state),
        listings: loaded.listings.map(publicListing),
        errors: loaded.errors.map((error) => ({ ...error, source: publicSource(error.source) })),
        cache: yield* cache.summary(),
      } satisfies MarketplaceView
    })

    const get = Effect.fn("MarketplaceService.get")(function* (options?: {
      refresh?: boolean
      cursor?: string
      limit?: number
    }) {
      const view = yield* loadView(yield* registry.read(), options?.refresh === true)
      if (options?.limit === undefined) return view
      const limit = Math.max(1, Math.min(options.limit, 200))
      const start = options.cursor
        ? Math.max(0, view.listings.findIndex((listing) => listing.key === options.cursor) + 1)
        : 0
      const listings = view.listings.slice(start, start + limit)
      return {
        ...view,
        listings,
        ...(start + limit < view.listings.length && listings.length ? { next_cursor: listings.at(-1)!.key } : {}),
      }
    })

    const rawBase = Effect.fnUntraced(function* () {
      return (yield* config.getGlobalBase()) as MarketplaceHostConfig
    })

    const conflictList = Effect.fnUntraced(function* (state: MarketplaceState, listing: MarketplaceListing) {
      const base = yield* rawBase()
      const effective = composeMarketplaceConfig(base, stateWithout(state, listing.key))
      return marketplaceConflicts(effective, listing.item.install)
    })

    const plan = Effect.fn("MarketplaceService.plan")(function* (key: string) {
      const state = yield* registry.read()
      const listing = yield* findListing(state, key, true)
      if (!listing) {
        return {
          ok: false,
          reason: "not_found",
          message: `Marketplace item not found: ${key}`,
        } satisfies MarketplacePlanResult
      }
      if (listing.compatibility?.compatible === false) {
        return {
          ok: false,
          reason: "incompatible",
          message: listing.compatibility.reasons.join("; "),
        } satisfies MarketplacePlanResult
      }
      const status = marketplaceStatus({ marketplace: state }, listing)
      const conflicts = yield* conflictList(state, listing)
      const prepared = yield* prepare({ state, listing })
      if (!prepared.ok) {
        return {
          ok: false,
          reason: "materialization",
          message: prepared.failure.message,
        } satisfies MarketplacePlanResult
      }
      const stored = plans.create(state.revision ?? 0, {
        entries: [{ key, listing, installed: prepared.installed }],
        conflicts,
        trustWarning: !trusted(listing.source),
      })
      return {
        ok: true,
        plan_id: stored.id,
        expires_at: new Date(stored.expiresAt).toISOString(),
        key,
        action: status === "update" ? "update" : "install",
        listing_digest: listing.listing_digest!,
        plan_digest: listing.plan_digest!,
        compatibility: listing.compatibility ?? { compatible: true, reasons: [] },
        trust_warning: stored.value.trustWarning,
        conflicts,
        permissions: marketplacePermissions(listing.item),
        summary: marketplacePlanSummary(prepared.installed.materialized_plan ?? listing.item.install),
      } satisfies MarketplacePlanResult
    })

    const findListing = Effect.fnUntraced(function* (state: MarketplaceState, key: string, refresh: boolean) {
      const loaded = yield* Effect.tryPromise({
        try: () =>
          loadMarketplace({
            config: { marketplace: runtimeState(state) },
            fetch: cache.fetcher(refresh ? "refresh" : "cache-first"),
            compatibility,
          }),
        catch: (error) => error,
      }).pipe(Effect.orDie)
      return loaded.listings.find((listing) => listing.key === key)
    })

    const icon = Effect.fn("MarketplaceService.icon")(function* (input: IconInput) {
      const state = yield* registry.read()
      const listing = yield* findListing(state, input.key, false)
      const url = listing?.item.icon?.[input.variant]
      if (!listing || !url) return {}
      const dataURL = yield* cache
        .dataURL({
          url,
          headers: sourceHeaders(listing.source, url),
          source: listing.source,
        })
        .pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch(() => Effect.succeed({ ok: false as const })),
        )
      if (!dataURL.ok || !dataURL.value) return {}
      return { data_url: dataURL.value }
    })

    const prepare = Effect.fnUntraced(function* (input: { state: MarketplaceState; listing: MarketplaceListing }) {
      const materialized = yield* cache.materializePlan(input.listing.item.install, input.listing.source).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false as const,
            failure: {
              ok: false,
              reason: "materialization",
              message: error.message,
              revision: input.state.revision ?? 0,
            } satisfies MarketplaceMutationResult,
          }),
        ),
      )
      if (!materialized.ok) return materialized

      const manifest = yield* cache
        .putJson(
          {
            schema: "opencode.marketplace.manifest/v1",
            source: {
              id: input.listing.source.id,
              name: input.listing.source.name,
              url: input.listing.source.url,
              trust: input.listing.source.trust,
            },
            catalog: {
              id: input.listing.catalog.id,
              name: input.listing.catalog.name,
            },
            item: input.listing.item,
          },
          { kind: "item-manifest", sourceUrl: input.listing.catalog_url ?? input.listing.source.url },
        )
        .pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) =>
            Effect.succeed({
              ok: false as const,
              failure: {
                ok: false,
                reason: "materialization",
                message: error.message,
                revision: input.state.revision ?? 0,
              } satisfies MarketplaceMutationResult,
            }),
          ),
        )
      if (!manifest.ok) return manifest

      const artifactDigests = new Set(materialized.value.artifactDigests)
      artifactDigests.add(manifest.value.digest)
      if (input.listing.catalog_digest) artifactDigests.add(input.listing.catalog_digest)

      for (const icon of Object.values(input.listing.item.icon ?? {})) {
        if (!/^(?:https?|file):/i.test(icon)) continue
        yield* cache
          .fetchResponse({
            url: icon,
            headers: sourceHeaders(input.listing.source, icon),
            kind: "icon",
            mode: "refresh",
            source: input.listing.source,
          })
          .pipe(
            Effect.tap((response) =>
              Effect.sync(() => {
                const digest = response.headers.get("x-opencode-artifact-digest")
                if (digest) artifactDigests.add(digest)
              }),
            ),
            Effect.catch(() => Effect.void),
          )
      }

      const current = input.state.installed?.[input.listing.key]
      const components = marketplaceSkillComponents(materialized.value.plan)
      const disabledSkills =
        current?.disabled_skills?.filter((id) => components.some((component) => component.id === id)) ??
        components.filter((component) => component.enabled === false).map((component) => component.id)
      const disabledMcp =
        current?.disabled_mcp?.filter((id) => id in (input.listing.item.install.mcp ?? {})) ??
        marketplaceInitialDisabledMcp(input.listing.item.install)
      const enabled = current?.enabled !== false
      const activePlan = marketplaceActivePlan(materialized.value.plan, {
        enabled,
        disabled_skills: disabledSkills,
        disabled_mcp: disabledMcp,
      })
      const now = new Date().toISOString()

      const installed: MarketplaceInstalled = {
        source: input.listing.source.id,
        source_url: input.listing.source.reference ?? input.listing.source.url,
        source_trust: input.listing.source.trust,
        catalog: input.listing.catalog.id,
        catalog_name: input.listing.catalog.name,
        item: input.listing.item.id,
        name: input.listing.item.name,
        kind: input.listing.item.kind,
        version: input.listing.item.version,
        publisher: input.listing.item.publisher?.name ?? input.listing.catalog.publisher?.name,
        fingerprint: marketplaceFingerprint(input.listing.item),
        ...(input.listing.listing_digest ? { listing_digest: input.listing.listing_digest } : {}),
        ...(input.listing.plan_digest ? { plan_digest: input.listing.plan_digest } : {}),
        priority: current?.priority ?? Object.keys(input.state.installed ?? {}).length,
        installed_at: current?.installed_at ?? now,
        updated_at: now,
        snapshot: marketplaceSnapshot(input.listing.item),
        plan: clone(input.listing.item.install),
        materialized_plan: materialized.value.plan,
        active_plan: activePlan,
        receipt: {},
        enabled,
        ...(disabledSkills.length ? { disabled_skills: disabledSkills } : {}),
        ...(disabledMcp.length ? { disabled_mcp: disabledMcp } : {}),
        ...(input.listing.catalog_digest ? { catalog_digest: input.listing.catalog_digest } : {}),
        manifest_digest: manifest.value.digest,
        ...(materialized.value.treeDigest ? { materialized_digest: materialized.value.treeDigest } : {}),
        artifact_digests: Array.from(artifactDigests).toSorted(),
      }

      return { ok: true as const, installed }
    })

    const persist = Effect.fnUntraced(function* (input: {
      state: MarketplaceState
      connectMcp?: string[]
      preserved?: string[]
    }) {
      const stored = yield* registry.replace(input.state).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (!stored.ok) {
        const error = stored.error
        if (error instanceof MarketplaceRegistry.ConflictError) return revisionFailure(error.expected, error.actual)
        return revisionFailure(input.state.revision ?? 0, (yield* registry.read()).revision ?? 0)
      }
      if (stored.value.changed) yield* config.invalidate()
      return {
        ok: true,
        changed: stored.value.changed,
        view: yield* loadView(stored.value.state, false),
        connect_mcp: Array.from(new Set(input.connectMcp ?? [])).toSorted(),
        preserved: input.preserved ?? [],
      } satisfies MarketplaceMutationResult
    })

    const install = Effect.fn("MarketplaceService.install")(function* (input: InstallInput) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const lookup = plans.get(input.planId)
      if (!lookup.ok) {
        return {
          ok: false,
          reason: `plan_${lookup.reason}`,
          message: `Marketplace plan is ${lookup.reason.replace("_", " ")}`,
          revision: state.revision ?? 0,
        } satisfies MarketplaceMutationResult
      }
      if (lookup.plan.revision !== (state.revision ?? 0)) {
        return revisionFailure(lookup.plan.revision, state.revision ?? 0)
      }
      if (lookup.plan.value.conflicts.length && !input.force) {
        return {
          ok: false,
          reason: "conflict",
          message: `Marketplace item conflicts with ${lookup.plan.value.conflicts.map((item) => item.path).join(", ")}`,
          revision: state.revision ?? 0,
          conflicts: lookup.plan.value.conflicts,
        } satisfies MarketplaceMutationResult
      }
      if (lookup.plan.value.trustWarning && !input.acceptUntrusted) {
        return {
          ok: false,
          reason: "trust",
          message: `One or more Marketplace catalogs require explicit trust confirmation`,
          revision: state.revision ?? 0,
        } satisfies MarketplaceMutationResult
      }
      const consumed = plans.consume(input.planId)
      if (!consumed.ok) {
        return {
          ok: false,
          reason: `plan_${consumed.reason}`,
          message: `Marketplace plan is ${consumed.reason.replace("_", " ")}`,
          revision: state.revision ?? 0,
        } satisfies MarketplaceMutationResult
      }
      const installed = consumed.plan.value.replace ? {} : { ...(state.installed ?? {}) }
      for (const entry of consumed.plan.value.entries) installed[entry.listing.key] = entry.installed
      const next: MarketplaceState = {
        ...clone(state),
        ...(consumed.plan.value.sources ? { sources: consumed.plan.value.sources } : {}),
        installed,
      }
      return yield* persist({
        state: next,
        connectMcp: consumed.plan.value.entries.flatMap((entry) =>
          marketplaceEnabledMcpNames(
            { marketplace: { installed: { [entry.listing.key]: entry.installed } } },
            entry.listing.key,
          ),
        ),
      })
    })

    const updatePlan = Effect.fn("MarketplaceService.updatePlan")(function* () {
      const state = yield* registry.read()
      const loaded = yield* Effect.tryPromise({
        try: () =>
          loadMarketplace({
            config: { marketplace: runtimeState(state) },
            fetch: cache.fetcher("refresh"),
            compatibility,
          }),
        catch: (error) => error,
      }).pipe(Effect.orDie)
      const candidates = loaded.listings.filter(
        (listing) => marketplaceStatus({ marketplace: state }, listing) === "update",
      )
      const conflicts = [] as Awaited<ReturnType<typeof marketplaceConflicts>>
      let trustWarning = false
      for (const listing of candidates) {
        if (listing.compatibility?.compatible === false) {
          return {
            ok: false as const,
            reason: "incompatible" as const,
            message: `${listing.item.name}: ${listing.compatibility.reasons.join("; ")}`,
          }
        }
        conflicts.push(...(yield* conflictList(state, listing)))
        trustWarning ||= !trusted(listing.source)
      }

      let working = clone(state)
      const entries: Array<{ key: string; listing: MarketplaceListing; installed: MarketplaceInstalled }> = []
      for (const listing of candidates) {
        const prepared = yield* prepare({
          state: working,
          listing,
        })
        if (!prepared.ok) {
          return { ok: false as const, reason: "materialization" as const, message: prepared.failure.message }
        }
        working.installed = {
          ...(working.installed ?? {}),
          [listing.key]: prepared.installed,
        }
        entries.push({ key: listing.key, listing, installed: prepared.installed })
      }
      const stored = plans.create(state.revision ?? 0, { entries, conflicts, trustWarning })
      return {
        ok: true as const,
        plan_id: stored.id,
        expires_at: new Date(stored.expiresAt).toISOString(),
        actions: entries.map((entry) => ({ key: entry.key, action: "update" as const })),
        trust_warning: trustWarning,
        conflicts,
      }
    })

    const updateAll = Effect.fn("MarketplaceService.updateAll")(function* (input: UpdateAllInput) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const planned = yield* updatePlan()
      if (!planned.ok) {
        return { ...planned, revision: state.revision ?? 0 } satisfies MarketplaceMutationResult
      }
      return yield* install({
        planId: planned.plan_id,
        expectedRevision: input.expectedRevision,
        force: input.force,
        acceptUntrusted: input.acceptUntrusted,
      })
    })

    const uninstall = Effect.fn("MarketplaceService.uninstall")(function* (input: {
      key: string
      expectedRevision: number
    }) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      if (!state.installed?.[input.key]) return notFound(`Marketplace install not found: ${input.key}`)
      const installed = { ...state.installed }
      delete installed[input.key]
      return yield* persist({
        state: {
          ...clone(state),
          installed,
        },
      })
    })

    const toggle = Effect.fn("MarketplaceService.toggle")(function* (input: ToggleInput) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const current = state.installed?.[input.key]
      if (!current) return notFound(`Marketplace install not found: ${input.key}`)

      const next = clone(current)
      if (input.component === "package") {
        next.enabled = input.enabled
      } else if (input.component === "skill") {
        if (
          !input.id ||
          !marketplaceSkillComponents(next.materialized_plan ?? next.plan).some(
            (component) => component.id === input.id,
          )
        ) {
          return notFound(`Marketplace skill not found: ${input.id ?? ""}`)
        }
        next.disabled_skills = input.enabled
          ? (next.disabled_skills ?? []).filter((id) => id !== input.id)
          : Array.from(new Set([...(next.disabled_skills ?? []), input.id]))
      } else {
        if (!input.id || !(input.id in ((next.materialized_plan ?? next.plan).mcp ?? {}))) {
          return notFound(`Marketplace MCP server not found: ${input.id ?? ""}`)
        }
        next.disabled_mcp = input.enabled
          ? (next.disabled_mcp ?? []).filter((id) => id !== input.id)
          : Array.from(new Set([...(next.disabled_mcp ?? []), input.id]))
      }

      if (!next.disabled_skills?.length) delete next.disabled_skills
      if (!next.disabled_mcp?.length) delete next.disabled_mcp
      next.active_plan = marketplaceActivePlan(next.materialized_plan ?? next.plan, next)
      next.updated_at = new Date().toISOString()

      const nextState: MarketplaceState = {
        ...clone(state),
        installed: {
          ...state.installed,
          [input.key]: next,
        },
      }
      return yield* persist({
        state: nextState,
        connectMcp: marketplaceEnabledMcpNames({ marketplace: { installed: { [input.key]: next } } }, input.key),
      })
    })

    const sourceAdd = Effect.fn("MarketplaceService.sourceAdd")(function* (input: SourceAddInput) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const resolved = yield* Effect.promise(() => resolveMarketplaceSourceReference(input.url))
      const source = {
        ...createMarketplaceSource({
          url: resolved.url,
          name: input.name ?? resolved.name,
          trust: input.trust,
          format: input.format,
          header_env: resolved.local ? undefined : input.headerEnv,
        }),
        reference: resolved.reference,
      }
      const loaded = yield* Effect.tryPromise({
        try: () =>
          loadMarketplace({
            config: { marketplace: runtimeState({ sources: [source] }) },
            fetch: cache.fetcher("refresh"),
            compatibility,
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (!loaded.ok) return notFound(loaded.error.message)
      const failure = loaded.value.errors[0]
      if (failure) return notFound(failure.message)
      const next = upsertMarketplaceSource({ marketplace: state }, source).marketplace ?? state
      return yield* persist({ state: next })
    })

    const sourceToggle = Effect.fn("MarketplaceService.sourceToggle")(function* (input: {
      id: string
      expectedRevision: number
      enabled: boolean
    }) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const next = toggleMarketplaceSource({ marketplace: state }, input.id, input.enabled).marketplace ?? state
      return yield* persist({ state: next })
    })

    const sourceRemove = Effect.fn("MarketplaceService.sourceRemove")(function* (input: {
      id: string
      expectedRevision: number
    }) {
      const state = yield* registry.read()
      if ((state.revision ?? 0) !== input.expectedRevision) {
        return revisionFailure(input.expectedRevision, state.revision ?? 0)
      }
      const next = removeMarketplaceSource({ marketplace: state }, input.id).marketplace ?? state
      return yield* persist({ state: next })
    })

    const profileExport = Effect.fn("MarketplaceService.profileExport")(function* (input?: {
      name?: string
      description?: string
    }) {
      return exportMarketplaceProfile(yield* registry.read(), input)
    })

    const profilePlan = Effect.fn("MarketplaceService.profilePlan")(function* (input: ProfilePlanInput) {
      const profile = yield* Effect.try({
        try: () => parseMarketplaceProfile(input.profile),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (!profile.ok) return { ok: false as const, reason: "not_found" as const, message: profile.error.message }

      const state = yield* registry.read()
      const sources: MarketplaceSource[] = []
      const sourceIDs = new Map<string, string>()
      for (const item of profile.value.sources) {
        const resolved = yield* Effect.tryPromise({
          try: () => resolveMarketplaceSourceReference(item.url),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        )
        if (!resolved.ok) return { ok: false as const, reason: "not_found" as const, message: resolved.error.message }
        const source = {
          ...createMarketplaceSource({
            url: resolved.value.url,
            name: item.name,
            trust: item.trust === "private" ? "private" : "community",
            format: item.format,
          }),
          reference: resolved.value.reference,
        }
        sourceIDs.set(item.id, source.id)
        sources.push(source)
      }
      const nextSources = [
        ...(state.sources ?? []).filter((source) => !sources.some((candidate) => candidate.id === source.id)),
        ...sources,
      ]
      const planning: MarketplaceState = {
        ...clone(state),
        sources: nextSources,
        ...(input.mode === "replace" ? { installed: {} } : {}),
      }
      const loaded = yield* Effect.tryPromise({
        try: () =>
          loadMarketplace({
            config: { marketplace: runtimeState(planning) },
            fetch: cache.fetcher("refresh"),
            compatibility,
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      )
      if (!loaded.ok) return { ok: false as const, reason: "not_found" as const, message: loaded.error.message }

      const entries: Array<{ key: string; listing: MarketplaceListing; installed: MarketplaceInstalled }> = []
      const conflicts = [] as Awaited<ReturnType<typeof marketplaceConflicts>>
      let trustWarning = false
      let working = planning
      for (const desired of profile.value.packages) {
        const sourceID = sourceIDs.get(desired.source) ?? desired.source
        const listing = loaded.value.listings.find(
          (candidate) =>
            candidate.source.id === sourceID &&
            candidate.catalog.id === desired.catalog &&
            candidate.item.id === desired.item,
        )
        if (!listing) {
          return {
            ok: false as const,
            reason: "not_found" as const,
            message: `Marketplace item not found: ${desired.name}`,
          }
        }
        if (listing.compatibility?.compatible === false) {
          return {
            ok: false as const,
            reason: "incompatible" as const,
            message: `${desired.name}: ${listing.compatibility.reasons.join("; ")}`,
          }
        }
        if (desired.listing_digest && desired.listing_digest !== listing.listing_digest) {
          return { ok: false as const, reason: "digest" as const, message: `${desired.name}: listing digest changed` }
        }
        if (desired.plan_digest && desired.plan_digest !== listing.plan_digest) {
          return {
            ok: false as const,
            reason: "digest" as const,
            message: `${desired.name}: install plan digest changed`,
          }
        }
        const itemConflicts = yield* conflictList(working, listing)
        conflicts.push(...itemConflicts)
        trustWarning ||= !trusted(listing.source)
        const prepared = yield* prepare({ state: working, listing })
        if (!prepared.ok) {
          return { ok: false as const, reason: "materialization" as const, message: prepared.failure.message }
        }
        prepared.installed.enabled = desired.enabled
        prepared.installed.priority = desired.priority ?? prepared.installed.priority
        prepared.installed.disabled_skills = Object.entries(desired.components.skills)
          .filter(([, enabled]) => !enabled)
          .map(([id]) => id)
        prepared.installed.disabled_mcp = Object.entries(desired.components.mcp)
          .filter(([, enabled]) => !enabled)
          .map(([id]) => id)
        prepared.installed.active_plan = marketplaceActivePlan(
          prepared.installed.materialized_plan ?? prepared.installed.plan,
          prepared.installed,
        )
        entries.push({ key: listing.key, listing, installed: prepared.installed })
        working = {
          ...working,
          installed: { ...(working.installed ?? {}), [listing.key]: prepared.installed },
        }
      }
      const stored = plans.create(state.revision ?? 0, {
        entries,
        conflicts,
        trustWarning,
        sources: nextSources,
        replace: input.mode === "replace",
      })
      return {
        ok: true as const,
        plan_id: stored.id,
        expires_at: new Date(stored.expiresAt).toISOString(),
        actions: entries.map((entry) => ({
          key: entry.key,
          action:
            marketplaceStatus({ marketplace: state }, entry.listing) === "update"
              ? ("update" as const)
              : ("install" as const),
        })),
        trust_warning: trustWarning,
        conflicts,
      }
    })

    const lockExport = Effect.fn("MarketplaceService.lockExport")(function* () {
      return exportMarketplaceLock(yield* registry.read())
    })

    const lockVerify = Effect.fn("MarketplaceService.lockVerify")(function* (lock: MarketplaceLock) {
      return verifyMarketplaceLock(yield* registry.read(), lock)
    })

    const audit = Effect.fn("MarketplaceService.audit")(function* (limit?: number) {
      return yield* registry.audit(limit)
    })

    const cachePrune = Effect.fn("MarketplaceService.cachePrune")(function* (input?: { maxAgeDays?: number }) {
      const state = yield* registry.read()
      const keep = new Set<string>()
      for (const installed of Object.values(state.installed ?? {})) {
        for (const digest of installed.artifact_digests ?? []) keep.add(digest)
        if (installed.catalog_digest) keep.add(installed.catalog_digest)
        if (installed.manifest_digest) keep.add(installed.manifest_digest)
        if (installed.materialized_digest) keep.add(installed.materialized_digest)
      }
      return (yield* cache.prune({ keep, maxAgeDays: input?.maxAgeDays }).pipe(Effect.orDie)).summary
    })

    return Service.of({
      get,
      icon,
      plan,
      install,
      updateAll,
      updatePlan,
      uninstall,
      toggle,
      sourceAdd,
      sourceToggle,
      sourceRemove,
      profileExport,
      profilePlan,
      profileApply: install,
      lockExport,
      lockVerify,
      audit,
      cachePrune,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, MarketplaceCache.node, MarketplaceRegistry.node],
})

export const MarketplaceServiceNode = node
