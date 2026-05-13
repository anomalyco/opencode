import { Schema, type Effect } from "effect"
import type { LLMError, LLMEvent, LLMRequest, ProtocolID } from "../schema"

/**
 * The semantic API contract of one model server family.
 *
 * A `Protocol` owns the parts of a route that are intrinsic to "what does
 * this API look like": how a common `LLMRequest` becomes a provider-native
 * body, what schema that body must satisfy before it is JSON-encoded, and
 * how the streaming response decodes back into common `LLMEvent`s.
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
 * by `Route.make(...)` along with the chosen `Endpoint`, `Auth`,
 * and `Framing`. This separation is what lets DeepSeek, TogetherAI, Cerebras,
 * etc. all reuse `OpenAIChat.protocol` without forking 300 lines per provider.
 *
 * The four type parameters reflect the pipeline:
 *
 * - `Body` — provider-native request body candidate. `Route.make(...)`
 *   validates and JSON-encodes it with `body.schema`.
 * - `Frame` — one unit of the framed response stream. SSE: a JSON data
 *   string. AWS event stream: a parsed binary frame.
 * - `Event` — schema-decoded provider event produced from one frame.
 * - `State` — accumulator threaded through `stream.step` to translate event
 *   sequences into `LLMEvent` sequences.
 */
export interface Protocol<Body, Frame, Event, State> {
  /** Stable id for the wire protocol implementation. */
  readonly id: ProtocolID
  /** Request side: schema for the provider-native body and how to build it. */
  readonly body: ProtocolBody<Body>
  /** Response side: streaming state machine. */
  readonly stream: ProtocolStream<Frame, Event, State>
}

export interface ProtocolBody<Body> {
  /** Schema for the validated provider-native body sent as the JSON request. */
  readonly schema: Schema.Codec<Body, unknown>
  /** Build the provider-native body from a common `LLMRequest`. */
  readonly from: (request: LLMRequest) => Effect.Effect<Body, LLMError>
}

export interface ProtocolStream<Frame, Event, State> {
  /** Schema for one decoded streaming event, decoded from a transport frame. */
  readonly event: Schema.Codec<Event, Frame>
  /** Initial parser state. Called once per response. */
  readonly initial: () => State
  /** Translate one event into emitted `LLMEvent`s plus the next state. */
  readonly step: (state: State, event: Event) => Effect.Effect<readonly [State, ReadonlyArray<LLMEvent>], LLMError>
  /** Optional request-completion signal for transports that do not end naturally. */
  readonly terminal?: (event: Event) => boolean
  /** Optional flush emitted when the framed stream ends. */
  readonly onHalt?: (state: State) => ReadonlyArray<LLMEvent>
}

/**
 * Construct a `Protocol` from its body and stream pieces:
 *
 * - `body.schema` infers the provider-native request body shape.
 * - `body.from` ties the common `LLMRequest` to the provider body.
 * - `stream.event` infers the decoded streaming event and the wire frame.
 * - `stream.initial`, `stream.step`, and `stream.onHalt` infer the parser state.
 *
 * Provider implementations should usually call `Protocol.make({ ... })`
 * without explicit type arguments; the schemas and parser functions are the
 * source of truth. The constructor remains as the public seam for future
 * cross-cutting concerns such as tracing or instrumentation.
 */
export const make = <Body, Frame, Event, State>(
  input: Protocol<Body, Frame, Event, State>,
): Protocol<Body, Frame, Event, State> => input

export const jsonEvent = <const S extends Schema.Top>(schema: S) => Schema.fromJsonString(schema)

export * as Protocol from "./protocol"
