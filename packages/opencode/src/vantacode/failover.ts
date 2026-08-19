/**
 * Multi-API-key / multi-provider failover (VantaCode spec 3.6).
 *
 * Supports multiple keys per provider and/or multiple providers. On a failure
 * that signals quota / rate-limit / auth trouble, it retries with the next
 * candidate (key or provider) after a short backoff. Keys are never printed in
 * full — they are masked to first/last 4 chars in all logs.
 *
 * Dependency-free and generic over the "attempt" function so it can wrap either
 * the native-Ollama client or the AI-SDK provider path.
 */

export interface FailoverCandidate<Ctx> {
  /** Stable id for logging (e.g. "openai#1", "anthropic", "ollama"). */
  readonly id: string
  /** Provider id this candidate belongs to. */
  readonly provider: string
  /** The secret used for this candidate, if any (masked before logging). */
  readonly secret?: string
  /** Opaque context handed to the attempt fn (base URL, model, sdk handle...). */
  readonly context: Ctx
}

export interface FailoverOptions {
  /** Base backoff in ms; grows exponentially per attempt. Default 500. */
  readonly baseBackoffMs?: number
  /** Max backoff in ms. Default 8000. */
  readonly maxBackoffMs?: number
  /** Called for every attempt outcome; use for local per-request logging. */
  readonly onAttempt?: (event: FailoverEvent) => void
  /** Sleep impl (injectable for tests). */
  readonly sleep?: (ms: number) => Promise<void>
}

export interface FailoverEvent {
  readonly candidateId: string
  readonly provider: string
  readonly maskedSecret?: string
  readonly outcome: "success" | "retryable" | "fatal"
  readonly status?: number
  readonly message?: string
  readonly attempt: number
}

/** Mask a secret to first/last 4 chars: `sk-a...z9x1`. Never logs the middle. */
export function maskSecret(secret?: string): string | undefined {
  if (!secret) return undefined
  if (secret.length <= 8) return "****"
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}

/** Retryable HTTP statuses that should trigger failover to the next candidate. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

const QUOTA_HINTS = [
  "insufficient_quota",
  "insufficient quota",
  "rate limit",
  "rate_limit",
  "quota",
  "overloaded",
  "capacity",
  "too many requests",
  "billing",
]

/**
 * Classify an error/response as retryable (failover) vs fatal.
 * Accepts a loosely-typed error to work across fetch/SDK failure shapes.
 */
export function isRetryable(error: unknown): { retryable: boolean; status?: number; message: string } {
  const anyErr = error as { status?: number; statusCode?: number; message?: unknown; responseBody?: unknown }
  const status = typeof anyErr?.status === "number" ? anyErr.status : anyErr?.statusCode
  const message = typeof anyErr?.message === "string" ? anyErr.message : String(error)
  const haystack = `${message} ${typeof anyErr?.responseBody === "string" ? anyErr.responseBody : ""}`.toLowerCase()

  if (typeof status === "number") {
    // 401/403 -> the key is dead; failover to the next key/provider.
    if (status === 401 || status === 403) return { retryable: true, status, message }
    if (RETRYABLE_STATUS.has(status)) return { retryable: true, status, message }
    // Other 4xx (400, 404, 422) are request problems, not key/provider problems.
    if (status >= 400 && status < 500) return { retryable: false, status, message }
  }

  if (QUOTA_HINTS.some((hint) => haystack.includes(hint))) return { retryable: true, status, message }
  // Network-ish errors are retryable across candidates.
  if (/fetch failed|network|timeout|econnrefused|socket|aborted/i.test(haystack)) {
    return { retryable: true, status, message }
  }
  return { retryable: false, status, message }
}

export class AllCandidatesFailedError extends Error {
  readonly attempts: FailoverEvent[]
  constructor(attempts: FailoverEvent[], lastMessage: string) {
    super(`All ${attempts.length} provider candidate(s) failed. Last error: ${lastMessage}`)
    this.name = "AllCandidatesFailedError"
    this.attempts = attempts
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Try each candidate in order until one succeeds. Retryable failures advance to
 * the next candidate with exponential backoff; fatal failures stop early and
 * rethrow so genuine request bugs surface immediately.
 */
export async function runWithFailover<Ctx, Result>(
  candidates: ReadonlyArray<FailoverCandidate<Ctx>>,
  attempt: (candidate: FailoverCandidate<Ctx>) => Promise<Result>,
  options: FailoverOptions = {},
): Promise<{ result: Result; candidate: FailoverCandidate<Ctx>; events: FailoverEvent[] }> {
  if (candidates.length === 0) throw new Error("runWithFailover: no candidates provided")
  const baseBackoff = options.baseBackoffMs ?? 500
  const maxBackoff = options.maxBackoffMs ?? 8_000
  const sleep = options.sleep ?? defaultSleep
  const events: FailoverEvent[] = []

  let lastMessage = "unknown"
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const result = await attempt(candidate)
      const event: FailoverEvent = {
        candidateId: candidate.id,
        provider: candidate.provider,
        maskedSecret: maskSecret(candidate.secret),
        outcome: "success",
        attempt: i + 1,
      }
      events.push(event)
      options.onAttempt?.(event)
      return { result, candidate, events }
    } catch (error) {
      const classified = isRetryable(error)
      lastMessage = classified.message
      const event: FailoverEvent = {
        candidateId: candidate.id,
        provider: candidate.provider,
        maskedSecret: maskSecret(candidate.secret),
        outcome: classified.retryable ? "retryable" : "fatal",
        status: classified.status,
        message: classified.message,
        attempt: i + 1,
      }
      events.push(event)
      options.onAttempt?.(event)
      if (!classified.retryable) throw error
      const isLast = i === candidates.length - 1
      if (!isLast) {
        const backoff = Math.min(maxBackoff, baseBackoff * 2 ** i)
        await sleep(backoff)
      }
    }
  }
  throw new AllCandidatesFailedError(events, lastMessage)
}

/**
 * Race mode (nice-to-have): fire the same attempt at up to `max` candidates and
 * resolve with whichever finishes first. Losers are ignored. Rejects with the
 * last error if every racer fails.
 */
export async function runWithRace<Ctx, Result>(
  candidates: ReadonlyArray<FailoverCandidate<Ctx>>,
  attempt: (candidate: FailoverCandidate<Ctx>) => Promise<Result>,
  max = 2,
): Promise<{ result: Result; candidate: FailoverCandidate<Ctx> }> {
  const racers = candidates.slice(0, Math.max(1, max))
  const errors: unknown[] = []
  return new Promise((resolve, reject) => {
    let settled = false
    let remaining = racers.length
    for (const candidate of racers) {
      attempt(candidate).then(
        (result) => {
          if (settled) return
          settled = true
          resolve({ result, candidate })
        },
        (error) => {
          errors.push(error)
          remaining -= 1
          if (remaining === 0 && !settled) reject(errors[errors.length - 1])
        },
      )
    }
  })
}

/** Build failover candidates from a provider->keys map (order preserved). */
export function candidatesFromKeys<Ctx>(
  providers: ReadonlyArray<{ provider: string; keys: string[]; context: (key: string) => Ctx }>,
): FailoverCandidate<Ctx>[] {
  return providers.flatMap((entry) =>
    entry.keys.map((key, index) => ({
      id: `${entry.provider}#${index + 1}`,
      provider: entry.provider,
      secret: key,
      context: entry.context(key),
    })),
  )
}
