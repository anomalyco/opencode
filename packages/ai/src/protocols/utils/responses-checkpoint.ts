import { Effect, Schema, Stream } from "effect"
import { Route, type RouteBody, type TriggerCompactOperation } from "../../route/client.js"
import { Protocol } from "../../route/protocol.js"
import { CompactionCheckpointResponse, CompactionPart, HttpOptions, LLMEvent, LLMRequest } from "../../schema/index.js"
import { OpenResponses } from "../open-responses.js"
import { ProviderShared } from "../shared.js"

interface State {
  readonly parser: Pick<OpenResponses.ParserState, "id" | "provider" | "outputItems">
  readonly checkpoints: Readonly<Record<string, CompactionPart>>
  readonly responseID?: string
}

const onOutputItem = Effect.fn("ResponsesCheckpoint.onOutputItem")(function* (
  state: State,
  input: OpenResponses.Event,
) {
  const event = OpenResponses.normalize(state.parser, input)
  const item = event.item
  if (!item) return state
  const parser =
    event.output_index === undefined
      ? state.parser
      : { ...state.parser, outputItems: { ...state.parser.outputItems, [event.output_index]: item.id } }
  if (event.type === "response.output_item.added" || item.type !== "compaction") return { ...state, parser }
  if (
    event.output_index !== undefined &&
    Object.entries(state.parser.outputItems).some(
      ([index, id]) => id === item.id && Number(index) !== event.output_index,
    )
  )
    return yield* ProviderShared.eventError(parser.id, "Compaction checkpoint appeared in multiple output slots")
  if (!item.encrypted_content)
    return yield* ProviderShared.eventError(parser.id, "Compaction output is missing its encrypted content")
  const previous = state.checkpoints[item.id]
  if (previous && previous.encrypted !== item.encrypted_content)
    return yield* ProviderShared.eventError(parser.id, "Compaction output changed after completion")
  return {
    ...state,
    parser,
    checkpoints: {
      ...state.checkpoints,
      [item.id]: CompactionPart.make({ provider: parser.provider, id: item.id, encrypted: item.encrypted_content }),
    },
  }
})

/** Collect a trigger response before acknowledging transport completion. No generation output escapes. */
export const make = <Body>(body: RouteBody<Body>): TriggerCompactOperation =>
  Effect.fn("ResponsesCheckpoint.execute")(function* (request, executor, options) {
    const source = request.model.route
    let result: CompactionCheckpointResponse | undefined
    // Route registries erase the frame type. The codec validates that boundary before parsing.
    const event: Schema.Codec<OpenResponses.Event, unknown> = OpenResponses.protocol.stream.event
    const protocol = Protocol.make({
      id: source.protocol,
      body,
      stream: {
        event,
        initial: (request: LLMRequest): State => ({
          parser: { id: source.id, provider: request.model.provider, outputItems: {} },
          checkpoints: {},
        }),
        terminal: OpenResponses.terminal,
        step: Effect.fn("ResponsesCheckpoint.step")(function* (state: State, event: OpenResponses.Event) {
          if (event.response?.id && state.responseID && event.response.id !== state.responseID)
            return yield* ProviderShared.eventError(source.id, "Compaction response ID changed during execution")
          if (event.type === "response.created") return [{ ...state, responseID: event.response?.id }, []] as const
          if (event.type === "error" || event.type === "response.failed")
            return yield* OpenResponses.providerFailure(event, "Compaction request failed")
          if (event.type === "response.incomplete")
            return yield* ProviderShared.eventError(source.id, "Compaction response was incomplete")
          if (event.type === "response.output_item.added" || event.type === "response.output_item.done")
            return [yield* onOutputItem(state, event), []] as const
          if (event.type !== "response.completed") return [state, []] as const
          const responseID = event.response?.id
          if (!responseID?.trim())
            return yield* ProviderShared.eventError(source.id, "Compaction response is missing its response ID")
          if (event.response?.status !== undefined && event.response.status !== "completed")
            return yield* ProviderShared.eventError(source.id, "Compaction response did not complete successfully")
          let next = state
          for (const [index, item] of (event.response?.output ?? []).entries()) {
            next = yield* onOutputItem(next, { type: "response.output_item.done", output_index: index, item })
          }
          const checkpoints = Object.values(next.checkpoints)
          const checkpoint = checkpoints[0]
          if (checkpoints.length !== 1 || !checkpoint?.encrypted)
            return yield* ProviderShared.eventError(
              source.id,
              "Compaction response must contain exactly one checkpoint",
            )
          result = new CompactionCheckpointResponse({
            checkpoint: { ...checkpoint, encrypted: checkpoint.encrypted, text: undefined },
            responseID,
            usage: OpenResponses.mapUsage(event.response?.usage, OpenResponses.metadataKey(request.model)),
          })
          return [next, [LLMEvent.finish({ reason: { normalized: "stop" } })]] as const
        }),
      },
    })
    const route = Route.make({
      id: source.id,
      provider: source.provider,
      providerMetadataKey: source.providerMetadataKey,
      protocol,
      endpoint: source.endpoint,
      auth: source.auth,
      transport: source.transport,
    })
    const native = yield* body
      .from(request)
      .pipe(Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(body.schema))))
    // The body builder already applied and validated overlays. Do not let transport reapply them.
    const preparedRequest = LLMRequest.update(request, {
      http: request.http === undefined ? undefined : new HttpOptions({ ...request.http, body: undefined }),
    })
    const prepared = yield* route.prepareTransport(native, preparedRequest, options)
    yield* route.streamPrepared(prepared, preparedRequest, { http: executor }, options).pipe(Stream.runDrain)
    if (!result) return yield* ProviderShared.eventError(source.id, "Compaction response ended without a checkpoint")
    return result
  })

export * as ResponsesCheckpoint from "./responses-checkpoint.js"
