import { Effect, Encoding, Schema } from "effect"
import { Protocol } from "../route/protocol.js"
import { HttpTransport } from "../route/transport/index.js"
import { LLMEvent, LLMRequest, Message, ToolResultPart } from "../schema/index.js"
import { OpenResponses } from "./open-responses.js"
import { JsonObject, optionalArray, optionalNull, ProviderShared } from "./shared.js"
import { ResponsesHostedTools } from "./utils/responses-hosted-tools.js"
import { ToolSchemaProjection } from "./utils/tool-schema.js"
import { MetaImage } from "./utils/meta-image.js"

const ADAPTER = "meta-responses"
const NAME = "Meta Responses"

export const WebSearch = Schema.Struct({
  type: Schema.Literal("web_search"),
  search_context_size: Schema.optional(Schema.String),
  user_location: Schema.optional(
    Schema.Struct({
      type: Schema.Literal("approximate"),
      city: Schema.optional(Schema.String),
      region: Schema.optional(Schema.String),
      country: Schema.optional(Schema.String),
      timezone: Schema.optional(Schema.String),
    }),
  ),
})

export const ImageGeneration = Schema.Struct({
  type: Schema.Literal("image_generation"),
  size: Schema.optional(Schema.String),
  output_format: Schema.optional(Schema.String),
  reasoning_strength: Schema.optional(Schema.String),
  enable_image_search: Schema.optional(Schema.Boolean),
  enable_web_search: Schema.optional(Schema.Boolean),
  enable_shell: Schema.optional(Schema.Boolean),
})

const NativeTool = Schema.Union([WebSearch, ImageGeneration])
const ImageItem = Schema.Struct({
  type: Schema.Literal("image_generation_call"),
  id: Schema.String,
  status: Schema.optional(Schema.String),
  result: optionalNull(Schema.String),
  output_format: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
})

const Body = Schema.Struct({
  ...OpenResponses.coreFields,
  input: Schema.Array(Schema.Union([OpenResponses.InputItem, ImageItem])),
  tools: optionalArray(Schema.Union([OpenResponses.Tool, NativeTool])),
  stream: Schema.Literal(true),
})

const MessageAnnotations = Schema.Struct({
  content: Schema.Array(Schema.Struct({ annotations: optionalArray(JsonObject) })),
})

interface ParserState extends OpenResponses.ParserState {
  readonly completedItems: ReadonlySet<string>
}

const adapter = {
  id: ADAPTER,
  name: NAME,
  restoreHostedToolItem: (item: unknown) => (Schema.is(ImageItem)(item) ? item : undefined),
} satisfies OpenResponses.ProviderAdapter

const fromRequest = Effect.fn("MetaResponses.fromRequest")(function* (request: LLMRequest) {
  const key = request.model.route.providerMetadataKey ?? String(request.model.provider)
  const projected = ProviderShared.flattenToolRequest(
    LLMRequest.update(request, {
      messages: request.messages.map((message) =>
        Message.make({
          ...message,
          content: message.content.map((part) => {
            if (
              part.type !== "tool-result" ||
              !part.providerExecuted ||
              part.name !== "image_generation" ||
              part.result.type !== "content" ||
              part.providerMetadata?.[key]?.itemId !== part.id
            )
              return part
            // Meta's signed image ID carries edit state; replay the handle, not the image bytes as a user message.
            return ToolResultPart.make({
              ...part,
              result: {
                type: "json",
                value: { type: "image_generation_call", id: part.id, status: "completed", result: null },
              },
            })
          }),
        }),
      ),
    }),
  )
  return yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Body))({
    ...(yield* OpenResponses.lowerConversation(projected.request, adapter)),
    ...OpenResponses.lowerGeneration(request),
    tools:
      projected.tools.length === 0
        ? undefined
        : yield* Effect.forEach(projected.tools, (tool) =>
            Effect.gen(function* () {
              if (tool.native === undefined)
                return yield* OpenResponses.lowerTool(
                  NAME,
                  tool,
                  ToolSchemaProjection.modelCompatibility(tool.inputSchema, request.model.compatibility?.toolSchema),
                )
              return yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(NativeTool))(tool.native.meta)
            }),
          ),
    tool_choice:
      OpenResponses.allowedToolChoice(request) ??
      (request.toolChoice ? yield* OpenResponses.lowerToolChoice(NAME, request.toolChoice) : undefined),
  })
})

