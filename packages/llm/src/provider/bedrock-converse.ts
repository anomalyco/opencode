import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { AwsV4Signer } from "aws4fetch"
import { Effect, Option, Schema, Stream } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  Usage,
  type CacheHint,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type MediaPart,
  type ProviderChunkError,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
} from "../schema"
import { ProviderShared } from "./shared"

const ADAPTER = "bedrock-converse"

/**
 * AWS credentials for SigV4 signing. Bedrock also supports Bearer API key auth
 * — pass the key as `model.headers.authorization = "Bearer <key>"` to take that
 * path instead. STS-vended credentials should be refreshed by the consumer
 * (rebuild the model) before they expire; the adapter does not refresh.
 */
export interface BedrockCredentials {
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

export type BedrockConverseModelInput = Omit<ModelInput, "provider" | "protocol" | "headers"> & {
  /**
   * Bearer API key (Bedrock's newer API key auth). Sets the `Authorization`
   * header and bypasses SigV4 signing. Mutually exclusive with `credentials`.
   */
  readonly apiKey?: string
  /**
   * AWS credentials for SigV4 signing. The adapter signs each request at
   * `toHttp` time using `aws4fetch`. Mutually exclusive with `apiKey`.
   */
  readonly credentials?: BedrockCredentials
  readonly headers?: Record<string, string>
}

const BedrockTextBlock = Schema.Struct({
  text: Schema.String,
})
type BedrockTextBlock = Schema.Schema.Type<typeof BedrockTextBlock>

const BedrockToolUseBlock = Schema.Struct({
  toolUse: Schema.Struct({
    toolUseId: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
})
type BedrockToolUseBlock = Schema.Schema.Type<typeof BedrockToolUseBlock>

const BedrockToolResultContentItem = Schema.Union([
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ json: Schema.Unknown }),
])

const BedrockToolResultBlock = Schema.Struct({
  toolResult: Schema.Struct({
    toolUseId: Schema.String,
    content: Schema.Array(BedrockToolResultContentItem),
    status: Schema.optional(Schema.Literals(["success", "error"])),
  }),
})
type BedrockToolResultBlock = Schema.Schema.Type<typeof BedrockToolResultBlock>

const BedrockReasoningBlock = Schema.Struct({
  reasoningContent: Schema.Struct({
    reasoningText: Schema.optional(
      Schema.Struct({
        text: Schema.String,
        signature: Schema.optional(Schema.String),
      }),
    ),
  }),
})

// Image block. Bedrock Converse accepts `format` as the file extension and
// `source.bytes` as a base64 string (binary upload via base64 in the JSON
// wire format). Supported formats per the Converse docs: png, jpeg, gif, webp.
const BedrockImageFormat = Schema.Literals(["png", "jpeg", "gif", "webp"])
type BedrockImageFormat = Schema.Schema.Type<typeof BedrockImageFormat>
const BedrockImageBlock = Schema.Struct({
  image: Schema.Struct({
    format: BedrockImageFormat,
    source: Schema.Struct({ bytes: Schema.String }),
  }),
})
type BedrockImageBlock = Schema.Schema.Type<typeof BedrockImageBlock>

// Document block. Required `name` is the user-facing filename so the model
// can reference it. Supported formats per the Converse docs: pdf, csv, doc,
// docx, xls, xlsx, html, txt, md.
const BedrockDocumentFormat = Schema.Literals([
  "pdf",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "html",
  "txt",
  "md",
])
type BedrockDocumentFormat = Schema.Schema.Type<typeof BedrockDocumentFormat>
const BedrockDocumentBlock = Schema.Struct({
  document: Schema.Struct({
    format: BedrockDocumentFormat,
    name: Schema.String,
    source: Schema.Struct({ bytes: Schema.String }),
  }),
})
type BedrockDocumentBlock = Schema.Schema.Type<typeof BedrockDocumentBlock>

// Cache breakpoint marker. Inserted positionally between content blocks (or
// after a system text / tool spec) to mark the prefix as cacheable. Bedrock
// Converse currently exposes `default` as the only cache-point type.
const BedrockCachePointBlock = Schema.Struct({
  cachePoint: Schema.Struct({ type: Schema.Literal("default") }),
})
type BedrockCachePointBlock = Schema.Schema.Type<typeof BedrockCachePointBlock>

const BedrockUserBlock = Schema.Union([
  BedrockTextBlock,
  BedrockImageBlock,
  BedrockDocumentBlock,
  BedrockToolResultBlock,
  BedrockCachePointBlock,
])
type BedrockUserBlock = Schema.Schema.Type<typeof BedrockUserBlock>

const BedrockAssistantBlock = Schema.Union([
  BedrockTextBlock,
  BedrockReasoningBlock,
  BedrockToolUseBlock,
  BedrockCachePointBlock,
])
type BedrockAssistantBlock = Schema.Schema.Type<typeof BedrockAssistantBlock>

const BedrockMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Array(BedrockUserBlock) }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Array(BedrockAssistantBlock) }),
])
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>

