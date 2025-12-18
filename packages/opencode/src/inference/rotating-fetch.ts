import { CredentialPool, CredentialStore, CredentialsMigrate } from "@/credentials"
import type { RotateDecision } from "@/provider-auth/adapter"
import { ProviderAuthRegistry } from "@/provider-auth/registry"
import { RotationStats } from "@/inference/rotation-stats"
import { Log } from "@/util/log"

const log = Log.create({ service: "inference.rotating-fetch" })

function buildRequestWithUrlAndHeaders(original: Request, url: URL, headers: Headers): Request {
  const init: RequestInit = {
    method: original.method,
    headers,
    signal: original.signal,
  }

  if (original.body) {
    init.body = original.body as any
    // Node fetch requires duplex when sending a stream body.
    ;(init as any).duplex = (original as any).duplex ?? "half"
  }

  return new Request(url, init as any)
}

function parseRetryAfterMs(resp: Response): number | undefined {
  const msHeader = resp.headers.get("retry-after-ms") ?? resp.headers.get("Retry-After-Ms")
  if (msHeader) {
    const ms = Number(msHeader.trim())
    if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
  }
  const raw = resp.headers.get("retry-after") ?? resp.headers.get("Retry-After")
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000)
  const date = Date.parse(trimmed)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

function stripApiKeyHeaders(headers: Headers): void {
  for (const name of ["authorization", "x-api-key", "api-key", "x-goog-api-key"]) {
    headers.delete(name)
  }
}

function defaultClassifyResponse(resp: Response): RotateDecision {
  if (resp.status === 401 || resp.status === 403) {
    return { rotatable: true, isAuthExpired: true, reason: `auth_expired:${resp.status}` }
  }
  if (resp.status === 429) {
    return { rotatable: true, cooldownMs: parseRetryAfterMs(resp) ?? 30_000, reason: "rate_limited" }
  }
  if (resp.status === 503 || resp.status === 529) {
    return { rotatable: true, cooldownMs: parseRetryAfterMs(resp) ?? 30_000, reason: `overloaded:${resp.status}` }
  }
  return { rotatable: false, reason: `status:${resp.status}` }
}

async function classifyResponse(
  adapter: { classifyResponse?: (r: Response) => Promise<RotateDecision> | RotateDecision },
  resp: Response,
): Promise<RotateDecision> {
  if (!adapter.classifyResponse) return defaultClassifyResponse(resp)
  try {
    return await adapter.classifyResponse(resp.clone())
  } catch {
    return defaultClassifyResponse(resp)
  }
}

export namespace RotatingFetch {
  export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

  export type Options = {
    providerId: string
    namespace: string
    maxAttempts?: number
  }

