import { Effect, Schema } from "effect"
import { Protocol } from "../../route/protocol.js"
import { LLMEvent, mergeJsonRecords, type AIError, type LLMRequest } from "../../schema/index.js"
import { ProviderShared } from "../shared.js"

const ProviderMetadata = Schema.Struct({
  provider_metadata: Schema.optional(
    Schema.Struct({ gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) }),
  ),
})
const Metadata = Schema.Struct({
  ...ProviderMetadata.fields,
  response: Schema.optional(ProviderMetadata),
  choices: Schema.optional(Schema.Array(Schema.Struct({ delta: Schema.optional(ProviderMetadata) }))),
})
const decodeMetadata = Schema.decodeUnknownOption(Schema.fromJsonString(Metadata))

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
  const validateBody = ProviderShared.validateWith(Schema.decodeUnknownEffect(protocol.body.schema))
  const initial = (request: LLMRequest) => ({
    inner: protocol.stream.initial(request),
    gateway: undefined as Record<string, unknown> | undefined,
  })
  const onHalt = protocol.stream.onHalt
  const withGateway = (events: ReadonlyArray<LLMEvent>, gateway: Record<string, unknown> | undefined) =>
    gateway === undefined
      ? events
      : events.map((event) =>
          LLMEvent.is.finish(event) ? { ...event, providerMetadata: { ...event.providerMetadata, gateway } } : event,
        )

  return Protocol.make({
    id: input.id,
    body: {
      schema: Schema.Record(Schema.String, Schema.Unknown),
      from: Effect.fn("GatewayProtocol.body")(function* (request: LLMRequest) {
        const prepared = yield* input.prepare(request)
        const body = yield* protocol.body.from(prepared.request).pipe(Effect.flatMap(validateBody))
        return { ...body, ...prepared.body }
      }),
    },
    sanitizer: protocol.sanitizer,
    stream: {
      event: Schema.String,
      initial,
      step: Effect.fn("GatewayProtocol.step")(function* (state: ReturnType<typeof initial>, frame: string) {
        const event = yield* decodeEvent(frame).pipe(
          Effect.mapError((cause) => ProviderShared.eventError(input.id, "Invalid gateway event", frame, cause)),
        )
        const metadata = decodeMetadata(frame)
        const gateway =
          metadata._tag === "None"
            ? state.gateway
            : mergeJsonRecords(
                state.gateway,
                metadata.value.provider_metadata?.gateway,
                metadata.value.response?.provider_metadata?.gateway,
                ...(metadata.value.choices ?? []).map((choice) => choice.delta?.provider_metadata?.gateway),
              )
        const [inner, events] = yield* protocol.stream.step(state.inner, event)
        return [{ inner, gateway }, withGateway(events, gateway)] as const
      }),
      onHalt: onHalt
        ? (state) => onHalt(state.inner).pipe(Effect.map((events) => withGateway(events, state.gateway)))
        : undefined,
    },
  })
}
