export * as DSMLGuard from "./dsml-guard.js"

import { AIError, InvalidProviderOutputError, LLMEvent, LLMClient, type LLMClientService } from "@opencode/ai/effect"
import { Context, Effect, Layer, Stream } from "effect"
import { DSML_GUARD_MESSAGE, EMPTY_VETTING_LOOP_MESSAGE, emptyVettingLoopDetector } from "./dsml.js"
import { guardStatus, isDSV4Scope } from "./dsml-recovery.js"

// The closing marker is the only DSML evidence a response cannot legitimately
// carry: a parsed invocation never reaches assistant text.
const CLOSING_MARKER = "</" + "\uFF5CDSML\uFF5C"

type Options = {
  readonly onError?: (message: string) => void
}

/**
 * Native-route counterpart of `guardDSMLStream`. Providers configured with an
 * AI SDK package are rewritten to the native `@opencode/ai/providers/*` routes,
 * so the AI SDK `doStream` seam never sees them. This guard runs on the
 * provider-neutral event stream instead and fails the stream when the response
 * emits the DSML closing marker or repeats empty vetting blocks. Provider
 * failures are stream errors, not events, since the `provider-error` LLMEvent
 * was removed upstream.
 */
export function guardDSMLEvents<E>(
  stream: Stream.Stream<LLMEvent, E>,
  options: Options = {},
): Stream.Stream<LLMEvent, E | AIError> {
  const loop = emptyVettingLoopDetector()
  let tail = ""
  let message: string | undefined
  return stream.pipe(
    // `takeWhile` stops pulling from the provider as soon as the guard fires;
    // `flatMap` would drain the rest of the response first.
    Stream.takeWhile((event) => {
      if (message !== undefined) return false
      if (event.type !== "text-delta") return true
      const text = tail + event.text
      // Retain one marker lookbehind so a marker split across deltas still matches.
      tail = text.slice(Math.max(0, text.length - (CLOSING_MARKER.length - 1)))
      const loopAt = loop.feed(event.text)
      if (!text.includes(CLOSING_MARKER) && loopAt === -1) return true
      message = loopAt === -1 ? DSML_GUARD_MESSAGE : EMPTY_VETTING_LOOP_MESSAGE
      try {
        options.onError?.(message)
      } catch {
        /* diagnostics must not mask the stream result */
      }
      return true
    }),
    Stream.concat(
      Stream.suspend(() => {
        const failure = message
        return failure === undefined
          ? Stream.empty
          : Stream.fail(new AIError({ reason: new InvalidProviderOutputError({ message: failure, classification: "incomplete-stream" }) }))
      }),
    ),
  )
}

type Client = Context.Service.Shape<typeof LLMClient.Service>

/** Applies the guard to the dsv4 scope only, leaving every other route untouched. */
export function wrap(client: Client): Client {
  return {
    ...client,
    stream: (request, options) =>
      isDSV4Scope(request.model.provider, request.model.id) && guardStatus() === "enabled"
        ? guardDSMLEvents(client.stream(request, options))
        : client.stream(request, options),
  }
}

export const layer: Layer.Layer<LLMClientService, never, LLMClientService> = Layer.effect(
  LLMClient.Service,
  Effect.map(LLMClient.Service, wrap),
)
