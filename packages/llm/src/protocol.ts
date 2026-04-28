import type { Effect } from "effect"
import type { LLMError, LLMEvent, LLMRequest, ProtocolID, ProviderChunkError } from "./schema"

/**
 * The semantic API contract of one model server family.
 *
 * A `Protocol` owns the parts of an adapter that are intrinsic to "what does
 * this API look like": how a common `LLMRequest` lowers into a provider-native
 * shape, how that shape validates and encodes onto the wire, and how the
 * streaming response decodes back into common `LLMEvent`s.
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
 * by `Adapter.fromProtocol(...)` along with the chosen `Endpoint`, `Auth`,
 * and `Framing`. This separation is what lets DeepSeek, TogetherAI, Cerebras,
 * etc. all reuse `OpenAIChat.protocol` without forking 300 lines per provider.
 *
 * The five type parameters reflect the pipeline:
 *
 * - `Draft` — provider-native shape *before* target patches.
 * - `Target` — provider-native shape *after* target patches and Schema
 *   validation. The body sent to the provider is `encode(target)`.
 * - `Frame` — one unit of the framed response stream. SSE: a JSON data
 *   string. AWS event stream: a parsed binary frame.
 * - `Chunk` — schema-decoded provider chunk produced from one frame.
 * - `State` — accumulator threaded through `process` to translate chunk
 *   sequences into `LLMEvent` sequences.
 */
export interface Protocol<Draft, Target, Frame, Chunk, State> {
  /** Stable id matching `ModelRef.protocol` for adapter registry lookup. */
  readonly id: ProtocolID
  /** Lower a common request into this protocol's draft shape. */
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  /** Validate the post-patch draft against the protocol's target schema. */
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
  /** Serialize the validated target into a request body. */
  readonly encode: (target: Target) => string
  /** Produce a redacted copy for `PreparedRequest.redactedTarget`. */
  readonly redact: (target: Target) => unknown
  /** Decode one framed response unit into a typed provider chunk. */
  readonly decode: (frame: Frame) => Effect.Effect<Chunk, ProviderChunkError>
  /** Initial parser state. Called once per response. */
  readonly initial: () => State
  /** Translate one chunk into emitted events plus the next state. */
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], ProviderChunkError>
  /** Optional flush emitted when the framed stream ends. */
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>
  /** Error message used when the underlying transport fails mid-stream. */
  readonly streamReadError: string
}

/**
 * Construct a `Protocol` from its parts. Currently a typed identity, but kept
 * as the public constructor so future cross-cutting concerns (tracing spans,
 * default redaction, instrumentation) can be added in one place.
 */
export const define = <Draft, Target, Frame, Chunk, State>(
  input: Protocol<Draft, Target, Frame, Chunk, State>,
): Protocol<Draft, Target, Frame, Chunk, State> => input

export * as Protocol from "./protocol"
