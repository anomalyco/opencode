import { BusEvent } from "@/bus/bus-event"
import { Schema, Effect, Clock, Cause, Duration } from "effect"
import * as Stream from "effect/Stream"
import * as Option from "effect/Option"
import { ProviderID, ModelID } from "@/provider/schema"
import { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import type { Err } from "./retry"
import type { Provider } from "@/provider/provider"
import type { Bus } from "@/bus"
import type * as Log from "@opencode-ai/core/util/log"

export const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000
export const DEFAULT_COOLDOWN_SECONDS = 300
export const NOTICE_REASON_MAX_LENGTH = 40
export const WAIT_CAP_MS = 30_000

export const FALLBACK_NOTICE_ID = "fallback-notice"
export const FALLBACK_RESUME_ID = "fallback-resume"
export const FALLBACK_USING_ID = "fallback-using"

export class CooldownManager {
  private store = new Map<string, number>()

  put(providerID: string, modelID: string, durationMs: number): Effect.Effect<void> {
    const key = `${providerID}/${modelID}`
    const s = this.store
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      s.set(key, now + durationMs)
    })
  }

  isCooledDown(providerID: string, modelID: string): Effect.Effect<boolean> {
    const key = `${providerID}/${modelID}`
    const s = this.store
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const expiry = s.get(key)
      if (expiry === undefined) return false
      if (now >= expiry) {
        s.delete(key)
        return false
      }
      return true
    })
  }

  remaining(providerID: string, modelID: string): Effect.Effect<number | undefined> {
    const key = `${providerID}/${modelID}`
    const s = this.store
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const expiry = s.get(key)
      if (expiry === undefined) return undefined
      const left = expiry - now
      if (left <= 0) {
        s.delete(key)
        return undefined
      }
      return left
    })
  }

  clear(providerID: string, modelID: string): void {
    this.store.delete(`${providerID}/${modelID}`)
  }
}

export const FallbackTriggered = BusEvent.define(
  "llm.fallback.triggered",
  Schema.Struct({
    sessionID: SessionID,
    modelID: ModelID,
    providerID: ProviderID,
    reason: Schema.String,
  }),
)

export const FallbackUsed = BusEvent.define(
  "llm.fallback.used",
  Schema.Struct({
    sessionID: SessionID,
    modelID: ModelID,
    providerID: ProviderID,
  }),
)

export type ChainEntry = { providerID: string; modelID: string }

export type ClassifiedError = {
  error: unknown
  isRetryable: boolean
  retryInfo: SessionRetry.Retryable | undefined
  reason: string
}

export type StreamChunk = {
  type: string
  id?: string
  text?: string
  providerMetadata?: unknown
  error?: unknown
  [key: string]: unknown
}

export type ProviderStreamResult = {
  fullStream: AsyncIterable<StreamChunk>
}

export interface FallbackDeps {
  provider: {
    getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Provider.Model, unknown>
    getProvider: (providerID: ProviderID) => Effect.Effect<Provider.Info, unknown>
  }
  bus: Bus.Interface
  config: {
    get: () => Effect.Effect<{ cooldown_seconds?: number }, unknown>
  }
  classifyError: (
    cause: Cause.Cause<unknown>,
    prevProviderID: string,
    prevModelID: string,
    cooldownSeconds: number,
  ) => ClassifiedError | null
  call: (model: Provider.Model, providerID: string, modelID: string) => Effect.Effect<ProviderStreamResult, unknown>
  log: Log.Logger
  cooldown: CooldownManager
  sessionFallbackState: SessionFallbackState
}

export type FallbackInput = {
  sessionID: string
  model: Provider.Model & { providerID: string; id: string }
  fallbacks?: Array<{ providerID: string; modelID: string }>
  abort: AbortSignal
}

export function isRetryable(error: Err, provider: string): boolean {
  return SessionRetry.retryable(error, provider) !== undefined
}

export type FallbackOnErrorsConfig = {
  patterns?: string[]
  status_codes?: number[]
}

