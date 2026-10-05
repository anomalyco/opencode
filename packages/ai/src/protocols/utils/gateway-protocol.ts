import { Effect, Option, Schema } from "effect"
import { Protocol } from "../../route/protocol.js"
import { LLMEvent, mergeJsonRecords, type AIError, type LLMRequest } from "../../schema/index.js"
import { JsonObject, lenient } from "../shared.js"

interface ParserState<Inner> {
  readonly inner: Inner
  readonly gateway?: Record<string, unknown>
}

const GatewayHolder = Schema.Struct({
  provider_metadata: lenient(
    Schema.Struct({
      gateway: lenient(JsonObject),
    }),
  ),
})

const GatewayEvent = Schema.Struct({
  ...GatewayHolder.fields,
  response: lenient(GatewayHolder),
  choices: lenient(
    Schema.Array(
      Schema.Struct({
        delta: lenient(GatewayHolder),
      }),
    ),
  ),
})
const decodeGatewayEvent = Schema.decodeUnknownOption(GatewayEvent)

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
  const initial = (request: LLMRequest): ParserState<State> => ({
    inner: protocol.stream.initial(request),
  })
  const onHalt = protocol.stream.onHalt

  return Protocol.make({
    id: input.id,
    body: {
      schema: JsonObject,
      from: Effect.fnUntraced(function* (request: LLMRequest) {
        const prepared = yield* input.prepare(request)
        const body = yield* protocol.body.from(prepared.request)
        return { ...body, ...prepared.body }
      }),
    },
    supportsEffortUpdates: protocol.supportsEffortUpdates,
    sanitizer: protocol.sanitizer,
    stream: {
      event: protocol.stream.event,
      initial,
      step: Effect.fnUntraced(function* (state: ParserState<State>, event: Event) {
        const decoded = Option.getOrUndefined(decodeGatewayEvent(event))
        const gateway = decoded
          ? mergeJsonRecords(
              state.gateway,
              decoded.provider_metadata?.gateway,
              decoded.response?.provider_metadata?.gateway,
              ...(decoded.choices ?? []).map((choice) => choice.delta?.provider_metadata?.gateway),
            )
          : state.gateway
        const [inner, events] = yield* protocol.stream.step(state.inner, event)
        return [{ inner, gateway }, attachGatewayMetadata(events, gateway)] as const
      }),
      terminal: protocol.stream.terminal,
      onHalt: onHalt
        ? (state) => onHalt(state.inner).pipe(Effect.map((events) => attachGatewayMetadata(events, state.gateway)))
        : undefined,
    },
  })
}