const BedrockSystemBlock = Schema.Union([BedrockTextBlock, BedrockCachePointBlock])
type BedrockSystemBlock = Schema.Schema.Type<typeof BedrockSystemBlock>

const BedrockTool = Schema.Struct({
  toolSpec: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    inputSchema: Schema.Struct({
      json: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }),
})
type BedrockTool = Schema.Schema.Type<typeof BedrockTool>

const BedrockToolChoice = Schema.Union([
  Schema.Struct({ auto: Schema.Struct({}) }),
  Schema.Struct({ any: Schema.Struct({}) }),
  Schema.Struct({ tool: Schema.Struct({ name: Schema.String }) }),
])

const BedrockTargetFields = {
  modelId: Schema.String,
  messages: Schema.Array(BedrockMessage),
  system: Schema.optional(Schema.Array(BedrockSystemBlock)),
  inferenceConfig: Schema.optional(
    Schema.Struct({
      maxTokens: Schema.optional(Schema.Number),
      temperature: Schema.optional(Schema.Number),
      topP: Schema.optional(Schema.Number),
      stopSequences: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
  toolConfig: Schema.optional(
    Schema.Struct({
      tools: Schema.Array(BedrockTool),
      toolChoice: Schema.optional(BedrockToolChoice),
    }),
  ),
  additionalModelRequestFields: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}
const BedrockConverseDraft = Schema.Struct(BedrockTargetFields)
type BedrockConverseDraft = Schema.Schema.Type<typeof BedrockConverseDraft>
const BedrockConverseTarget = Schema.Struct(BedrockTargetFields)
export type BedrockConverseTarget = Schema.Schema.Type<typeof BedrockConverseTarget>

const BedrockUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  cacheReadInputTokens: Schema.optional(Schema.Number),
  cacheWriteInputTokens: Schema.optional(Schema.Number),
})
type BedrockUsageSchema = Schema.Schema.Type<typeof BedrockUsageSchema>

// Streaming chunk shape — the AWS event stream wraps each JSON payload by its
// `:event-type` header (e.g. `messageStart`, `contentBlockDelta`). We
// reconstruct that wrapping in `decodeFrames` below so the chunk schema can
// stay a plain discriminated record.
const BedrockChunk = Schema.Struct({
  messageStart: Schema.optional(Schema.Struct({ role: Schema.String })),
  contentBlockStart: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      start: Schema.optional(
        Schema.Struct({
          toolUse: Schema.optional(
            Schema.Struct({ toolUseId: Schema.String, name: Schema.String }),
          ),
        }),
      ),
    }),
  ),
  contentBlockDelta: Schema.optional(
    Schema.Struct({
      contentBlockIndex: Schema.Number,
      delta: Schema.optional(
        Schema.Struct({
          text: Schema.optional(Schema.String),
          toolUse: Schema.optional(Schema.Struct({ input: Schema.String })),
          reasoningContent: Schema.optional(
            Schema.Struct({
              text: Schema.optional(Schema.String),
              signature: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    }),
  ),
  contentBlockStop: Schema.optional(Schema.Struct({ contentBlockIndex: Schema.Number })),
  messageStop: Schema.optional(
    Schema.Struct({
      stopReason: Schema.String,
      additionalModelResponseFields: Schema.optional(Schema.Unknown),
    }),
  ),
  metadata: Schema.optional(
    Schema.Struct({
      usage: Schema.optional(BedrockUsageSchema),
      metrics: Schema.optional(Schema.Unknown),
    }),
  ),
  internalServerException: Schema.optional(Schema.Struct({ message: Schema.String })),
  modelStreamErrorException: Schema.optional(Schema.Struct({ message: Schema.String })),
  validationException: Schema.optional(Schema.Struct({ message: Schema.String })),
  throttlingException: Schema.optional(Schema.Struct({ message: Schema.String })),
  serviceUnavailableException: Schema.optional(Schema.Struct({ message: Schema.String })),
})
type BedrockChunk = Schema.Schema.Type<typeof BedrockChunk>

// The eventstream codec already gives us a UTF-8 payload that we parse once
// per frame; we then wrap it under the `:event-type` key and hand the parsed
// object to `decodeChunkSync`. This keeps a single JSON parse per frame —
// avoid `Schema.fromJsonString` here which would add an extra decode/encode
// roundtrip.
const decodeChunkSync = Schema.decodeUnknownSync(BedrockChunk)

const decodeChunk = (data: unknown) =>
  Effect.try({
    try: () => decodeChunkSync(data),
    catch: () =>
      ProviderShared.chunkError(
        ADAPTER,
        "Invalid Bedrock Converse stream chunk",
        typeof data === "string" ? data : JSON.stringify(data),
      ),
  })

const encodeTarget = Schema.encodeSync(Schema.fromJsonString(BedrockConverseTarget))
const decodeTarget = Schema.decodeUnknownEffect(BedrockConverseDraft.pipe(Schema.decodeTo(BedrockConverseTarget)))

const invalid = ProviderShared.invalidRequest

const region = (request: LLMRequest) => {
  const fromNative = request.model.native?.aws_region
  if (typeof fromNative === "string" && fromNative !== "") return fromNative
  return "us-east-1"
}

const baseUrl = (request: LLMRequest) => {
  const configured = request.model.baseURL
  if (configured) return configured.replace(/\/+$/, "")
  return `https://bedrock-runtime.${region(request)}.amazonaws.com`
}

const lowerTool = (tool: ToolDefinition): BedrockTool => ({
  toolSpec: {
    name: tool.name,
    description: tool.description,
    inputSchema: { json: tool.inputSchema },
  },
})

// Bedrock cache markers are positional — emit a `cachePoint` block right after
// the content the caller wants treated as a cacheable prefix. Bedrock currently
// exposes one cache-point type (`default`); both `ephemeral` and `persistent`
// hints from the common `CacheHint` shape map onto it. Other cache-hint types
// (none today) would need explicit handling.
//
// TODO: Bedrock recently added optional `ttl: "5m" | "1h"` on cachePoint —
// once we have a recorded cassette to validate the wire shape, map
// `CacheHint.ttlSeconds` here.
const CACHE_POINT_DEFAULT: BedrockCachePointBlock = { cachePoint: { type: "default" } }

const cachePointBlock = (cache: CacheHint | undefined): BedrockCachePointBlock | undefined => {
  if (cache?.type !== "ephemeral" && cache?.type !== "persistent") return undefined
  return CACHE_POINT_DEFAULT
}

// Emit a text block followed by an optional positional cache marker. Used by
// system, user-text, and assistant-text lowering — all three share the same
// "push text, push cachePoint if cache hint is present" shape. The return type
// is the lowest common denominator (text | cachePoint) so callers can spread
// it into any of the three block-union arrays.
const textWithCache = (
  text: string,
  cache: CacheHint | undefined,
): Array<BedrockTextBlock | BedrockCachePointBlock> => {
  const cachePoint = cachePointBlock(cache)
  return cachePoint ? [{ text }, cachePoint] : [{ text }]
}

// MIME type → Bedrock format mapping. Bedrock distinguishes image vs document
// by the top-level block type, not the mediaType, so `lowerMedia` routes by
// the `image/` prefix and the leaf functions look up the format. `image/jpg`
// is included as a non-standard alias commonly seen in user-supplied data.
const IMAGE_FORMATS = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const satisfies Record<string, BedrockImageFormat>

const DOCUMENT_FORMATS = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/plain": "txt",
  "text/markdown": "md",
} as const satisfies Record<string, BedrockDocumentFormat>

// Bedrock document blocks require a name; default to the filename if the
// caller supplied one, otherwise generate a stable placeholder so the model
// still sees a valid block.
const lowerImage = (part: MediaPart, mime: string) => {
  const format = IMAGE_FORMATS[mime as keyof typeof IMAGE_FORMATS]
  if (!format) return invalid(`Bedrock Converse does not support image media type ${part.mediaType}`)
  return Effect.succeed<BedrockImageBlock>({
    image: { format, source: { bytes: ProviderShared.mediaBytes(part) } },
  })
}

const lowerDocument = (part: MediaPart, mime: string) => {
  const format = DOCUMENT_FORMATS[mime as keyof typeof DOCUMENT_FORMATS]
  if (!format) return invalid(`Bedrock Converse does not support document media type ${part.mediaType}`)
  return Effect.succeed<BedrockDocumentBlock>({
    document: {
      format,
      name: part.filename ?? `document.${format}`,
      source: { bytes: ProviderShared.mediaBytes(part) },
    },
  })
}

const lowerMedia = (part: MediaPart) => {
  const mime = part.mediaType.toLowerCase()
  return mime.startsWith("image/") ? lowerImage(part, mime) : lowerDocument(part, mime)
}

const lowerToolChoice = Effect.fn("BedrockConverse.lowerToolChoice")(function* (
  toolChoice: NonNullable<LLMRequest["toolChoice"]>,
) {
  if (toolChoice.type === "none") return undefined
  if (toolChoice.type === "required") return { any: {} } as const
  if (toolChoice.type !== "tool") return { auto: {} } as const
  if (!toolChoice.name) return yield* invalid("Bedrock Converse tool choice requires a tool name")
  return { tool: { name: toolChoice.name } } as const
})

const lowerToolCall = (part: ToolCallPart): BedrockToolUseBlock => ({
  toolUse: {
    toolUseId: part.id,
    name: part.name,
    input: part.input,
  },
})

const lowerToolResult = (part: ToolResultPart): BedrockToolResultBlock => ({
  toolResult: {
    toolUseId: part.id,
    content:
      part.result.type === "text" || part.result.type === "error"
        ? [{ text: String(part.result.value) }]
        : [{ json: part.result.value }],
    status: part.result.type === "error" ? "error" : "success",
  },
})

const lowerMessages = Effect.fn("BedrockConverse.lowerMessages")(function* (request: LLMRequest) {
  const messages: BedrockMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: BedrockUserBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(...textWithCache(part.text, part.cache))
          continue
        }
        if (part.type === "media") {
          content.push(yield* lowerMedia(part))
          continue
        }
        return yield* invalid("Bedrock Converse user messages only support text and media content for now")
      }
      messages.push({ role: "user", content })
      continue
    }

    if (message.role === "assistant") {
      const content: BedrockAssistantBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push(...textWithCache(part.text, part.cache))
          continue
        }
        if (part.type === "reasoning") {
          content.push({
            reasoningContent: {
              reasoningText: { text: part.text, signature: part.encrypted },
            },
          })
          continue
        }
        if (part.type === "tool-call") {
          content.push(lowerToolCall(part))
          continue
        }
        return yield* invalid("Bedrock Converse assistant messages only support text, reasoning, and tool-call content for now")
      }
      messages.push({ role: "assistant", content })
      continue
    }

    const content: BedrockToolResultBlock[] = []
    for (const part of message.content) {
      if (part.type !== "tool-result")
        return yield* invalid("Bedrock Converse tool messages only support tool-result content")
      content.push(lowerToolResult(part))
    }
    messages.push({ role: "user", content })
  }

  return messages
})

