import { Effect, Schema } from "effect"
import { Protocol } from "../../route/protocol.js"
import { LLMEvent, mergeJsonRecords, type AIError, type LLMRequest } from "../../schema/index.js"
import { isRecord } from "../shared.js"

interface ParserState<Inner> {
  readonly inner: Inner
  readonly gateway?: Record<string, unknown>
}

function gatewayMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.provider_metadata)) return undefined
  return isRecord(value.provider_metadata.gateway) ? value.provider_metadata.gateway : undefined
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
      event: protocol.stream.event,
      initial,
      step: Effect.fnUntraced(function* (state: ParserState<State>, event: Event) {
        const gateway = isRecord(event)
          ? mergeJsonRecords(
              state.gateway,
              gatewayMetadata(event),
              gatewayMetadata(event.response),
              ...(Array.isArray(event.choices) ? event.choices : []).map((choice) =>
                isRecord(choice) ? gatewayMetadata(choice.delta) : undefined,
              ),
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
