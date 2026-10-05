import { Effect, Schema } from "effect"
import { Protocol } from "../../route/protocol.js"
import { LLMEvent, mergeJsonRecords, type AIError, type LLMRequest } from "../../schema/index.js"
import { ProviderShared } from "../shared.js"

// Gateway attaches billing and routing metadata to raw SSE frames under snake_case `provider_metadata.gateway`
// (`message_delta` on Messages, `response.completed` on Responses, and `choices[].delta` on Chat).
const WireMetadataField = Schema.Struct({
  provider_metadata: Schema.optional(
    Schema.Struct({ gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
  ),
})
const WireFrameMetadata = Schema.Struct({
  ...WireMetadataField.fields,
  response: Schema.optional(WireMetadataField),
  choices: Schema.optional(Schema.Array(Schema.Struct({ delta: Schema.optional(WireMetadataField) }))),
})
const decodeWireMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(WireFrameMetadata))

interface ParserState<Inner> {
  readonly inner: Inner
  readonly gateway?: Record<string, unknown>
}

function readGatewayMetadata(
  current: Record<string, unknown> | undefined,
  frame: string,
): Record<string, unknown> | undefined {
  if (!frame.includes("provider_metadata")) return current
  const decoded = decodeWireMetadata(frame)
  if (decoded._tag === "None") return current
  return mergeJsonRecords(
    current,
    decoded.value.provider_metadata?.gateway,
    decoded.value.response?.provider_metadata?.gateway,
    ...(decoded.value.choices ?? []).map((choice) => choice.delta?.provider_metadata?.gateway),
  )
}

function attachGatewayMetadata(
  events: ReadonlyArray<LLMEvent>,
  gateway: Record<string, unknown> | undefined,
): ReadonlyArray<LLMEvent> {
  if (!gateway || !events.some(LLMEvent.is.finish)) return events
  return events.map((event) =>
    LLMEvent.is.finish(event) ? { ...event, providerMetadata: { ...event.providerMetadata, gateway } } : event,
  )
}

export function gatewayProtocol<Body, Event, State>(
  protocol: Protocol<Body, string, Event, State>,
  input: {
    readonly id: string
    readonly prepare: (
      request: LLMRequest,
    ) => Effect.Effect<{ readonly request: LLMRequest; readonly body: Record<string, unknown> }, AIError>
  },
) {
  const decodeEvent = Schema.decodeUnknownEffect(protocol.stream.event)
  const initial = (request: LLMRequest): ParserState<State> => ({
    inner: protocol.stream.initial(request),
  })
  const onHalt = protocol.stream.onHalt

  return Protocol.make({
    id: input.id,
    body: {
      schema: Schema.Record(Schema.String, Schema.Unknown),
      from: Effect.fnUntraced(function* (request: LLMRequest) {
        const prepared = yield* input.prepare(request)
        const body = yield* protocol.body.from(prepared.request)
        return { ...body, ...prepared.body }
      }),
    },
    supportsEffortUpdates: protocol.supportsEffortUpdates,
    sanitizer: protocol.sanitizer,
    stream: {
      event: Schema.String,
      initial,
      step: Effect.fnUntraced(function* (state: ParserState<State>, frame: string) {
        const event = yield* decodeEvent(frame).pipe(
          Effect.mapError((cause) => ProviderShared.eventError(input.id, "Invalid gateway event", frame, cause)),
        )
        const gateway = readGatewayMetadata(state.gateway, frame)
        const [inner, events] = yield* protocol.stream.step(state.inner, event)
        return [{ inner, gateway }, attachGatewayMetadata(events, gateway)] as const
      }),
      onHalt: onHalt
        ? (state) => onHalt(state.inner).pipe(Effect.map((events) => attachGatewayMetadata(events, state.gateway)))
        : undefined,
    },
  })
}