// System prompts share the cache-point convention: emit the text block, then
// optionally a positional `cachePoint` marker.
const lowerSystem = (system: ReadonlyArray<LLMRequest["system"][number]>): BedrockSystemBlock[] =>
  system.flatMap((part) => textWithCache(part.text, part.cache))

const prepare = Effect.fn("BedrockConverse.prepare")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  return {
    modelId: request.model.id,
    messages: yield* lowerMessages(request),
    system: request.system.length === 0 ? undefined : lowerSystem(request.system),
    inferenceConfig:
      request.generation.maxTokens === undefined &&
      request.generation.temperature === undefined &&
      request.generation.topP === undefined &&
      (request.generation.stop === undefined || request.generation.stop.length === 0)
        ? undefined
        : {
            maxTokens: request.generation.maxTokens,
            temperature: request.generation.temperature,
            topP: request.generation.topP,
            stopSequences: request.generation.stop,
          },
    toolConfig:
      request.tools.length > 0 && request.toolChoice?.type !== "none"
        ? { tools: request.tools.map(lowerTool), toolChoice }
        : undefined,
  }
})

// Credentials live on `model.native.aws_credentials` so the OpenCode bridge
// can resolve them via `@aws-sdk/credential-providers` and stuff them in
// without exposing the auth machinery to the rest of the LLM core. Schema
// decode keeps this boundary honest — anything that doesn't match the shape
// is treated as "no credentials".
const NativeCredentials = Schema.Struct({
  accessKeyId: Schema.String,
  secretAccessKey: Schema.String,
  region: Schema.optional(Schema.String),
  sessionToken: Schema.optional(Schema.String),
})
const decodeNativeCredentials = Schema.decodeUnknownOption(NativeCredentials)

