import { Auth } from "./index"
import { withOAuthRecord } from "./context"
import { CredentialManager } from "./credential-manager"
import { Log } from "../util/log"

const log = Log.create({ service: "rotating-fetch" })

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000
const DEFAULT_AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000
const DEFAULT_NETWORK_RETRY_ATTEMPTS = 1

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
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
])
const NETWORK_ERROR_NAMES = new Set(["AbortError", "TimeoutError", "FetchError"])

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function extractErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const name = (error as { name?: unknown }).name
  return typeof name === "string" ? name : undefined
}

function extractErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const message = (error as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

function isNetworkError(error: unknown): boolean {
  const directCode = extractErrorCode(error)
  const cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined
  const causeCode = extractErrorCode(cause)
  const code = directCode ?? causeCode
  if (code && NETWORK_ERROR_CODES.has(code)) return true

  const name = extractErrorName(error)
  if (name && NETWORK_ERROR_NAMES.has(name)) return true

  const message = extractErrorMessage(error)?.toLowerCase()
  if (!message) return false
  return message.includes("fetch failed") || message.includes("network error") || message.includes("network down")
}

function isAuthExpiredStatus(status: number): boolean {
  return status === 401 || status === 403
}

/**
 * Attempt to refresh tokens via browser session.
 * Returns true if successful and tokens were updated.
 */
async function attemptBrowserRelogin(providerID: string, recordID: string, namespace: string): Promise<boolean> {
  try {
    const { AuthBrowser } = await import("./browser")

    const session = await AuthBrowser.status(recordID)
    if (!session.isConfigured) {
      log.info("no browser session configured for auto-relogin", { providerID, recordID })
      return false
    }

    log.info("attempting auto-relogin via browser session", { providerID, recordID })

    // Show toast notification
    const { Bus } = await import("../bus")
    const { TuiEvent } = await import("../cli/cmd/tui/event")
    await Bus.publish(TuiEvent.ToastShow, {
      title: "Auto-Relogin",
      message: "Token expired. Attempting automatic refresh...",
      variant: "info",
      duration: 5000,
    }).catch(() => {})

    const tokens = await AuthBrowser.refresh(recordID)

    // Update the auth store with new tokens
    await Auth.OAuthPool.updateRecord(providerID, recordID, namespace, {
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
    })

    log.info("auto-relogin successful", { providerID, recordID })

    await Bus.publish(TuiEvent.ToastShow, {
      title: "Auto-Relogin",
      message: "Token refreshed successfully!",
      variant: "success",
      duration: 3000,
    }).catch(() => {})

    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn("auto-relogin failed", { providerID, recordID, error: message })

    // Show failure toast
    try {
      const { Bus } = await import("../bus")
      const { TuiEvent } = await import("../cli/cmd/tui/event")
      await Bus.publish(TuiEvent.ToastShow, {
        title: "Auto-Relogin Failed",
        message: "Please run 'opencode auth browser setup' to re-authenticate.",
        variant: "error",
        duration: 10000,
      }).catch(() => {})
    } catch {}

    return false
  }
}

export function createOAuthRotatingFetch<TFetch extends (input: any, init?: any) => Promise<Response>>(
  fetchFn: TFetch,
  opts: {
    providerID: string
    namespace?: string
    maxAttempts?: number
    rateLimitCooldownMs?: number
    authFailureCooldownMs?: number
    networkRetryAttempts?: number
    toastDurationMs?: number
  },
): TFetch {
  const namespace = (opts.namespace ?? "default").trim() || "default"

  return (async (input: any, init?: any) => {
    const { records, orderedIDs, activeID } = await Auth.OAuthPool.snapshot(opts.providerID, namespace)
    if (records.length === 0) return fetchFn(input, init)

    const recordByID = new Map(records.map((record) => [record.id, record]))
    // Prefer activeID first, then follow the order
    const candidates =
      activeID && recordByID.has(activeID)
        ? [activeID, ...orderedIDs.filter((id) => id !== activeID && recordByID.has(id))]
        : orderedIDs.filter((id) => recordByID.has(id))
    if (candidates.length === 0) return fetchFn(input, init)
    const inputIsRequest = isRequest(input)
    let allowRetry =
      isReplayableBody(init?.body) && (!inputIsRequest || (!input.bodyUsed && !isReadableStream(input.body)))

    const rateLimitCooldownMs = opts.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    const authFailureCooldownMs = opts.authFailureCooldownMs ?? DEFAULT_AUTH_FAILURE_COOLDOWN_MS
    const configuredNetworkRetryAttempts = Math.max(0, opts.networkRetryAttempts ?? DEFAULT_NETWORK_RETRY_ATTEMPTS)
    const maxAttemptBudget = opts.maxAttempts ?? candidates.length
    let maxAttempts = Math.max(1, maxAttemptBudget)
    if (!allowRetry) {
      maxAttempts = 1
    } else if (maxAttempts > candidates.length) {
      maxAttempts = candidates.length
    }

    const attempted = new Set<string>()
    const refreshed = new Set<string>()
    let lastError: unknown

    const pickNextCandidate = (now: number) =>
      candidates.find((id) => {
        if (attempted.has(id)) return false
        const cooldownUntil = recordByID.get(id)?.health.cooldownUntil
        return !cooldownUntil || cooldownUntil <= now
      }) ?? candidates.find((id) => !attempted.has(id))

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const now = Date.now()

      const nextID = pickNextCandidate(now)

      if (!nextID) break
      attempted.add(nextID)

      const hasMoreAttempts = () => attempt + 1 < maxAttempts
      let networkRetryAttempts = allowRetry ? configuredNetworkRetryAttempts : 0

      const runWithNetworkRetry = async (): Promise<Response> => {
        for (let networkAttempt = 0; ; networkAttempt++) {
          let attemptInput = input
          if (inputIsRequest && allowRetry) {
            try {
              attemptInput = input.clone()
            } catch (e) {
              lastError = e
              allowRetry = false
              networkRetryAttempts = 0
              maxAttempts = attempt + 1
            }
          }

          try {
            return await withOAuthRecord(opts.providerID, nextID, () => fetchFn(attemptInput, init))
          } catch (e) {
            lastError = e

            // Check if this is a token refresh failure - attempt auto-relogin (only once per account)
            const errorMessage = e instanceof Error ? e.message : String(e)
            if (
              errorMessage.includes("Token refresh failed") &&
              opts.providerID === "anthropic" &&
              !refreshed.has(nextID) // Prevent infinite relogin attempts
            ) {
              refreshed.add(nextID) // Mark as attempted

              log.info("token refresh failed, attempting auto-relogin", {
                providerID: opts.providerID,
                recordID: nextID,
              })

              const reloginSuccess = await attemptBrowserRelogin(opts.providerID, nextID, namespace)
              if (reloginSuccess) {
                log.info("auto-relogin successful, retrying request", { providerID: opts.providerID, recordID: nextID })
                // Retry with same account after successful relogin
                continue
              }
            }

            await Auth.OAuthPool.recordOutcome({
              providerID: opts.providerID,
              recordID: nextID,
              statusCode: 0,
              ok: false,
            })
            const networkError = isNetworkError(e)
            if (networkError && allowRetry && networkAttempt < networkRetryAttempts) {
              continue
            }
            throw e
          }
        }
      }
      const notifyFailover = async (statusCode: number) => {
        const candidate = pickNextCandidate(Date.now())
        if (!candidate) return
        await CredentialManager.notifyFailover({
          providerID: opts.providerID,
          fromRecordID: nextID,
          toRecordID: candidate,
          statusCode,
          toastDurationMs: opts.toastDurationMs,
        })
      }

      let response: Response
      try {
        response = await runWithNetworkRetry()
      } catch (e) {
        if (isNetworkError(e)) throw e

        await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
        await notifyFailover(0)
        if (!hasMoreAttempts()) throw e
        continue
      }

      if (response.ok) {
        await Auth.OAuthPool.recordOutcome({
          providerID: opts.providerID,
          recordID: nextID,
          statusCode: response.status,
          ok: true,
        })
        return response
      }

      if (response.status === 429) {
        const cooldownMs = parseRetryAfterMs(response) ?? rateLimitCooldownMs
        await Auth.OAuthPool.recordOutcome({
          providerID: opts.providerID,
          recordID: nextID,
          statusCode: response.status,
          ok: false,
          cooldownUntil: Date.now() + cooldownMs,
        })
        await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
        await notifyFailover(response.status)
        if (!hasMoreAttempts()) return response
        await drainResponse(response)
        continue
      }

      if (isAuthExpiredStatus(response.status) && !refreshed.has(nextID)) {
        refreshed.add(nextID)

        await Auth.OAuthPool.markAccessExpired(opts.providerID, namespace, nextID)
        if (!allowRetry) {
          const cooldownUntil = Date.now() + authFailureCooldownMs
          await Auth.OAuthPool.recordOutcome({
            providerID: opts.providerID,
            recordID: nextID,
            statusCode: response.status,
            ok: false,
            cooldownUntil,
          })
          await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
          await notifyFailover(response.status)
          return response
        }

        await drainResponse(response)

        try {
          const retry = await runWithNetworkRetry()
          if (retry.ok) {
            await Auth.OAuthPool.recordOutcome({
              providerID: opts.providerID,
              recordID: nextID,
              statusCode: retry.status,
              ok: true,
            })
            return retry
          }

          if (retry.status === 429) {
            const cooldownMs = parseRetryAfterMs(retry) ?? rateLimitCooldownMs
            await Auth.OAuthPool.recordOutcome({
              providerID: opts.providerID,
              recordID: nextID,
              statusCode: retry.status,
              ok: false,
              cooldownUntil: Date.now() + cooldownMs,
            })
            await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
            await notifyFailover(retry.status)
            if (!hasMoreAttempts()) return retry
            await drainResponse(retry)
            continue
          }

          const cooldownUntil = Date.now() + authFailureCooldownMs
          await Auth.OAuthPool.recordOutcome({
            providerID: opts.providerID,
            recordID: nextID,
            statusCode: retry.status,
            ok: false,
            cooldownUntil,
          })
          await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
          await notifyFailover(retry.status)
          if (!hasMoreAttempts()) return retry
          await drainResponse(retry)
          continue
        } catch (e) {
          if (isNetworkError(e)) throw e
          await notifyFailover(0)
          if (!hasMoreAttempts()) throw e
        }

        await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
        continue
      }

      await Auth.OAuthPool.recordOutcome({
        providerID: opts.providerID,
        recordID: nextID,
        statusCode: response.status,
        ok: false,
      })
      await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
      await notifyFailover(response.status)
      if (!hasMoreAttempts()) return response
      await drainResponse(response)
      continue
    }

    if (lastError) throw lastError
    return fetchFn(input, init)
  }) as TFetch
}
