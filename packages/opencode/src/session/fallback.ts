import { EventV2 } from "@opencode-ai/core/event"
import { Schema, Effect, Option, Cause } from "effect"
import * as Stream from "effect/Stream"
import type { LLMEvent } from "@opencode-ai/llm"
import { ProviderID, ModelID } from "@/provider/schema"
import { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import type { Err } from "./retry"
import { MessageV2 } from "./message-v2"
import type { ProviderResult } from "./llm-call"
import { toStream } from "./llm-call"
import type { Provider } from "@/provider/provider"
import type { Config } from "@/config/config"
import type { EventV2Bridge } from "@/event-v2-bridge"

export class CooldownManager {
  private store = new Map<string, number>()

  private key(providerID: string, modelID: string): string {
    return `${providerID}/${modelID}`
  }

  put(providerID: string, modelID: string, durationMs: number): void {
    this.store.set(this.key(providerID, modelID), Date.now() + durationMs)
  }

  isCooledDown(providerID: string, modelID: string): boolean {
    const k = this.key(providerID, modelID)
    const expiry = this.store.get(k)
    if (expiry === undefined) return false
    if (Date.now() >= expiry) {
      this.store.delete(k)
      return false
    }
    return true
  }

  remaining(providerID: string, modelID: string): number | undefined {
    const k = this.key(providerID, modelID)
    const expiry = this.store.get(k)
    if (expiry === undefined) return undefined
    const left = expiry - Date.now()
    if (left <= 0) {
      this.store.delete(k)
      return undefined
    }
    return left
  }

  clear(providerID: string, modelID: string): void {
    this.store.delete(this.key(providerID, modelID))
  }
}

export type ChainEntry = { providerID: string; modelID: string }

export type StartDecision =
  | { kind: "primary" }
  | { kind: "fallback"; index: number }
  | { kind: "soonest"; index: number }

export function pickStart(
  primary: ChainEntry,
  fallbacks: Array<ChainEntry>,
  cooldown: { isCooledDown(providerID: string, modelID: string): boolean; remaining(providerID: string, modelID: string): number | undefined },
): StartDecision {
  if (!cooldown.isCooledDown(primary.providerID, primary.modelID)) {
    return { kind: "primary" }
  }

  const availableIndex = fallbacks.findIndex(
    (f) => !cooldown.isCooledDown(f.providerID, f.modelID),
  )
  if (availableIndex !== -1) {
    return { kind: "fallback", index: availableIndex }
  }

  let bestIndex = -1
  let bestRemaining = cooldown.remaining(primary.providerID, primary.modelID) ?? Infinity
  for (let i = 0; i < fallbacks.length; i++) {
    const remaining = cooldown.remaining(fallbacks[i].providerID, fallbacks[i].modelID) ?? Infinity
    if (remaining < bestRemaining) {
      bestRemaining = remaining
      bestIndex = i
    }
  }

  return { kind: "soonest", index: bestIndex }
}

export type FallbackEntry = {
  providerID: string
  modelID: string
}

export function isRetryable(error: Err, provider: string): boolean {
  return SessionRetry.retryable(error, provider) !== undefined
}

export const FallbackTriggered = EventV2.define({
  type: "llm.fallback.triggered",
  schema: {
    sessionID: SessionID,
    modelID: ModelID,
    providerID: ProviderID,
    reason: Schema.String,
  },
})

export const FallbackUsed = EventV2.define({
  type: "llm.fallback.used",
  schema: {
    sessionID: SessionID,
    modelID: ModelID,
    providerID: ProviderID,
  },
})

export const cooldown = new CooldownManager()

export function classifyError(cause: Cause.Cause<unknown>, prevProviderID: string, _prevModelID: string, cooldownSeconds: number): ClassifiedError | null {
  const error = Cause.squash(cause)
  let err = MessageV2.fromError(error, { providerID: ProviderID.make(prevProviderID) })
  if (!MessageV2.APIError.isInstance(err) && !MessageV2.ContextOverflowError.isInstance(err) && !MessageV2.AbortedError.isInstance(err)) {
    err = new MessageV2.APIError({
      message: typeof error === "string" ? error : error instanceof Error ? error.message : "Unknown stream error",
      isRetryable: true,
    }).toObject()
  }
  if (!isRetryable(err, prevProviderID)) return null
  const retryInfo = SessionRetry.retryable(err as unknown as SessionRetry.Err, prevProviderID)
  return {
    error: err,
    isRetryable: true,
    retryInfo,
    reason: retryInfo?.message ?? "error",
  }
}

export const FALLBACK_NOTICE_ID = "fallback-notice"
export const FALLBACK_RESUME_ID = "fallback-resume"
export const FALLBACK_USING_ID = "fallback-using"

export type ClassifiedError = {
  error: unknown
  isRetryable: boolean
  retryInfo: SessionRetry.Retryable | undefined
  reason: string
}

export type FallbackDeps = {
  provider: {
    getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Provider.Model, unknown>
    getProvider: (providerID: ProviderID) => Effect.Effect<Provider.Info, unknown>
  }
  events: EventV2Bridge.Service
  config: {
    get: () => Effect.Effect<{ cooldown_seconds?: number }, unknown>
  }
  classifyError: (cause: Cause.Cause<unknown>, prevProviderID: string, prevModelID: string, cooldownSeconds: number) => ClassifiedError | null
  call: (model: Provider.Model, providerID: string, modelID: string) => Effect.Effect<ProviderResult, unknown>
  log: {
    clone: () => FallbackDeps["log"]
    info: (msg: string, ...args: any[]) => void
    warn: (msg: string, ...args: any[]) => void
    tag: (key: string, value: string) => FallbackDeps["log"]
  }
}

export type FallbackInput = {
  sessionID: string
  model: Provider.Model & { providerID: string; id: string }
  fallbacks?: Array<{ providerID: string; modelID: string }>
  usedFallback?: { providerID: string; modelID: string }
  wasOnFallback?: boolean
  abort: AbortSignal
}

type StreamEvent = { type: string; id?: string; text?: string; [key: string]: unknown }

function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function noticeEvents(text: string, id: string = FALLBACK_NOTICE_ID): StreamEvent[] {
  return [
    { type: "text-start", id } as StreamEvent,
    { type: "text-delta", id, text } as StreamEvent,
    { type: "text-end", id } as StreamEvent,
  ]
}

function cooldownDuration(
  err: Record<string, any>,
  retryInfo: SessionRetry.Retryable | undefined,
  cooldownSeconds: number,
  quotaCooldownMs: number,
): number {
  const headers = (err as any)?.data?.responseHeaders ?? {}
  const retryAfterMs = headers["retry-after-ms"]
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs)
    if (!Number.isNaN(parsed)) return Math.ceil(parsed)
  }
  const retryAfter = headers["retry-after"]
  if (retryAfter) {
    const parsed = Number.parseFloat(retryAfter) * 1000
    if (!Number.isNaN(parsed)) return Math.ceil(parsed)
    const dateParsed = Date.parse(retryAfter) - Date.now()
    if (!Number.isNaN(dateParsed) && dateParsed > 0) return Math.ceil(dateParsed)
  }
  if (retryInfo?.quotaLimit) return quotaCooldownMs
  return cooldownSeconds * 1000
}