const credentialsFromInput = (request: LLMRequest): BedrockCredentials | undefined =>
  decodeNativeCredentials(request.model.native?.aws_credentials).pipe(
    Option.map((creds) => ({ ...creds, region: creds.region ?? region(request) })),
    Option.getOrUndefined,
  )

const isBearerAuth = (headers: Record<string, string> | undefined) => {
  const auth = headers?.authorization ?? headers?.Authorization
  return typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
}

const signRequest = (input: {
  readonly url: string
  readonly body: string
  readonly headers: Record<string, string>
  readonly credentials: BedrockCredentials
}) =>
  Effect.tryPromise({
    try: async () => {
      const signed = await new AwsV4Signer({
        url: input.url,
        method: "POST",
        headers: Object.entries(input.headers),
        body: input.body,
        region: input.credentials.region,
        accessKeyId: input.credentials.accessKeyId,
        secretAccessKey: input.credentials.secretAccessKey,
        sessionToken: input.credentials.sessionToken,
        service: "bedrock",
      }).sign()
      return Object.fromEntries(signed.headers.entries())
    },
    catch: (error) =>
      invalid(`Bedrock Converse SigV4 signing failed: ${error instanceof Error ? error.message : String(error)}`),
  })

const toHttp = Effect.fn("BedrockConverse.toHttp")(function* (target: BedrockConverseTarget, request: LLMRequest) {
  const url = `${baseUrl(request)}/model/${encodeURIComponent(target.modelId)}/converse-stream`
  const body = encodeTarget(target)
  const baseHeaders: Record<string, string> = {
    ...request.model.headers,
    "content-type": "application/json",
  }

  if (isBearerAuth(request.model.headers)) {
    return ProviderShared.jsonPost({ url, body, headers: request.model.headers })
  }

  const credentials = credentialsFromInput(request)
  if (!credentials) {
    return yield* invalid(
      "Bedrock Converse requires either a Bearer API key in headers or AWS credentials in model.native.aws_credentials",
    )
  }
  // SigV4 signs the request including content-type; keep `baseHeaders` so the
  // signed payload matches what `jsonPost` ultimately sends.
  const signed = yield* signRequest({ url, body, headers: baseHeaders, credentials })
  return ProviderShared.jsonPost({ url, body, headers: { ...baseHeaders, ...signed } })
})

