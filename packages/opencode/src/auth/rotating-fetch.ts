import { Auth } from "./index"
import { withOAuthRecord, getOAuthRecordID } from "./context"
import { CredentialManager } from "./credential-manager"
import { Log } from "../util/log"

const log = Log.create({ service: "rotating-fetch" })

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000
const DEFAULT_AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000
const DEFAULT_NETWORK_RETRY_ATTEMPTS = 1

type OAuthProviderRecord = {
  id: string
  namespace: string
  label?: string
  accountId?: string
  enterpriseUrl?: string
  refresh: string
  access: string
  expires: number
  createdAt: number
  updatedAt: number
  health: {
    cooldownUntil?: number
    lastStatusCode?: number
    lastErrorAt?: number
    successCount: number
    failureCount: number
  }
}

function summarizeRecord(record: OAuthProviderRecord) {
  return {
    id: record.id,
    label: record.label,
    accountId: record.accountId,
    lastStatusCode: record.health.lastStatusCode,
    cooldownUntil: record.health.cooldownUntil,
    successCount: record.health.successCount,
    failureCount: record.health.failureCount,
  }
}

function summarizeResponseHeaders(response: Response) {
  const keys = [
    "retry-after",
    "x-request-id",
    "x-oai-request-id",
    "x-codex-plan-type",
    "x-codex-active-limit",
    "x-codex-primary-used-percent",
    "x-codex-primary-reset-at",
    "x-codex-primary-reset-after-seconds",
    "x-codex-secondary-used-percent",
    "x-codex-secondary-reset-at",
    "x-codex-secondary-reset-after-seconds",
    "x-codex-credits-has-credits",
    "x-codex-credits-unlimited",
  ]
  const summary: Record<string, string> = {}
  for (const key of keys) {
    const value = response.headers.get(key) ?? response.headers.get(key.toUpperCase())
    if (value) summary[key] = value
  }
  return summary
}

function isReadableStream(value: unknown): value is ReadableStream {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

function isReplayableBody(body: unknown): boolean {
  if (!body) return true
  if (isReadableStream(body)) return false
  if (isAsyncIterable(body)) return false
  return true
}

function isRequest(value: unknown): value is Request {
  return typeof Request !== "undefined" && value instanceof Request
}

async function drainResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {}
}

function parseRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after") ?? response.headers.get("Retry-After")
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000

  const dateMs = Date.parse(value)
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())

  return undefined
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ECONNRABORT",
  "EPIPE",
])

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    if ("code" in error && typeof error.code === "string" && NETWORK_ERROR_CODES.has(error.code)) {
      return true
    }
    if (error.message.includes("fetch failed")) return true
  }
  return false
}

export interface RotatingFetchOptions {
  providerID: string
  cooldownMs?: number
  authFailureCooldownMs?: number
  maxAttempts?: number
  onHealthUpdate?: (recordID: string, health: OAuthProviderRecord["health"]) => void
}

function getCooldownMs(statusCode: number, retryAfterMs: number | undefined, defaultCooldown: number): number {
  if (statusCode === 429) {
    return retryAfterMs ?? defaultCooldown
  }
  if (statusCode === 403 || statusCode === 401) {
    return DEFAULT_AUTH_FAILURE_COOLDOWN_MS
  }
  return defaultCooldown
}

export async function rotatingFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: RotatingFetchOptions,
): Promise<Response> {
  const {
    providerID,
    cooldownMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    authFailureCooldownMs = DEFAULT_AUTH_FAILURE_COOLDOWN_MS,
    maxAttempts = DEFAULT_NETWORK_RETRY_ATTEMPTS,
    onHealthUpdate,
  } = options

  const records = await Auth.getOAuthRecords(providerID)
  if (!records.length) {
    return fetch(input, init)
  }

  const activeRecordID = await Auth.getActiveOAuthRecord(providerID)
  const recordQueue = rotateOrder(records, activeRecordID)

  for (const record of recordQueue) {
    if (record.health.cooldownUntil && Date.now() < record.health.cooldownUntil) {
      continue
    }

    const recordID = record.id
    log.debug("rotating-fetch attempt", {
      providerID,
      recordID,
      label: record.label,
      attemptCount: recordQueue.indexOf(record) + 1,
    })

    let response: Response
    let bodyReplayable = true

    // For OAuth, SDK adds Authorization header via apiKey, so we don't add another one
    // But we still track which record was used via withOAuthRecord for health updates
    try {
      response = await withOAuthRecord(providerID, recordID, () => fetch(input, init))
      bodyReplayable = isReplayableBody(response.body)
    } catch (error) {
      if (isNetworkError(error)) {
        log.debug("rotating-fetch network error", { providerID, recordID, error })
        await Auth.updateOAuthRecordHealth(providerID, recordID, {
          lastErrorAt: Date.now(),
          lastStatusCode: 0,
        })
        onHealthUpdate?.(recordID, (await Auth.getOAuthRecord(providerID, recordID))?.health ?? record.health)
        continue
      }
      throw error
    }

    const responseHeaders = summarizeResponseHeaders(response)
    log.debug("rotating-fetch response", {
      providerID,
      recordID,
      status: response.status,
      headers: responseHeaders,
    })

    if (response.ok) {
      await Auth.updateOAuthRecordHealth(providerID, recordID, {
        lastStatusCode: response.status,
        lastErrorAt: undefined,
        cooldownUntil: undefined,
        successCount: record.health.successCount + 1,
      })
      onHealthUpdate?.(recordID, (await Auth.getOAuthRecord(providerID, recordID))?.health ?? record.health)

      await Auth.setActiveOAuthRecord(providerID, recordID)
      return response
    }

    const retryAfterMs = parseRetryAfterMs(response)
    const isRetriable =
      response.status === 429 || response.status === 403 || response.status === 401 || response.status >= 500

    if (!isRetriable || !bodyReplayable) {
      if (bodyReplayable) await drainResponse(response)
      return response
    }

    const cooldown = getCooldownMs(
      response.status,
      retryAfterMs,
      response.status === 429 ? cooldownMs : authFailureCooldownMs,
    )

    await Auth.updateOAuthRecordHealth(providerID, recordID, {
      lastStatusCode: response.status,
      lastErrorAt: Date.now(),
      cooldownUntil: Date.now() + cooldown,
      failureCount: record.health.failureCount + 1,
    })
    onHealthUpdate?.(recordID, (await Auth.getOAuthRecord(providerID, recordID))?.health ?? record.health)

    await CredentialManager.notifyFailover({
      providerID,
      fromRecordID: recordID,
      statusCode: response.status,
    })

    if (recordQueue.indexOf(record) < recordQueue.length - 1) {
      await drainResponse(response)
    }
  }

  log.warn("rotating-fetch all records exhausted", { providerID })
  return withOAuthRecord(providerID, recordQueue[0].id, () => fetch(input, init))
}

function rotateOrder(records: OAuthProviderRecord[], activeID: string | undefined): OAuthProviderRecord[] {
  if (!activeID) return records

  const activeIndex = records.findIndex((r) => r.id === activeID)
  if (activeIndex <= 0) return records

  return [...records.slice(activeIndex), ...records.slice(0, activeIndex)]
}
