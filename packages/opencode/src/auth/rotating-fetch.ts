import { Auth } from "./index"
import { withOAuthRecord } from "./context"
import { CredentialManager } from "./credential-manager"

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30_000
const DEFAULT_AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000

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

function isAuthExpiredStatus(status: number): boolean {
  return status === 401 || status === 403
}

export function createOAuthRotatingFetch<TFetch extends (input: any, init?: any) => Promise<Response>>(
  fetchFn: TFetch,
  opts: {
    providerID: string
    namespace?: string
    maxAttempts?: number
    rateLimitCooldownMs?: number
    authFailureCooldownMs?: number
    toastDurationMs?: number
  },
): TFetch {
  const namespace = (opts.namespace ?? "default").trim() || "default"

  return (async (input: any, init?: any) => {
    const { records, orderedIDs } = await Auth.OAuthPool.snapshot(opts.providerID, namespace)
    if (records.length === 0) return fetchFn(input, init)

    const recordByID = new Map(records.map((record) => [record.id, record]))
    const candidates = orderedIDs.filter((id) => recordByID.has(id))
    if (candidates.length === 0) return fetchFn(input, init)
    const inputIsRequest = isRequest(input)
    let allowRetry =
      isReplayableBody(init?.body) && (!inputIsRequest || (!input.bodyUsed && !isReadableStream(input.body)))

    const rateLimitCooldownMs = opts.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    const authFailureCooldownMs = opts.authFailureCooldownMs ?? DEFAULT_AUTH_FAILURE_COOLDOWN_MS
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

      let attemptInput = input
      if (inputIsRequest && allowRetry) {
        try {
          attemptInput = input.clone()
        } catch (e) {
          lastError = e
          allowRetry = false
          maxAttempts = attempt + 1
        }
      }

      const hasMoreAttempts = attempt + 1 < maxAttempts

      const run = () => withOAuthRecord(opts.providerID, nextID, () => fetchFn(attemptInput, init))
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
        response = await run()
      } catch (e) {
        lastError = e
        await Auth.OAuthPool.recordOutcome({
          providerID: opts.providerID,
          recordID: nextID,
          statusCode: 0,
          ok: false,
        })
        await Auth.OAuthPool.moveToBack(opts.providerID, namespace, nextID)
        await notifyFailover(0)
        if (!hasMoreAttempts) throw e
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
        if (!hasMoreAttempts) return response
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
          const retry = await run()
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
            if (!hasMoreAttempts) return retry
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
          if (!hasMoreAttempts) return retry
          await drainResponse(retry)
          continue
        } catch (e) {
          lastError = e
          await Auth.OAuthPool.recordOutcome({
            providerID: opts.providerID,
            recordID: nextID,
            statusCode: 0,
            ok: false,
          })
          await notifyFailover(0)
          if (!hasMoreAttempts) throw e
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
      return response
    }

    if (lastError) throw lastError
    return fetchFn(input, init)
  }) as TFetch
}