const mapFinishReason = (reason: string): FinishReason => {
  if (reason === "end_turn" || reason === "stop_sequence") return "stop"
  if (reason === "max_tokens") return "length"
  if (reason === "tool_use") return "tool-calls"
  if (reason === "content_filtered" || reason === "guardrail_intervened") return "content-filter"
  return "unknown"
}

const mapUsage = (usage: BedrockUsageSchema | undefined): Usage | undefined => {
  if (!usage) return undefined
  return new Usage({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens:
      usage.totalTokens ??
      ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) || undefined),
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    native: usage,
  })
}

interface ToolAccumulator {
  readonly id: string
  readonly name: string
  readonly input: string
}

interface ParserState {
  readonly tools: Record<number, ToolAccumulator>
  // Bedrock splits the finish into `messageStop` (carries `stopReason`) and
  // `metadata` (carries usage). The raw stop reason is held here until
  // `metadata` arrives, then mapped + emitted together as a single terminal
  // `request-finish` event so consumers see one event with both.
  readonly pendingStopReason: string | undefined
}

const finishToolCall = (tool: ToolAccumulator | undefined) =>
  Effect.gen(function* () {
    if (!tool) return [] as ReadonlyArray<LLMEvent>
    const input = yield* ProviderShared.parseToolInput(ADAPTER, tool.name, tool.input)
    return [{ type: "tool-call" as const, id: tool.id, name: tool.name, input }]
  })