// Resolve a user-configured override for "this error should trigger
// fallback". Returns a synthetic Retryable when the error message /
// response body matches a configured pattern, or the response status
// matches a configured status code. Returns undefined otherwise — the
// caller then falls through to SessionRetry's default heuristics.
export function matchUserFallbackConfig(
  err: { data?: { message?: string; responseBody?: string; statusCode?: number } } | undefined,
  cfgOverrides: FallbackOnErrorsConfig | undefined,
): SessionRetry.Retryable | undefined {
  if (!cfgOverrides) return undefined
  const data = err?.data
  const status = data?.statusCode
  if (status !== undefined && cfgOverrides.status_codes?.includes(status)) {
    return { message: `HTTP ${status}` }
  }
  const haystack = `${data?.message ?? ""}\n${data?.responseBody ?? ""}`
  for (const pat of cfgOverrides.patterns ?? []) {
    let hit = false
    try {
      hit = new RegExp(pat, "i").test(haystack)
    } catch {
      // invalid regex → fall back to plain substring match (case-insensitive)
      hit = haystack.toLowerCase().includes(pat.toLowerCase())
    }
    if (hit) {
      const summary = (data?.message ?? "").trim()
      return { message: summary.length > 0 ? summary.split("\n")[0] : `matched pattern: ${pat}` }
    }
  }
  return undefined
}

function noticeChunks(text: string, id: string): StreamChunk[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, text },
    { type: "text-end", id },
  ]
}

async function* filterErrors(fullStream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
  for await (const chunk of fullStream) {
    if (chunk.type === "error") {
      const err = chunk.error
      throw err instanceof Error ? err : new Error(String(err))
    }
    yield chunk
  }
}

function toStream(result: ProviderStreamResult): Stream.Stream<StreamChunk, Error> {
  return Stream.fromAsyncIterable(filterErrors(result.fullStream), (e) =>
    e instanceof Error ? e : new Error(String(e)),
  )
}

function cooldownDurationMs(error: ClassifiedError, cooldownSeconds: number): number {
  if (error.retryInfo?.quotaLimit) return QUOTA_COOLDOWN_MS
  const headers = (error.error as { data?: { responseHeaders?: Record<string, string>; statusCode?: number } })?.data
    ?.responseHeaders
  if (headers) {
    const retryAfterMs = headers["retry-after-ms"]
    if (retryAfterMs) {
      const parsed = Number.parseFloat(retryAfterMs)
      if (!Number.isNaN(parsed)) return parsed
    }
    const retryAfter = headers["retry-after"]
    if (retryAfter) {
      const parsed = Number.parseFloat(retryAfter) * 1000
      if (!Number.isNaN(parsed)) return Math.ceil(parsed)
      const dateParsed = Date.parse(retryAfter) - Date.now()
      if (!Number.isNaN(dateParsed) && dateParsed > 0) return Math.ceil(dateParsed)
    }
  }
  return cooldownSeconds * 1000
}

function truncateReason(reason: string): string {
  return reason.length > NOTICE_REASON_MAX_LENGTH ? reason.slice(0, NOTICE_REASON_MAX_LENGTH - 3) + "..." : reason
}

// Session-scoped state. A session is "on fallback" if its last successful
// stream used a fallback. We remember this across turns so that when primary
// recovers we can show "Switched back" notice. Cleared when we successfully
// return to primary.
export class SessionFallbackState {
  private flags = new Set<string>()

  isOnFallback(sessionID: string): boolean {
    return this.flags.has(sessionID)
  }

  markOnFallback(sessionID: string): void {
    this.flags.add(sessionID)
  }

  clear(sessionID: string): void {
    this.flags.delete(sessionID)
  }
}

