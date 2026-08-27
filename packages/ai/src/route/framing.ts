import type { Stream } from "effect"
import * as ProviderShared from "../protocols/shared.js"
import type { AIError } from "../schema/index.js"

/**
 * Decode a streaming HTTP response body into provider-protocol frames.
 *
 * `Framing` is the byte-stream-shaped seam between transport and protocol:
 *
 * - SSE (`Framing.sse`) — UTF-8 decode the body, run the SSE channel decoder,
 *   drop empty / `[DONE]` keep-alives. Each emitted frame is the JSON `data:`
 *   payload of one event.
 * - AWS event stream — length-prefixed binary frames with CRC checksums.
 *   Each emitted frame is one parsed binary event record.
 *
 * The frame type is opaque to this layer; the protocol's event schema decodes
 * each frame before its state machine handles it.
 */
export interface Definition<Frame> {
  readonly id: string
  readonly frame: (bytes: Stream.Stream<Uint8Array, AIError>) => Stream.Stream<Frame, AIError>
  /** Original wire representation when framing transforms the provider payload. */
  readonly body?: (frame: Frame) => string | undefined
}

/** Server-Sent Events framing. Used by every JSON-streaming HTTP provider. */
export const sse: Definition<string> = { id: "sse", frame: ProviderShared.sseFraming }

/** SSE framing restricted to protocol-recognized event names. */
export const sseEvents = (events: ReadonlySet<string>): Definition<string> => ({
  id: "sse",
  frame: (bytes) => ProviderShared.sseFraming(bytes, events),
})

export * as Framing from "./framing.js"