const processChunk = (state: ParserState, chunk: BedrockChunk) =>
  Effect.gen(function* () {
    if (chunk.contentBlockStart?.start?.toolUse) {
      const index = chunk.contentBlockStart.contentBlockIndex
      return [
        {
          ...state,
          tools: {
            ...state.tools,
            [index]: {
              id: chunk.contentBlockStart.start.toolUse.toolUseId,
              name: chunk.contentBlockStart.start.toolUse.name,
              input: "",
            },
          },
        },
        [],
      ] as const
    }

    if (chunk.contentBlockDelta?.delta?.text) {
      return [state, [{ type: "text-delta" as const, text: chunk.contentBlockDelta.delta.text }]] as const
    }

    if (chunk.contentBlockDelta?.delta?.reasoningContent?.text) {
      return [
        state,
        [{ type: "reasoning-delta" as const, text: chunk.contentBlockDelta.delta.reasoningContent.text }],
      ] as const
    }

    if (chunk.contentBlockDelta?.delta?.toolUse) {
      const index = chunk.contentBlockDelta.contentBlockIndex
      const current = state.tools[index]
      if (!current) {
        return yield* ProviderShared.chunkError(ADAPTER, "Bedrock Converse tool delta is missing its tool call")
      }
      const next = { ...current, input: `${current.input}${chunk.contentBlockDelta.delta.toolUse.input}` }
      return [
        { ...state, tools: { ...state.tools, [index]: next } },
        [
          {
            type: "tool-input-delta" as const,
            id: next.id,
            name: next.name,
            text: chunk.contentBlockDelta.delta.toolUse.input,
          },
        ],
      ] as const
    }

    if (chunk.contentBlockStop) {
      const events = yield* finishToolCall(state.tools[chunk.contentBlockStop.contentBlockIndex])
      const { [chunk.contentBlockStop.contentBlockIndex]: _, ...tools } = state.tools
      return [{ ...state, tools }, events] as const
    }

    if (chunk.messageStop) {
      // Stash the reason — emit `request-finish` once `metadata` arrives with
      // usage, so consumers see one terminal event carrying both. If metadata
      // never arrives the `onHalt` fallback emits a usage-less finish.
      return [{ ...state, pendingStopReason: chunk.messageStop.stopReason }, []] as const
    }

    if (chunk.metadata) {
      const reason = state.pendingStopReason ? mapFinishReason(state.pendingStopReason) : "stop"
      const usage = mapUsage(chunk.metadata.usage)
      return [
        { ...state, pendingStopReason: undefined },
        [{ type: "request-finish" as const, reason, usage }],
      ] as const
    }

    if (chunk.internalServerException || chunk.modelStreamErrorException || chunk.serviceUnavailableException) {
      const message =
        chunk.internalServerException?.message ??
        chunk.modelStreamErrorException?.message ??
        chunk.serviceUnavailableException?.message ??
        "Bedrock Converse stream error"
      return [state, [{ type: "provider-error" as const, message, retryable: true }]] as const
    }

    if (chunk.validationException || chunk.throttlingException) {
      const message =
        chunk.validationException?.message ?? chunk.throttlingException?.message ?? "Bedrock Converse error"
      return [
        state,
        [{ type: "provider-error" as const, message, retryable: chunk.throttlingException !== undefined }],
      ] as const
    }

    return [state, []] as const
  })

// Bedrock streams responses using the AWS event stream binary protocol — each
// frame is `[length:4][headers-length:4][prelude-crc:4][headers][payload][crc:4]`.
// We use `@smithy/eventstream-codec` to validate framing and CRCs, then
// reconstruct the JSON wrapping by `:event-type` so the chunk schema can match.
const eventCodec = new EventStreamCodec(toUtf8, fromUtf8)
const utf8 = new TextDecoder()

// Cursor-tracking buffer state. Bytes accumulate in `buffer`; `offset` is the
// read position. Reading by `subarray` is zero-copy. We only allocate a fresh
// buffer when (a) a new network chunk arrives and we need to append, or (b)
// the consumed prefix is more than half the buffer (compaction).
interface FrameBufferState {
  readonly buffer: Uint8Array
  readonly offset: number
}