  export function create(
    baseFetch: FetchFn,
    opts: Options,
  ): FetchFn {
    return async (input, init) => {
      await CredentialsMigrate.migrateIfNeeded()

      const canonicalProviderId = ProviderAuthRegistry.resolveProviderId(opts.providerId)
      const adapter = ProviderAuthRegistry.getAdapter(canonicalProviderId)
      if (!adapter) return baseFetch(input, init)

      const providerIds = ProviderAuthRegistry.equivalentProviderIds(opts.providerId)
      const records = (
        await Promise.all(providerIds.map((id) => CredentialStore.findByProvider(id, opts.namespace)))
      )
        .flat()
        .filter((r) => r.meta.kind === "oauth")
      if (records.length === 0) return baseFetch(input, init)

      RotationStats.recordRequest(canonicalProviderId)

      records.sort((a, b) => {
        const aDefault = (a.meta.label ?? "") === "default"
        const bDefault = (b.meta.label ?? "") === "default"
        if (aDefault !== bDefault) return aDefault ? -1 : 1
        if (a.meta.createdAt !== b.meta.createdAt) return a.meta.createdAt - b.meta.createdAt
        return a.meta.id.localeCompare(b.meta.id)
      })

      const eligibleIds = records.map((r) => r.meta.id)
      const orderedIds = await CredentialPool.getOrderedIds(canonicalProviderId, opts.namespace, eligibleIds)

      const recordById = new Map(records.map((r) => [r.meta.id, r] as const))
      const attempted = new Set<string>()
      const refreshed = new Set<string>()
      const maxAttempts = Math.min(opts.maxAttempts ?? orderedIds.length, orderedIds.length)

      const original = new Request(input, init)
      let lastResponse: Response | undefined

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        RotationStats.recordAttempt(canonicalProviderId)

        const now = Date.now()
        const nextId = orderedIds.find((id) => {
          if (attempted.has(id)) return false
          const r = recordById.get(id)
          if (!r) return false
          if (r.meta.health.cooldownUntil && r.meta.health.cooldownUntil > now) return false
          return true
        })

        const chosenId =
          nextId ??
          orderedIds.find((id) => {
            if (attempted.has(id)) return false
            return recordById.has(id)
          })

        if (!chosenId) break
        attempted.add(chosenId)

        const record = recordById.get(chosenId)!
        const secret = await CredentialStore.decryptSecret(record)

        const request = original.clone()
        const url = new URL(request.url)
        const headers = new Headers(request.headers)
        // Avoid leaking API keys if present; subscription auth should win for this attempt.
        stripApiKeyHeaders(headers)
        adapter.prepareRequest?.({ url, headers, request, secret })
        adapter.applyAuth(headers, secret)

        const attemptRequest = buildRequestWithUrlAndHeaders(request, url, headers)
        const resp = await baseFetch(attemptRequest)
        lastResponse = resp

        let activeResp = resp
        let activeDecision = await classifyResponse(adapter, resp)

        if (activeDecision.rotatable && activeDecision.isAuthExpired) {
          if (adapter.refresh && (secret as any)?.refreshToken && !refreshed.has(chosenId)) {
            refreshed.add(chosenId)
            RotationStats.recordRefreshAttempt(canonicalProviderId)
            log.info("refreshing oauth credential", {
              providerId: opts.providerId,
              canonicalProviderId,
              namespace: opts.namespace,
              credentialId: chosenId,
              label: record.meta.label,
            })
            try {
              const nextSecret = await adapter.refresh(secret)
              await CredentialStore.updateSecret(chosenId, nextSecret)
              RotationStats.recordRefreshSuccess(canonicalProviderId)
              log.info("refreshed oauth credential", {
                providerId: opts.providerId,
                canonicalProviderId,
                namespace: opts.namespace,
                credentialId: chosenId,
                label: record.meta.label,
              })
              try {
                resp.body?.cancel()
              } catch {}

              const retryReq = original.clone()
              const retryUrl = new URL(retryReq.url)
              const retryHeaders = new Headers(retryReq.headers)
              stripApiKeyHeaders(retryHeaders)
              adapter.prepareRequest?.({ url: retryUrl, headers: retryHeaders, request: retryReq, secret: nextSecret })
              adapter.applyAuth(retryHeaders, nextSecret)
              RotationStats.recordAttempt(canonicalProviderId)
              const retryResp = await baseFetch(buildRequestWithUrlAndHeaders(retryReq, retryUrl, retryHeaders))
              lastResponse = retryResp

              const retryDecision = await classifyResponse(adapter, retryResp)
              activeResp = retryResp
              activeDecision = retryDecision

              if (!activeDecision.rotatable) {
                await CredentialStore.recordOutcome({ id: chosenId, statusCode: activeResp.status, ok: activeResp.ok })
                return activeResp
              }
            } catch {
              RotationStats.recordRefreshFailure(canonicalProviderId)
              log.warn("oauth credential refresh failed; will rotate", {
                providerId: opts.providerId,
                canonicalProviderId,
                namespace: opts.namespace,
                credentialId: chosenId,
                label: record.meta.label,
              })
              // fall through to rotate on auth failure
            }
          }
        }

        if (activeDecision.rotatable) {
          RotationStats.recordRotation(canonicalProviderId, activeDecision.reason)
          const cooldownMs =
            activeDecision.cooldownMs ??
            (activeDecision.isAuthExpired ? 5 * 60_000 : parseRetryAfterMs(activeResp) ?? 30_000)
          const cooldownUntil = Date.now() + cooldownMs
          try {
            activeResp.body?.cancel()
          } catch {}
          log.warn("rotating oauth credential", {
            providerId: opts.providerId,
            canonicalProviderId,
            namespace: opts.namespace,
            credentialId: chosenId,
            label: record.meta.label,
            status: activeResp.status,
            reason: activeDecision.reason,
            cooldownMs,
            attempt: attempt + 1,
            maxAttempts,
            path: new URL(original.url).pathname,
          })
          await CredentialStore.recordOutcome({ id: chosenId, statusCode: activeResp.status, ok: false, cooldownUntil })
          await CredentialPool.moveToBack(canonicalProviderId, opts.namespace, chosenId)
          continue
        }

        await CredentialStore.recordOutcome({ id: chosenId, statusCode: activeResp.status, ok: activeResp.ok })
        return activeResp
      }

      log.error("oauth rotation exhausted credentials", {
        providerId: opts.providerId,
        canonicalProviderId,
        namespace: opts.namespace,
        attempted: Array.from(attempted),
        maxAttempts,
      })
      RotationStats.recordExhausted(canonicalProviderId)
      return lastResponse ?? baseFetch(input, init)
    }
  }
}
