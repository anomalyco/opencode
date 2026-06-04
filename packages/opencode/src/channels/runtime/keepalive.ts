import { Effect, Fiber, Schedule } from "effect"
import type { Scope } from "effect/Scope"
import type { TypingCapable } from "../contracts/typing"
import { Service as RegistryService } from "./registry"

const DEFAULT_TYPING_INTERVAL_MS = 4500 // Telegram typing expires after 5s

/**
 * Start a typing keepalive that repeats `startTyping` on the channel
 * until the calling scope is released.
 *
 * Usage:
 * ```ts
 * yield* Effect.scoped(
 *   keepalive.typingKeepalive(channelId)
 * )
 * ```
 */
export function typingKeepalive(
  channelId: string,
  intervalMs: number = DEFAULT_TYPING_INTERVAL_MS
): Effect.Effect<void, Error, RegistryService | Scope> {
  return Effect.gen(function* () {
    const registry = yield* RegistryService
    const channel = yield* registry.get(channelId)

    if (!channel) {
      return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
    }

    if (!("startTyping" in channel) || typeof channel.startTyping !== "function") {
      return yield* Effect.void // Channel doesn't support typing — silently skip
    }

    const typing = channel as unknown as TypingCapable

    // Send initial typing indicator
    yield* typing.startTyping(channelId)

    // Fork a repeating fiber that re-sends typing every intervalMs
    const fiber = yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(intervalMs)
          yield* typing.startTyping(channelId)
        }
      }).pipe(
        Effect.catch(() => Effect.void) // Swallow errors to keep alive
      )
    )

    // The fiber is automatically interrupted when the enclosing scope closes
    void fiber
  })
}

/**
 * Send a single typing indicator and return a cleanup function.
 * Non-scoped version for simple use cases.
 */
export function sendTypingOnce(
  channelId: string
): Effect.Effect<() => void, Error, RegistryService> {
  return Effect.gen(function* () {
    const registry = yield* RegistryService
    const channel = yield* registry.get(channelId)

    if (!channel) {
      return yield* Effect.fail(new Error(`Channel not found: ${channelId}`))
    }

    if ("startTyping" in channel && typeof channel.startTyping === "function") {
      return yield* (channel as unknown as TypingCapable).startTyping(channelId)
    }

    return () => {} // No-op if channel doesn't support typing
  })
}

export * as Keepalive from "./keepalive"