const initialFrameBuffer: FrameBufferState = { buffer: new Uint8Array(0), offset: 0 }

const appendChunk = (state: FrameBufferState, chunk: Uint8Array): FrameBufferState => {
  const remaining = state.buffer.length - state.offset
  // Compact: drop the consumed prefix and append the new chunk in one alloc.
  // This bounds buffer growth to at most one network chunk past the live
  // window, regardless of stream length.
  const next = new Uint8Array(remaining + chunk.length)
  next.set(state.buffer.subarray(state.offset), 0)
  next.set(chunk, remaining)
  return { buffer: next, offset: 0 }
}

const consumeFrames = (state: FrameBufferState, chunk: Uint8Array) =>
  Effect.gen(function* () {
    let cursor = appendChunk(state, chunk)
    const out: object[] = []
    while (cursor.buffer.length - cursor.offset >= 4) {
      const view = cursor.buffer.subarray(cursor.offset)
      const totalLength = new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(0, false)
      if (view.length < totalLength) break

      const decoded = yield* Effect.try({
        try: () => eventCodec.decode(view.subarray(0, totalLength)),
        catch: (error) =>
          ProviderShared.chunkError(
            ADAPTER,
            `Failed to decode Bedrock Converse event-stream frame: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      })
      cursor = { buffer: cursor.buffer, offset: cursor.offset + totalLength }

      if (decoded.headers[":message-type"]?.value !== "event") continue
      const eventType = decoded.headers[":event-type"]?.value
      if (typeof eventType !== "string") continue
      const payload = utf8.decode(decoded.body)
      if (!payload) continue
      // The AWS event stream pads short payloads with a `p` field. Drop it
      // before handing the object to the chunk schema.
      const parsed = JSON.parse(payload) as Record<string, unknown>
      delete parsed.p
      out.push({ [eventType]: parsed })
    }
    return [cursor, out] as const
  })

// AWS event-stream framing: byte stream → already-parsed chunk objects.
// `mapAccumEffect` flattens the per-step `ReadonlyArray` so the downstream
// stream sees one parsed object per emitted frame.
const eventStreamFraming = (bytes: Stream.Stream<Uint8Array, ProviderChunkError>) =>
  bytes.pipe(Stream.mapAccumEffect(() => initialFrameBuffer, consumeFrames))

// If a stream ends after `messageStop` but before `metadata` (rare but
// possible on truncated transports), still surface a terminal finish.
const onHalt = (state: ParserState): ReadonlyArray<LLMEvent> =>
  state.pendingStopReason
    ? [{ type: "request-finish", reason: mapFinishReason(state.pendingStopReason) }]
    : []

const parseStream = (response: HttpClientResponse.HttpClientResponse) =>
  ProviderShared.framed({
    adapter: ADAPTER,
    response,
    readError: "Failed to read Bedrock Converse stream",
    framing: eventStreamFraming,
    decodeChunk,
    initial: (): ParserState => ({ tools: {}, pendingStopReason: undefined }),
    process: processChunk,
    onHalt,
  })

export const adapter = Adapter.define<BedrockConverseDraft, BedrockConverseTarget>({
  id: ADAPTER,
  protocol: "bedrock-converse",
  redact: (target) => target,
  prepare,
  validate: ProviderShared.validateWith(decodeTarget),
  toHttp: (target, context) => toHttp(target, context.request),
  parse: parseStream,
})

export const model = (input: BedrockConverseModelInput) => {
  const { apiKey, credentials, headers, ...rest } = input
  const authHeaders = apiKey ? { ...headers, authorization: `Bearer ${apiKey}` } : headers
  return llmModel({
    ...rest,
    provider: "bedrock",
    protocol: "bedrock-converse",
    headers: authHeaders,
    capabilities:
      input.capabilities ??
      capabilities({
        output: { reasoning: true },
        tools: { calls: true, streamingInput: true },
        cache: { prompt: true, contentBlocks: true },
      }),
    native: credentials
      ? {
          ...input.native,
          aws_credentials: credentials,
          aws_region: credentials.region,
        }
      : input.native,
  })
}

export * as BedrockConverse from "./bedrock-converse"
