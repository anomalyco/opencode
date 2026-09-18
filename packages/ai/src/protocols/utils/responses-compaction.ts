import { Effect, Schema, Stream } from "effect"
import {
  AIError,
  InvalidProviderOutputError,
  CompactionPart,
  CompactionResponse,
  HttpOptions,
  LLMRequest,
  Message,
  type ContentPart,
  mergeJsonRecords,
} from "../../schema/index.js"
import type { CompactOperation } from "../../route/client.js"
import { Endpoint } from "../../route/endpoint.js"
import { RequestExecutor } from "../../route/executor.js"
import { HttpTransport } from "../../route/transport/index.js"
import { OpenResponses } from "../open-responses.js"
import { JsonObject, optionalNull, ProviderShared } from "../shared.js"

const Body = Schema.Struct({
  model: Schema.String,
  input: Schema.Array(Schema.Unknown),
  instructions: optionalNull(Schema.String),
  previous_response_id: optionalNull(Schema.String),
  service_tier: optionalNull(Schema.String),
  prompt_cache_key: optionalNull(Schema.String),
  prompt_cache_retention: optionalNull(Schema.String),
  prompt_cache_options: optionalNull(
    Schema.Struct({ mode: Schema.optional(Schema.String), ttl: Schema.optional(Schema.String) }),
  ),
})

const Text = Schema.Union([OpenResponses.OpenResponsesInputText, OpenResponses.OpenResponsesOutputText])
const File = Schema.Union([
  Schema.Struct({
    ...OpenResponses.OpenResponsesInputFile.fields,
    file_url: Schema.String,
    file_data: Schema.optional(Schema.Never),
  }),
  Schema.Struct({
    ...OpenResponses.OpenResponsesInputFile.fields,
    file_data: Schema.String,
    file_url: Schema.optional(Schema.Never),
  }),
])
const MessageFields = {
  type: Schema.Literal("message"),
  id: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  phase: Schema.optional(OpenResponses.MessagePhase),
}
const Response = Schema.Struct({
  object: Schema.Literal("response.compaction"),
  output: Schema.Array(
    Schema.Union([
      OpenResponses.CompactionItem,
      OpenResponses.OpenResponsesReasoningItem,
      Schema.Struct({
        ...MessageFields,
        role: Schema.Literal("user"),
        content: Schema.Array(Schema.Union([Text, OpenResponses.OpenResponsesInputImage, File])).check(
          Schema.isMinLength(1),
        ),
      }),
      Schema.Struct({
        ...MessageFields,
        role: Schema.Literal("assistant"),
        content: Schema.Array(Text).check(Schema.isMinLength(1)),
      }),
    ]),
  ),
  usage: Schema.optional(Schema.StructWithRest(OpenResponses.OpenResponsesUsage, [JsonObject])),
})

export const make = (adapter: OpenResponses.ProviderAdapter): CompactOperation =>
  Effect.fn("ResponsesCompaction.execute")(function* (request, executor, options) {
    const route = request.model.route
    const native = yield* OpenResponses.lowerConversation(request, adapter)
    const body = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(Body))(
      mergeJsonRecords(
        {
          ...native,
          service_tier: request.providerOptions?.serviceTier,
          prompt_cache_key: ProviderShared.promptCacheKey(request),
        },
        request.http?.body,
      ),
    )
    const url = Endpoint.render(route.endpoint, { request, body: native })
    url.pathname = `${url.pathname.replace(/\/$/, "")}/compact`
    const parts = yield* HttpTransport.jsonRequestParts({
      request: LLMRequest.update(request, {
        http: request.http === undefined ? undefined : new HttpOptions({ ...request.http, body: undefined }),
      }),
      body,
      endpoint: Endpoint.path(url.toString()),
      auth: route.auth,
      encodeBody: Schema.encodeSync(Schema.fromJsonString(Body)),
    })
    const response = yield* executor.execute(
      ProviderShared.jsonPost({ url: parts.url, body: parts.bodyText, headers: parts.headers }),
      options?.http,
    )
    const text = yield* RequestExecutor.responseStream(response).pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (text, chunk) => text + chunk,
      ),
    )
    const invalid = (message: string, cause?: unknown) =>
      new AIError({
        reason: new InvalidProviderOutputError({
          route: route.id,
          message,
          body: text,
          cause,
          http: RequestExecutor.responseHttp(response),
        }),
      })
    const result = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Response))(text).pipe(
      Effect.mapError((cause) => invalid("Invalid compaction response", cause)),
    )
    if (!result.output.some((item) => item.type === "compaction"))
      return yield* invalid("Compaction response did not contain a checkpoint")
    return new CompactionResponse({
      replacement: result.output.map((item) => toMessage(item, request.model)),
      usage: OpenResponses.mapUsage(result.usage, OpenResponses.metadataKey(request.model)),
    })
  })

function toMessage(item: (typeof Response.Type.output)[number], model: LLMRequest["model"]): Message {
  if (item.type === "compaction")
    return Message.assistant(
      CompactionPart.make({ provider: model.provider, id: item.id ?? undefined, encrypted: item.encrypted_content }),
    )

  const key = OpenResponses.metadataKey(model)
  if (item.type === "reasoning") {
    const summary = item.summary.length ? item.summary : [{ text: "" }]
    return Message.assistant(
      summary.map((part) => ({
        type: "reasoning" as const,
        text: part.text,
        providerMetadata: { [key]: { itemId: item.id, reasoningEncryptedContent: item.encrypted_content } },
      })),
    )
  }

  return Message.make({
    role: item.role,
    providerMetadata: { [key]: { itemId: item.id, type: item.type, status: item.status, phase: item.phase } },
    content: item.content.map((part): ContentPart => {
      if (part.type === "input_text" || part.type === "output_text") return { type: "text", text: part.text }
      if (part.type === "input_image")
        return {
          type: "media",
          data: part.image_url,
          mediaType: /^data:([^;,]+)/.exec(part.image_url)?.[1] ?? "image/*",
          providerMetadata: part.detail === undefined ? undefined : { [key]: { detail: part.detail } },
        }
      const data = part.file_url === undefined ? part.file_data : part.file_url
      return {
        type: "media",
        data,
        filename: part.filename,
        mediaType: /^data:([^;,]+)/.exec(data)?.[1] ?? "application/octet-stream",
        providerMetadata: part.detail === undefined ? undefined : { [key]: { detail: part.detail } },
      }
    }),
  })
}

export * as ResponsesCompaction from "./responses-compaction.js"
