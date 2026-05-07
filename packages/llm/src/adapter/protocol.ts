import { Schema, type Effect } from "effect"
import type { LLMError, LLMEvent, LLMRequest, ProtocolID } from "../schema"

/**
 * The semantic API contract of one model server family.
 *
 * A `Protocol` owns the parts of an adapter that are intrinsic to "what does
 * this API look like": how a common `LLMRequest` lowers into a provider-native
 * shape, what payload Schema that shape must satisfy before it is JSON-encoded,
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
 * - `Payload` — provider-native request payload candidate. `Adapter.make(...)`
 *   validates and JSON-encodes it with `payload`.
 * - `Frame` — one unit of the framed response stream. SSE: a JSON data
 *   string. AWS event stream: a parsed binary frame.
 * - `Chunk` — schema-decoded provider chunk produced from one frame.
 * - `State` — accumulator threaded through `process` to translate chunk
 *   sequences into `LLMEvent` sequences.
 */
export interface Protocol<Payload, Frame, Chunk, State> {
  /** Stable id for the wire protocol implementation. */
  readonly id: ProtocolID
  /** Schema for the validated provider-native payload sent as the JSON body. */
  readonly payload: Schema.Codec<Payload, unknown>
  /** Convert a common request into this protocol's provider-native payload shape. */
  readonly toPayload: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  /** Schema for one framed response unit. */
  readonly chunk: Schema.Codec<Chunk, Frame>
  /** Initial parser state. Called once per response. */
  readonly initial: () => State
  /** Translate one chunk into emitted events plus the next state. */
  readonly process: (
    state: State,
    chunk: Chunk,
  ) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], LLMError>
  /** Optional flush emitted when the framed stream ends. */
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>
}

/**
 * Construct a `Protocol` from the four protocol-local pieces:
 *
 * - `payload` infers the provider-native request body shape.
 * - `chunk` infers the framed response item and decoded chunk shape.
 * - `initial`, `process`, and `onHalt` infer the parser state shape.
 * - `toPayload` ties the common `LLMRequest` to the provider payload.
 *
 * Provider implementations should usually call `Protocol.define({ ... })`
 * without explicit type arguments; the schemas and parser functions are the
 * source of truth. The constructor remains as the public seam for future
 * cross-cutting concerns such as tracing or instrumentation.
 */
export const define = <Payload, Frame, Chunk, State>(
  input: Protocol<Payload, Frame, Chunk, State>,
): Protocol<Payload, Frame, Chunk, State> => input

export const jsonChunk = <const S extends Schema.Top>(schema: S) => Schema.fromJsonString(schema)

export * as Protocol from "./protocol"
