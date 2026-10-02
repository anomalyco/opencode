import { Effect, Schema } from "effect"
import { Protocol } from "../../route/protocol.js"
import { LLMEvent, ProviderMetadata, mergeJsonRecords, type AIError, type LLMRequest } from "../../schema/index.js"
import { ProviderShared } from "../shared.js"

const MetadataFields = {
  provider_metadata: Schema.optional(ProviderMetadata),
  providerMetadata: Schema.optional(ProviderMetadata),
}
const Envelope = Schema.StructWithRest(Schema.Struct(MetadataFields), [Schema.Record(Schema.String, Schema.Unknown)])
const Event = Schema.StructWithRest(
  Schema.Struct({
    ...MetadataFields,
    message: Schema.optional(Envelope),
    response: Schema.optional(Envelope),
    choices: Schema.optional(
      Schema.Array(
        Schema.StructWithRest(Schema.Struct({ delta: Schema.optional(Envelope) }), [
          Schema.Record(Schema.String, Schema.Unknown),
        ]),
      ),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

/** Retain gateway accounting/routing metadata without replacing the upstream parser's replay metadata. */
export function gatewayProtocol<Body, NativeEvent, State>(
  protocol: Protocol<Body, string, NativeEvent, State>,
  input: {
    readonly id: string
    readonly from: (request: LLMRequest) => Effect.Effect<Record<string, unknown>, AIError>
  },
) {
  const decode = Schema.decodeUnknownEffect(protocol.stream.event)
  const initial = (request: LLMRequest) => ({
    inner: protocol.stream.initial(request),
    metadata: undefined as ProviderMetadata | undefined,
  })
  const onHalt = protocol.stream.onHalt
  const merge = (...items: ReadonlyArray<ProviderMetadata | undefined>): ProviderMetadata | undefined => {
    const defined = items.filter((item) => item !== undefined)
    if (defined.length === 0) return undefined
    return Object.fromEntries(
      Array.from(new Set(defined.flatMap((item) => Object.keys(item)))).map((key) => [
        key,
        mergeJsonRecords(...defined.map((item) => item[key])) ?? {},
      ]),
    )
  }
  const enrich = (events: ReadonlyArray<LLMEvent>, metadata: ProviderMetadata | undefined) =>
    events.map((event) =>
      LLMEvent.is.finish(event) || LLMEvent.is.stepFinish(event)
        ? { ...event, providerMetadata: merge(event.providerMetadata, metadata) }
        : event,
    )
  return Protocol.make({
    id: input.id,
    body: {
      schema: Schema.Record(Schema.String, Schema.Unknown),
      from: input.from,
    },
    sanitizer: protocol.sanitizer,
    // Gateway feature support is verified separately; do not inherit upstream-only chronological effort updates.
    stream: {
      event: Schema.Union([Schema.Literal("[DONE]"), Protocol.jsonEvent(Event)]),
      initial,
      step: Effect.fn("GatewayProtocol.step")(function* (
        state: ReturnType<typeof initial>,
        event: typeof Event.Type | "[DONE]",
      ) {
        const decoded = yield* decode(event === "[DONE]" ? event : ProviderShared.encodeJson(event)).pipe(
          Effect.mapError((cause) => ProviderShared.eventError(input.id, "Invalid gateway event", undefined, cause)),
        )
        const metadata =
          event === "[DONE]"
            ? state.metadata
            : merge(
                state.metadata,
                event.provider_metadata,
                event.providerMetadata,
                event.message?.provider_metadata,
                event.message?.providerMetadata,
                event.response?.provider_metadata,
                event.response?.providerMetadata,
                ...(event.choices ?? []).flatMap((choice) => [
                  choice.delta?.provider_metadata,
                  choice.delta?.providerMetadata,
                ]),
              )
        const result = yield* protocol.stream.step(state.inner, decoded)
        return [{ inner: result[0], metadata }, enrich(result[1], metadata)] as const
      }),
      terminal: (event) =>
        event === "[DONE]" ||
        event.type === "response.completed" ||
        event.type === "response.incomplete" ||
        event.type === "response.failed",
      onHalt: onHalt
        ? (state) => onHalt(state.inner).pipe(Effect.map((events) => enrich(events, state.metadata)))
        : undefined,
    },
  })
}
