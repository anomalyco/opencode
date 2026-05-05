import type { Effect, Schema } from "effect"
import type { LLMError, LLMEvent, LLMRequest, ProtocolID, ProviderChunkError } from "./schema"

/**
 * The semantic API contract of one model server family.
 *
 * A `Protocol` owns the parts of an adapter that are intrinsic to "what does
 * this API look like": how a common `LLMRequest` lowers into a provider-native
 * shape, what target Schema that shape must satisfy before it is JSON-encoded,
 * and how the streaming response decodes back into common `LLMEvent`s.
 *
 * Examples:
 *
 * - `OpenAIChat.protocol` — chat completions style
 * - `OpenAIResponses.protocol` — responses API
 * - `AnthropicMessages.protocol` — messages API with content blocks
 * - `Gemini.protocol` — generateContent
 * - `BedrockConverse.protocol` — Converse with binary event-stream framing
 *
 * A `Protocol` is **not** a deployment. It does not know which URL, which
 * headers, or which auth scheme to use. Those are deployment concerns owned
 * by `Adapter.make(...)` along with the chosen `Endpoint`, `Auth`,
 * and `Framing`. This separation is what lets DeepSeek, TogetherAI, Cerebras,
 * etc. all reuse `OpenAIChat.protocol` without forking 300 lines per provider.
 *
 * The four type parameters reflect the pipeline:
 *
 * - `Target` — provider-native request body candidate. Target patches can
 *   transform this value, then `Adapter.make(...)` validates and
 *   JSON-encodes it with `target`.
 * - `Frame` — one unit of the framed response stream. SSE: a JSON data
 *   string. AWS event stream: a parsed binary frame.
 * - `Chunk` — schema-decoded provider chunk produced from one frame.
 * - `State` — accumulator threaded through `process` to translate chunk
 *   sequences into `LLMEvent` sequences.
 */
export interface Protocol<Target, Frame, Chunk, State> {
  /** Stable id matching `ModelRef.protocol` for adapter registry lookup. */
  readonly id: ProtocolID
  /** Schema for the validated provider-native target sent as the JSON body. */
  readonly target: Schema.Codec<Target, unknown>
  /** Lower a common request into this protocol's provider-native target shape. */
  readonly prepare: (request: LLMRequest) => Effect.Effect<Target, LLMError>
  /** Schema for one framed response unit. */
  readonly chunk: Schema.Codec<Chunk, Frame>
  /** Initial parser state. Called once per response. */
  readonly initial: () => State
  /** Translate one chunk into emitted events plus the next state. */
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], ProviderChunkError>
  /** Optional flush emitted when the framed stream ends. */
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>
}

/**
 * Construct a `Protocol` from its parts. Currently a typed identity, but kept
 * as the public constructor so future cross-cutting concerns (tracing spans,
 * instrumentation) can be added in one place.
 */
export const define = <Target, Frame, Chunk, State>(
  input: Protocol<Target, Frame, Chunk, State>,
): Protocol<Target, Frame, Chunk, State> => input

export * as Protocol from "./protocol"