export function withFallback(
  input: FallbackInput,
  deps: FallbackDeps,
): Effect.Effect<Stream.Stream<StreamChunk, Error>, unknown> {
  return Effect.gen(function* () {
    const cooldown = deps.cooldown
    const cfg = yield* deps.config.get()
    const cooldownSeconds = cfg.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS
    const fallbacks = input.fallbacks ?? []
    const primary: ChainEntry = { providerID: input.model.providerID, modelID: input.model.id }

    if (fallbacks.length === 0) {
      // No fallbacks configured: just return the primary stream as-is.
      const primaryResult = yield* deps.call(input.model, primary.providerID, primary.modelID)
      return toStream(primaryResult)
    }

    const wasOnFallback = deps.sessionFallbackState.isOnFallback(input.sessionID)

    const chainFallback = (
      stream: Stream.Stream<StreamChunk, Error>,
      prevEntry: ChainEntry,
      entry: ChainEntry,
    ): Stream.Stream<StreamChunk, Error> => {
      const el = deps.log.clone().tag("providerID", entry.providerID).tag("modelID", entry.modelID)
      return stream.pipe(
        Stream.catchCause((cause) =>
          Stream.unwrap(
            Effect.gen(function* () {
              if (input.abort.aborted) return yield* Effect.fail(new Error("Request aborted"))

              if (yield* cooldown.isCooledDown(entry.providerID, entry.modelID)) {
                el.info("skipping cooled-down fallback")
                return yield* Effect.failCause(cause)
              }

              const resolved = yield* deps.provider
                .getModel(ProviderID.make(entry.providerID), ModelID.make(entry.modelID))
                .pipe(Effect.option)
              if (Option.isNone(resolved)) {
                el.info("fallback model not found, skipping")
                return yield* Effect.failCause(cause)
              }
              const model = resolved.value

              const classified = deps.classifyError(cause, prevEntry.providerID, prevEntry.modelID, cooldownSeconds)
              if (!classified) {
                el.info("non-retryable error, not falling back")
                return yield* Effect.failCause(cause)
              }

              const durationMs = cooldownDurationMs(classified, cooldownSeconds)
              yield* cooldown.put(prevEntry.providerID, prevEntry.modelID, durationMs)
              el.info("stream error, falling back", { cooldownMs: durationMs })

              yield* deps.bus.publish(FallbackTriggered, {
                sessionID: SessionID.make(input.sessionID),
                modelID: ModelID.make(prevEntry.modelID),
                providerID: ProviderID.make(prevEntry.providerID),
                reason: classified.reason,
              })

              deps.sessionFallbackState.markOnFallback(input.sessionID)
              yield* deps.bus.publish(FallbackUsed, {
                sessionID: SessionID.make(input.sessionID),
                modelID: ModelID.make(entry.modelID),
                providerID: ProviderID.make(entry.providerID),
              })

              const providerInfo = yield* deps.provider
                .getProvider(ProviderID.make(entry.providerID))
                .pipe(Effect.option)
              const providerName = Option.isSome(providerInfo) ? providerInfo.value.name : entry.providerID
              const reason = truncateReason(classified.reason)
              const notice = `~> Switching to ${model.name} (${providerName})${reason ? ` — ${reason}` : ""}`

              const fallbackResult = yield* deps.call(model, entry.providerID, entry.modelID)
              const fallbackStream = toStream(fallbackResult)
              // Inject text-end for the in-progress text part before the notice
              // so the previous (errored) text part is cleanly closed in the UI.
              return Stream.concat(Stream.fromIterable(noticeChunks(notice, FALLBACK_NOTICE_ID)), fallbackStream)
            }),
          ),
        ),
      )
    }

    // Build the chain: primary first, then fallbacks in order.
    const chain: Array<ChainEntry> = [primary, ...fallbacks]

    // Determine starting entry: first chain element that is not on cooldown.
    let startIdx = 0
    for (let i = 0; i < chain.length; i++) {
      if (!(yield* cooldown.isCooledDown(chain[i].providerID, chain[i].modelID))) {
        startIdx = i
        break
      }
      // If every entry is on cooldown the loop falls through with startIdx === 0;
      // we still try primary (after a bounded wait below) so user gets a clear
      // error rather than an indefinite hang.
      if (i === chain.length - 1) startIdx = 0
    }

    // If every entry is on cooldown, sleep up to WAIT_CAP_MS for the soonest
    // entry to come back, then proceed with whichever model is now available.
    if (startIdx === 0 && (yield* cooldown.isCooledDown(primary.providerID, primary.modelID))) {
      let soonest = Infinity
      for (const e of chain) {
        const r = (yield* cooldown.remaining(e.providerID, e.modelID)) ?? Infinity
        if (r < soonest) soonest = r
      }
      const sleepMs = Math.min(soonest, WAIT_CAP_MS)
      if (Number.isFinite(sleepMs) && sleepMs > 0) {
        deps.log.info("all models on cooldown, waiting", { sleepMs })
        yield* Effect.sleep(Duration.millis(sleepMs))
      }
      // Re-evaluate startIdx after sleep.
      for (let i = 0; i < chain.length; i++) {
        if (!(yield* cooldown.isCooledDown(chain[i].providerID, chain[i].modelID))) {
          startIdx = i
          break
        }
      }
    }

    // Resolve the starting model. If the chosen entry's model is somehow
    // unresolvable, skip ahead to the next resolvable one.
    let resolvedIdx = startIdx
    let resolvedModel: Option.Option<Provider.Model> = Option.none()
    for (let i = startIdx; i < chain.length; i++) {
      const e = chain[i]
      const candidate = yield* deps.provider
        .getModel(ProviderID.make(e.providerID), ModelID.make(e.modelID))
        .pipe(Effect.option)
      if (Option.isSome(candidate)) {
        resolvedIdx = i
        resolvedModel = candidate
        break
      }
    }
    if (Option.isNone(resolvedModel)) {
      deps.log.warn("no models resolvable, attempting primary as last resort")
      cooldown.clear(primary.providerID, primary.modelID)
      const primaryResult = yield* deps.call(input.model, primary.providerID, primary.modelID)
      return toStream(primaryResult)
    }

    const startEntry = chain[resolvedIdx]
    const startModel = resolvedIdx === 0 ? input.model : resolvedModel.value
    const startResult = yield* deps.call(startModel, startEntry.providerID, startEntry.modelID)
    let stream: Stream.Stream<StreamChunk, Error> = toStream(startResult)

    if (resolvedIdx === 0) {
      // We are starting on primary. If we were previously on a fallback in
      // this session, surface a resume notice and clear the flag.
      if (wasOnFallback) {
        const providerInfo = yield* deps.provider.getProvider(ProviderID.make(primary.providerID)).pipe(Effect.option)
        const providerName = Option.isSome(providerInfo) ? providerInfo.value.name : primary.providerID
        const notice = `~> Switched back to ${input.model.name} (${providerName})`
        stream = Stream.concat(Stream.fromIterable(noticeChunks(notice, FALLBACK_RESUME_ID)), stream)
        deps.sessionFallbackState.clear(input.sessionID)
        // Publish FallbackUsed pointing back to primary so the processor
        // updates the assistant message model field.
        yield* deps.bus.publish(FallbackUsed, {
          sessionID: SessionID.make(input.sessionID),
          modelID: ModelID.make(primary.modelID),
          providerID: ProviderID.make(primary.providerID),
        })
      }
    } else {
      // Cold-start on a fallback. Mark session as on fallback and emit
      // FallbackUsed so the assistant message picks up the right model.
      deps.sessionFallbackState.markOnFallback(input.sessionID)
      yield* deps.bus.publish(FallbackUsed, {
        sessionID: SessionID.make(input.sessionID),
        modelID: ModelID.make(startEntry.modelID),
        providerID: ProviderID.make(startEntry.providerID),
      })
      // Show a muted "using" notice so the user sees why we didn't start on
      // primary. No FallbackTriggered toast: this is a cooldown-recovery
      // start, not a fresh failure.
      const providerInfo = yield* deps.provider
        .getProvider(ProviderID.make(startEntry.providerID))
        .pipe(Effect.option)
      const providerName = Option.isSome(providerInfo) ? providerInfo.value.name : startEntry.providerID
      const notice = `~> Using ${startModel.name} (${providerName}) while ${input.model.name} is cooling down`
      stream = Stream.concat(Stream.fromIterable(noticeChunks(notice, FALLBACK_USING_ID)), stream)
    }

    // Wrap with chainFallback for every entry after the start.
    for (let i = resolvedIdx + 1; i < chain.length; i++) {
      stream = chainFallback(stream, chain[i - 1], chain[i])
    }

    return stream
  })
}