export function withFallback(
  input: FallbackInput,
  deps: FallbackDeps,
): Effect.Effect<Stream.Stream<LLMEvent, unknown>, unknown> {
  return Effect.gen(function* () {
    const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000
    const cfg = yield* deps.config.get()
    const cooldownSeconds = cfg.cooldown_seconds ?? 300
    const fallbacks = input.fallbacks ?? []

    if (fallbacks.length === 0) {
      const result = yield* deps.call(input.model, input.model.providerID, input.model.id)
      return toStream(result)
    }

    const chainFallback = (
      stream: Stream.Stream<any, unknown>,
      prevEntry: { providerID: string; modelID: string },
      entry: { providerID: string; modelID: string },
    ): Stream.Stream<any, unknown> => {
      const el = deps.log.clone().tag("providerID", entry.providerID).tag("modelID", entry.modelID)
      return stream.pipe(
        Stream.catchCause((cause) =>
          Stream.unwrap(
            Effect.gen(function* () {
              if (cooldown.isCooledDown(entry.providerID, entry.modelID)) {
                el.info("skipping cooled-down fallback")
                return yield* Effect.failCause(cause)
              }

              const resolved = yield* deps.provider
                .getModel(ProviderID.make(entry.providerID), ModelID.make(entry.modelID))
                .pipe(Effect.option)
              if (!Option.isSome(resolved)) {
                el.info("fallback model not found, skipping")
                return yield* Effect.failCause(cause)
              }
              const model = resolved.value

              if (input.abort.aborted) return yield* Effect.fail(new Error("Request aborted"))

              const classified = deps.classifyError(cause, prevEntry.providerID, prevEntry.modelID, cooldownSeconds)
              if (!classified) {
                el.info("non-retryable error, not falling back")
                return yield* Effect.failCause(cause)
              }

              const durationMs = cooldownDuration(classified.error as Record<string, any>, classified.retryInfo, cooldownSeconds, QUOTA_COOLDOWN_MS)
              cooldown.put(prevEntry.providerID, prevEntry.modelID, durationMs)
              el.info("stream error, falling back", { cooldownMs: durationMs })

              yield* deps.events.publish(FallbackTriggered, {
                sessionID: SessionID.make(input.sessionID ?? ""),
                modelID: ModelID.make(prevEntry.modelID),
                providerID: ProviderID.make(prevEntry.providerID),
                reason: classified.reason,
              })

              input.usedFallback = { providerID: entry.providerID, modelID: entry.modelID }
              yield* deps.events.publish(FallbackUsed, {
                sessionID: SessionID.make(input.sessionID ?? ""),
                modelID: ModelID.make(entry.modelID),
                providerID: ProviderID.make(entry.providerID),
              })

              const providerInfo = yield* deps.provider.getProvider(ProviderID.make(entry.providerID)).pipe(Effect.option)
              const providerName = Option.isSome(providerInfo) ? providerInfo.value.name : entry.providerID
              const reason = classified.reason.length > 40 ? classified.reason.slice(0, 37) + "..." : classified.reason
              const notice = `→ Switching to ${model.name} (${providerName})${reason ? ` — ${reason}` : ""}`
              const fallbackResult = yield* deps.call(model, entry.providerID, entry.modelID)

              return Stream.concat(Stream.fromIterable(noticeEvents(notice)), toStream(fallbackResult))
            }),
          ),
        ),
      )
    }

    const primaryEntry = { providerID: input.model.providerID, modelID: input.model.id }
    const decision = pickStart(primaryEntry, fallbacks, cooldown)

    if (decision.kind !== "primary") {
      const startEntry = decision.kind === "soonest" && decision.index === -1
        ? primaryEntry
        : fallbacks[decision.index]

      const startModel = yield* deps.provider
        .getModel(ProviderID.make(startEntry.providerID), ModelID.make(startEntry.modelID))
        .pipe(Effect.option)

      let resolvedModel = startModel
      let resolvedEntry = startEntry
      if (!Option.isSome(resolvedModel) && (decision.kind !== "soonest" || decision.index !== -1)) {
        const startIndex = decision.kind === "soonest" && decision.index !== -1 ? decision.index : decision.kind === "fallback" ? decision.index : 0
        for (let i = startIndex + 1; i < fallbacks.length; i++) {
          const candidate = fallbacks[i]
          if (decision.kind === "soonest" && cooldown.isCooledDown(candidate.providerID, candidate.modelID)) continue
          const next = yield* deps.provider.getModel(ProviderID.make(candidate.providerID), ModelID.make(candidate.modelID)).pipe(Effect.option)
          if (Option.isSome(next)) {
            resolvedModel = next
            resolvedEntry = candidate
            break
          }
        }
      }

      if (!Option.isSome(resolvedModel)) {
        deps.log.warn("no fallbacks resolvable, attempting primary with cleared cooldown")
        cooldown.clear(primaryEntry.providerID, primaryEntry.modelID)
        const primaryResult = yield* deps.call(input.model, input.model.providerID, input.model.id)
        return toStream(primaryResult)
      }

      const model = Option.isSome(startModel) ? startModel.value : resolvedModel.value
      deps.log.info("primary on cooldown, starting from fallback", {
        providerID: resolvedEntry.providerID,
        modelID: resolvedEntry.modelID,
      })

      yield* deps.events.publish(FallbackTriggered, {
        sessionID: SessionID.make(input.sessionID ?? ""),
        modelID: ModelID.make(primaryEntry.modelID),
        providerID: ProviderID.make(primaryEntry.providerID),
        reason: "cooldown",
      })
      input.usedFallback = { providerID: resolvedEntry.providerID, modelID: resolvedEntry.modelID }
      yield* deps.events.publish(FallbackUsed, {
        sessionID: SessionID.make(input.sessionID ?? ""),
        modelID: ModelID.make(resolvedEntry.modelID),
        providerID: ProviderID.make(resolvedEntry.providerID),
      })

      const startResult = yield* deps.call(model, resolvedEntry.providerID, resolvedEntry.modelID)
      let stream: Stream.Stream<any, unknown> = toStream(startResult)

      const startIdx = decision.kind === "soonest" && decision.index === -1 ? 0 : decision.index
      for (let i = startIdx + 1; i < fallbacks.length; i++) {
        stream = chainFallback(stream, fallbacks[i - 1], fallbacks[i])
      }

      return stream
    }

    const chain: Array<{ providerID: string; modelID: string }> = [
      { providerID: input.model.providerID, modelID: input.model.id },
      ...fallbacks,
    ]

    const primaryResult = yield* deps.call(input.model, input.model.providerID, input.model.id)
    const primary = toStream(primaryResult)

    let stream: Stream.Stream<any, unknown> = primary

    if (input.wasOnFallback) {
      const providerInfo = yield* deps.provider.getProvider(ProviderID.make(input.model.providerID)).pipe(Effect.option)
      const providerName = Option.isSome(providerInfo) ? providerInfo.value.name : input.model.providerID
      const notice = `→ Switched to ${input.model.name} (${providerName})`
      stream = Stream.concat(Stream.fromIterable(noticeEvents(notice, FALLBACK_RESUME_ID)), primary)
    }

    for (let i = 1; i < chain.length; i++) {
      stream = chainFallback(stream, chain[i - 1], chain[i])
    }

    return stream
  })
}