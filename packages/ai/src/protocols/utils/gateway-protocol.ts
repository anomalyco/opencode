import { Effect, Option, Schema, SchemaGetter } from "effect"
import { Protocol } from "../../route/protocol.js"
import {
  LLMEvent,
  Usage,
  mergeJsonRecords,
  type AIError,
  type LLMRequest,
  type ProviderMetadata,
} from "../../schema/index.js"
import { JsonObject, lenient } from "../shared.js"

interface ParserState<Inner> {
  readonly inner: Inner
  readonly gateway?: Record<string, unknown>
  readonly providerMetadataKey: string
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
  message: lenient(GatewayHolder),
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

// Gateway bills /v1/messages and /v1/responses as a decimal string. Trimming and matching before Number()
// keeps "" and "   " from coercing to 0, which SessionUsage.record would trust as an authoritative free request.
const NonNegativeFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const DecimalCost = Schema.Trim.check(
  Schema.isPattern(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
).pipe(
  Schema.decodeTo(NonNegativeFinite, {
    decode: SchemaGetter.transform((value) => Number(value)),
    encode: SchemaGetter.transform((value) => String(value)),
  }),
)
const GatewayBilling = Schema.Struct({
  cost: lenient(Schema.Union([NonNegativeFinite, DecimalCost])),
})
const decodeGatewayBilling = Schema.decodeUnknownOption(GatewayBilling)

// A terminal frame can arrive without token counts; the billed amount is still authoritative, so it becomes a
// usage carrying only `cost`. Rebuilding through `new Usage` keeps the `visibleOutputTokens` getter the spread drops.
function withGatewayCost(usage: Usage | undefined, cost: number | undefined): Usage | undefined {
  if (cost === undefined || usage?.cost !== undefined) return usage
  return new Usage(usage === undefined ? { cost } : { ...usage, cost })
}

// The Gateway namespaces its metadata under `gateway` on the wire, while core reads the route's
// `providerMetadataKey`. Emit both so either reader finds the same generation and billing data.
function mergeGatewayMetadata(
  metadata: ProviderMetadata | undefined,
  gateway: Record<string, unknown>,
  providerMetadataKey: string,
): ProviderMetadata {
  const merged: ProviderMetadata = {
    ...metadata,
    gateway: mergeJsonRecords(metadata?.["gateway"], gateway) ?? gateway,
  }
  if (providerMetadataKey === "gateway") return merged
  return {
    ...merged,
    [providerMetadataKey]: mergeJsonRecords(metadata?.[providerMetadataKey], { gateway }) ?? { gateway },
  }
}

function attachGatewayMetadata(
  events: ReadonlyArray<LLMEvent>,
  gateway: Record<string, unknown> | undefined,
  providerMetadataKey: string,
): ReadonlyArray<LLMEvent> {
  if (!gateway) return events
  if (!events.some((event) => LLMEvent.is.stepFinish(event) || LLMEvent.is.finish(event))) return events
  const cost = Option.getOrUndefined(decodeGatewayBilling(gateway))?.cost
  return events.map((event) => {
    if (LLMEvent.is.stepFinish(event))
      return LLMEvent.stepFinish({
        ...event,
        usage: withGatewayCost(event.usage, cost),
        providerMetadata: mergeGatewayMetadata(event.providerMetadata, gateway, providerMetadataKey),
      })
    if (LLMEvent.is.finish(event))
      return LLMEvent.finish({
        ...event,
        usage: withGatewayCost(event.usage, cost),
        providerMetadata: mergeGatewayMetadata(event.providerMetadata, gateway, providerMetadataKey),
      })
    return event
  })
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
    providerMetadataKey: request.model.route.providerMetadataKey ?? request.model.provider,
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
              decoded.message?.provider_metadata?.gateway,
              decoded.response?.provider_metadata?.gateway,
              ...(decoded.choices ?? []).map((choice) => choice.delta?.provider_metadata?.gateway),
            )
          : state.gateway
        const [inner, events] = yield* protocol.stream.step(state.inner, event)
        return [
          { inner, gateway, providerMetadataKey: state.providerMetadataKey },
          attachGatewayMetadata(events, gateway, state.providerMetadataKey),
        ] as const
      }),
      terminal: protocol.stream.terminal,
      onHalt: onHalt
        ? (state) =>
            onHalt(state.inner).pipe(
              Effect.map((events) => attachGatewayMetadata(events, state.gateway, state.providerMetadataKey)),
            )
        : undefined,
    },
  })
}