const HOSTED_TOOLS = {
  web_search_call: { name: "web_search", input: (item) => item.action ?? {} },
  image_generation_call: {
    name: "image_generation",
    input: () => ({}),
    result: Effect.fn("MetaResponses.imageResult")(function* (raw: ResponsesHostedTools.Item) {
      const item = yield* Schema.decodeUnknownEffect(ImageItem)(raw).pipe(
        Effect.mapError((cause) =>
          ProviderShared.eventError(
            ADAPTER,
            "Meta returned an invalid image item",
            ProviderShared.encodeJson(raw),
            cause,
          ),
        ),
      )
      if (item.error !== undefined && item.error !== null) return { type: "error" as const, value: item.error }
      if (!item.result)
        return yield* ProviderShared.eventError(
          ADAPTER,
          "Meta returned an image without data",
          ProviderShared.encodeJson(raw),
        )
      const data = yield* Effect.fromResult(Encoding.decodeBase64(item.result)).pipe(
        Effect.mapError((cause) =>
          ProviderShared.eventError(
            ADAPTER,
            "Meta returned invalid image base64",
            ProviderShared.encodeJson(raw),
            cause,
          ),
        ),
      )
      const mime = MetaImage.mediaType(data, item.output_format)
      return {
        type: "content" as const,
        value: [{ type: "file" as const, uri: `data:${mime};base64,${item.result}`, mime }],
      }
    }),
  },
} satisfies ResponsesHostedTools.Definitions

const onEvent = Effect.fn("MetaResponses.onEvent")(function* (
  state: OpenResponses.ParserState,
  input: OpenResponses.Event,
) {
  const event = OpenResponses.normalize(state, input)
  if (event.type === "response.output_item.done" && event.item && ResponsesHostedTools.isItem(event.item, HOSTED_TOOLS))
    return yield* ResponsesHostedTools.onDone(state, event.item, HOSTED_TOOLS)
  const result = yield* OpenResponses.step(state, event)
  if (event.type !== "response.output_item.done" || event.item?.type !== "message") return result
  const message = yield* Schema.decodeUnknownEffect(MessageAnnotations)(event.item).pipe(
    Effect.mapError((cause) =>
      ProviderShared.eventError(
        ADAPTER,
        "Meta returned invalid message annotations",
        ProviderShared.encodeJson(event),
        cause,
      ),
    ),
  )
  const annotations = message.content.flatMap((part) => part.annotations ?? [])
  if (annotations.length === 0) return result
  return [
    result[0],
    result[1].map((item) =>
      LLMEvent.is.textEnd(item)
        ? LLMEvent.textEnd({
            ...item,
            providerMetadata: {
              ...item.providerMetadata,
              [state.providerMetadataKey]: { ...item.providerMetadata?.[state.providerMetadataKey], annotations },
            },
          })
        : item,
    ),
  ] satisfies OpenResponses.StepResult
})

const step = Effect.fn("MetaResponses.step")(function* (state: ParserState, input: OpenResponses.Event) {
  const completedItems = new Set(state.completedItems)
  const event = OpenResponses.normalize(state, input)
  if (event.type === "response.output_item.done" && event.item && completedItems.has(event.item.id))
    return [state, []] as const
  const events: LLMEvent[] = []
  let current: OpenResponses.ParserState = state
  // Muse Image delivers its image and optional summary only in response.completed.
  // Recover terminal-only items in order, without duplicating Spark's streamed items.
  if (event.type === "response.completed") {
    for (const [index, item] of (event.response?.output ?? []).entries()) {
      const done = OpenResponses.normalize(current, { type: "response.output_item.done", item, output_index: index })
      // Spark changes reasoning IDs in the terminal snapshot; output indices still identify the streamed items.
      if (!done.item || completedItems.has(done.item.id) || completedItems.has(state.outputItems[index] ?? "")) continue
      const result = yield* onEvent(current, done)
      current = result[0]
      events.push(...result[1])
      completedItems.add(done.item.id)
    }
  }
  const result = yield* onEvent(current, event)
  if (event.type === "response.output_item.done" && event.item) completedItems.add(event.item.id)
  return [{ ...result[0], completedItems }, [...events, ...result[1]]] as const
})

export const protocol = Protocol.make({
  id: ADAPTER,
  body: { schema: Body, from: fromRequest },
  stream: {
    event: OpenResponses.protocol.stream.event,
    initial: (request): ParserState => ({ ...OpenResponses.initial(request, adapter), completedItems: new Set() }),
    step,
    terminal: OpenResponses.terminal,
  },
})

export const httpTransport = HttpTransport.sseJson.with<Schema.Schema.Type<typeof Body>>()

export * as MetaResponses from "./meta-responses.js"
