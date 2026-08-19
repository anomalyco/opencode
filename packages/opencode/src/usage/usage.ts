import { Auth } from "@/auth"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import { getUsageProviderInfo, isUsageProvider, listUsageProviders, type UsageProviderInfo } from "./registry"
import type {
  Response,
  Result,
  ResultError,
  ResultErrorCode,
  ResultStatus,
  Snapshot,
  UsageFetchError,
  UsageFetchResult,
} from "./types"

const USAGE_CACHE_TTL_MS = 5 * 60 * 1000
const snapshots = new Map<string, Snapshot>()
const activeIdentities = new Map<string, string>()

/** @internal Exported for test isolation. */
export function clearCache() {
  snapshots.clear()
  activeIdentities.clear()
}

type OAuthAuth = Extract<Auth.Info, { type: "oauth" }>

export type Query = {
  provider?: string
  refresh?: boolean
}

type FetchEntryResult = {
  provider: string
  result: Result
}

export interface Interface {
  readonly getResponse: (query: Query) => Effect.Effect<Response, Auth.AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Usage") {}
export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const inflight = new Map<string, Effect.Effect<UsageFetchResult>>()

    const resolveProvider = (input: string) => {
      const normalized = input.trim().toLowerCase()
      if (isUsageProvider(normalized)) return normalized
      return null
    }

    const getProviderInfo = (provider: string) => getUsageProviderInfo(provider)

    const getAuthenticatedProviders = Effect.fn("Usage.getAuthenticatedProviders")(function* (
      input?: Record<string, Auth.Info>,
    ) {
      const entries = input ?? (yield* auth.all())
      return listUsageProviders()
        .filter((provider) =>
          provider.authKeys.some((key) => {
            const providerAuth = entries[key]
            if (!providerAuth) return false
            if (provider.requiresOAuth && providerAuth.type !== "oauth") return false
            return true
          }),
        )
        .map((provider) => provider.id)
    })

    const getProviderAuth = Effect.fn("Usage.getProviderAuth")(function* (
      provider: string,
      input?: Record<string, Auth.Info>,
    ) {
      const info = getUsageProviderInfo(provider)
      if (!info) return null
      const entries = input ?? (yield* auth.all())

      for (const key of info.authKeys) {
        const providerAuth = entries[key]
        if (!providerAuth) continue
        return { key, auth: providerAuth }
      }

      return null
    })

    const cacheSnapshot = Effect.fn("Usage.cacheSnapshot")(function* (input: {
      provider: string
      authKey: string
      identity: string
      snapshot: Snapshot
    }) {
      const current = yield* getProviderAuth(input.provider)
      if (!current || current.key !== input.authKey) return
      if (cacheIdentity(input.provider, current.key, current.auth) !== input.identity) return

      const key = `${input.provider}\u0000${input.authKey}`
      const previous = activeIdentities.get(key)
      if (previous && previous !== input.identity) snapshots.delete(previous)
      activeIdentities.set(key, input.identity)
      snapshots.set(input.identity, input.snapshot)
    })

