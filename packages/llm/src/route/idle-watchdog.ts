import { Stream } from "effect"
import { LLMError, TransportReason } from "../schema"

/**
 * Default maximum gap between stream elements before a provider stream is
 * declared stalled.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000

/**
 * Fail a stream instead of letting it hang when the provider stops sending
 * data.
 *
 * Uses `Stream.timeoutOrElse` rather than bare `Stream.timeout`: the bare
 * variant ENDS the stream silently on timeout, which makes a stalled provider
 * look like clean completion. `timeoutOrElse` checks the deadline on every
 * pull and switches to `orElse` — exactly one failing element — so elements
 * emitted before the stall are preserved and the consumer observes a typed
 * failure.
 */
export function guardIdle(options: { readonly idleMs: number }) {
  return <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E | LLMError, R> =>
    self.pipe(
      Stream.timeoutOrElse({
        duration: options.idleMs,
        orElse: () =>
          Stream.fail(
            new LLMError({
              module: "IdleWatchdog",
              method: "guard",
              reason: new TransportReason({
                message: `Provider stream stalled: no data received for ${options.idleMs}ms`,
                kind: "IdleTimeout",
              }),
            }),
          ),
      }),
    )
}

export * as IdleWatchdog from "./idle-watchdog"