    const fetchProviderUsage = Effect.fn("Usage.fetchProviderUsage")(function* (input: {
      provider: string
      info: UsageProviderInfo
      oauth: OAuthAuth
    }) {
      const key = fetchIdentity(input.provider, input.oauth)
      const existing = inflight.get(key)
      if (existing) return yield* existing

      let task: Effect.Effect<UsageFetchResult>
      task = yield* Effect.cached(
        Effect.tryPromise(() => input.info.fetch({ auth: input.oauth })).pipe(
          Effect.orElseSucceed(
            () =>
              ({
                snapshot: null,
                error: {
                  kind: "transient",
                  message: `${input.info.displayName} usage request failed`,
                },
              }) satisfies UsageFetchResult,
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (inflight.get(key) === task) inflight.delete(key)
            }),
          ),
        ),
      )
      inflight.set(key, task)
      return yield* task
    })

    // Resolve a provider's usage credentials, returning a typed failure Result for
    // every unauthenticated/misconfigured case so fetchEntry stays a happy path.
    const resolveUsageAuth = Effect.fn("Usage.resolveUsageAuth")(function* (
      provider: string,
      info: UsageProviderInfo,
      entries: Record<string, Auth.Info>,
    ) {
      const authEntry = yield* getProviderAuth(provider, entries)
      if (!authEntry)
        return reject(
          provider,
          info,
          "missing_auth",
          `Not authenticated with ${info.displayName}. Run: opencode auth login`,
        )

      const oauth = authEntry.auth.type === "oauth" ? authEntry.auth : null
      if (!oauth)
        return reject(
          provider,
          info,
          "missing_oauth",
          info.requiresOAuth
            ? (info.oauthRequiredMessage ?? `${info.displayName} usage requires OAuth credentials.`)
            : `Missing OAuth access token for ${info.displayName}.`,
        )

      if (!oauth.access && !info.allowMissingAccess)
        return reject(provider, info, "missing_oauth", `Missing OAuth access token for ${info.displayName}.`)

      const identity = cacheIdentity(provider, authEntry.key, oauth)
      if (!identity)
        return reject(provider, info, "missing_oauth", `Missing OAuth access token for ${info.displayName}.`)

      return { ok: true as const, oauth, identity, authKey: authEntry.key }
    })

    const fetchEntry = Effect.fn("Usage.fetchEntry")(function* (
      provider: string,
      entries: Record<string, Auth.Info>,
      refresh: boolean,
    ) {
      const info = getProviderInfo(provider)
      if (!info)
        return {
          provider,
          result: makeResult(provider, provider, "unsupported", null, {
            code: "unsupported_provider",
            message: `Provider "${provider}" does not support usage tracking.`,
            retryable: false,
          }),
        } satisfies FetchEntryResult

      const resolved = yield* resolveUsageAuth(provider, info, entries)
      if (!resolved.ok) return { provider, result: resolved.result } satisfies FetchEntryResult

      const cached = snapshots.get(resolved.identity) ?? null
      const stale = !cached || Date.now() - cached.updatedAt > USAGE_CACHE_TTL_MS
      const result = yield* Effect.gen(function* () {
        if (!refresh && !stale) return makeResult(provider, info.displayName, "ok", cached)

        const fetched = yield* fetchProviderUsage({
          provider,
          info,
          oauth: resolved.oauth,
        })
        const fetchedSnapshot = fetched.snapshot && hasUsageData(fetched.snapshot) ? fetched.snapshot : null

        if (fetched.error) {
          const error = toResultError(fetched.error)
          if (cached) {
            return makeResult(provider, info.displayName, "stale", cached, {
              ...error,
              message: `${error.message} Showing cached results.`,
            })
          }
          // A best-effort fallback snapshot (e.g. Copilot token metadata) is
          // stale by definition and never cached, so the next request retries.
          if (fetchedSnapshot) return makeResult(provider, info.displayName, "stale", fetchedSnapshot, error)
          if (fetched.error.kind === "auth")
            return makeResult(provider, info.displayName, "unauthenticated", null, error)
          return makeResult(provider, info.displayName, "unavailable", null, error)
        }

        if (!fetchedSnapshot) {
          const error: ResultError = {
            code: "fetch_failed",
            message: `Unable to refresh usage data for ${info.displayName}.`,
            retryable: true,
          }
          if (cached) {
            return makeResult(provider, info.displayName, "stale", cached, {
              ...error,
              message: `${error.message} Showing cached results.`,
            })
          }
          return makeResult(provider, info.displayName, "unavailable", null, error)
        }

        if (fetched.cacheable !== false)
          yield* cacheSnapshot({
            provider,
            authKey: resolved.authKey,
            identity: resolved.identity,
            snapshot: fetchedSnapshot,
          }).pipe(Effect.ignore)
        return makeResult(provider, info.displayName, "ok", fetchedSnapshot)
      })

      return { provider, result } satisfies FetchEntryResult
    })

    const getResponse = Effect.fn("Usage.getResponse")(function* (query: Query) {
      const providerInput = query.provider?.trim()
      const refresh = query.refresh ?? false
      const resolved = providerInput ? resolveProvider(providerInput) : null

      const entries = yield* auth.all()
      const providers = providerInput
        ? [resolved ?? providerInput.toLowerCase()]
        : yield* getAuthenticatedProviders(entries)
      if (providers.length === 0) {
        return {
          results: [],
        }
      }

      const results = yield* Effect.all(
        providers.map((provider) => fetchEntry(provider, entries, refresh)),
        { concurrency: providers.length },
      )

      return {
        results: results.map((result) => result.result),
      }
    })

    return Service.of({
      getResponse,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Auth.node] })

function cacheIdentity(provider: string, authKey: string, auth: Auth.Info) {
  if (auth.type !== "oauth") return null
  return fingerprint(
    [provider, authKey, auth.accountId ?? "", auth.enterpriseUrl ?? "", auth.access, auth.refresh].join("\u0000"),
  )
}

function fetchIdentity(provider: string, auth: OAuthAuth) {
  return fingerprint(
    [provider, auth.accountId ?? "", auth.enterpriseUrl ?? "", auth.access, auth.refresh, String(auth.expires)].join(
      "\u0000",
    ),
  )
}

function hasUsageData(snapshot: Snapshot) {
  return snapshot.windows.length > 0 || snapshot.credits !== null || snapshot.planType !== null
}

function reject(provider: string, info: UsageProviderInfo, code: ResultErrorCode, message: string) {
  return {
    ok: false as const,
    result: makeResult(provider, info.displayName, "unauthenticated", null, { code, message, retryable: false }),
  }
}

function makeResult(
  provider: string,
  displayName: string,
  status: ResultStatus,
  snapshot: Snapshot | null,
  error?: ResultError,
): Result {
  return {
    provider,
    displayName,
    status,
    snapshot,
    ...(error ? { error } : {}),
  }
}

function toResultError(error: UsageFetchError): ResultError {
  if (error.kind === "auth") {
    return {
      code: "reauth_required",
      message: error.message,
      retryable: false,
    }
  }
  return {
    code: "fetch_failed",
    message: error.message,
    retryable: true,
  }
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export * as Usage from "./usage"
