import { EventStreamCodec } from "@smithy/eventstream-codec"
import { fromUtf8, toUtf8 } from "@smithy/util-utf8"
import { AwsV4Signer } from "aws4fetch"
import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import {
  InvalidRequestError,
  Usage,
  type FinishReason,
  type LLMEvent,
  type LLMRequest,
  type TextPart,
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

const BedrockUserBlock = Schema.Union([BedrockTextBlock, BedrockToolResultBlock])
const BedrockAssistantBlock = Schema.Union([BedrockTextBlock, BedrockReasoningBlock, BedrockToolUseBlock])
type BedrockAssistantBlock = Schema.Schema.Type<typeof BedrockAssistantBlock>

const BedrockMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Array(BedrockUserBlock) }),
  Schema.Struct({ role: Schema.Literal("assistant"), content: Schema.Array(BedrockAssistantBlock) }),
])
type BedrockMessage = Schema.Schema.Type<typeof BedrockMessage>

const BedrockSystem = Schema.Struct({ text: Schema.String })

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
  system: Schema.optional(Schema.Array(BedrockSystem)),
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

const BedrockChunkJson = Schema.fromJsonString(BedrockChunk)
const BedrockTargetJson = Schema.fromJsonString(BedrockConverseTarget)
const decodeChunkSync = Schema.decodeUnknownSync(BedrockChunkJson)

const decodeChunk = (data: string) =>
  Effect.try({
    try: () => decodeChunkSync(data),
    catch: () => ProviderShared.chunkError(ADAPTER, "Invalid Bedrock Converse stream chunk", data),
  })

const encodeTarget = Schema.encodeSync(BedrockTargetJson)
const decodeTarget = Schema.decodeUnknownEffect(BedrockConverseDraft.pipe(Schema.decodeTo(BedrockConverseTarget)))

const invalid = (message: string) => new InvalidRequestError({ message })

const region = (request: LLMRequest) => {
  const fromNative = request.model.native?.aws_region
  if (typeof fromNative === "string" && fromNative !== "") return fromNative
  if (typeof request.model.native?.region === "string") return request.model.native.region as string
  return "us-east-1"
}

const baseUrl = (request: LLMRequest) => {
  const configured = request.model.baseURL
  if (configured) return configured.replace(/\/+$/, "")
  return `https://bedrock-runtime.${region(request)}.amazonaws.com`
}

const text = (values: ReadonlyArray<{ readonly text: string }>) => values.map((part) => part.text).join("\n")

const lowerTool = (tool: ToolDefinition): BedrockTool => ({
  toolSpec: {
    name: tool.name,
    description: tool.description,
    inputSchema: { json: tool.inputSchema },
  },
})

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

const lowerToolResult = (part: ToolResultPart): BedrockToolResultBlock => {
  const status = part.result.type === "error" ? ("error" as const) : ("success" as const)
  const content =
    part.result.type === "text" || part.result.type === "error"
      ? [{ text: String(part.result.value) }]
      : [{ json: part.result.value }]
  return { toolResult: { toolUseId: part.id, content, status } }
}

const lowerMessages = Effect.fn("BedrockConverse.lowerMessages")(function* (request: LLMRequest) {
  const messages: BedrockMessage[] = []

  for (const message of request.messages) {
    if (message.role === "user") {
      const content: Array<Schema.Schema.Type<typeof BedrockUserBlock>> = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push({ text: part.text })
          continue
        }
        return yield* invalid("Bedrock Converse user messages only support text content for now")
      }
      messages.push({ role: "user", content })
      continue
    }

    if (message.role === "assistant") {
      const content: BedrockAssistantBlock[] = []
      for (const part of message.content) {
        if (part.type === "text") {
          content.push({ text: part.text })
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

const prepare = Effect.fn("BedrockConverse.prepare")(function* (request: LLMRequest) {
  const toolChoice = request.toolChoice ? yield* lowerToolChoice(request.toolChoice) : undefined
  const useTools = request.tools.length > 0 && request.toolChoice?.type !== "none"
  return {
    modelId: request.model.id,
    messages: yield* lowerMessages(request),
    system: request.system.length === 0 ? undefined : request.system.map((part) => ({ text: part.text })),
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
    toolConfig: useTools
      ? { tools: request.tools.map(lowerTool), toolChoice }
      : undefined,
  }
})

const credentialsFromInput = (request: LLMRequest): BedrockCredentials | undefined => {
  const native = request.model.native
  if (!native) return undefined
  const creds = native.aws_credentials
  if (!creds || typeof creds !== "object") return undefined
  const obj = creds as Record<string, unknown>
  if (typeof obj.accessKeyId !== "string" || typeof obj.secretAccessKey !== "string") return undefined
  return {
    region: typeof obj.region === "string" ? obj.region : region(request),
    accessKeyId: obj.accessKeyId,
    secretAccessKey: obj.secretAccessKey,
    sessionToken: typeof obj.sessionToken === "string" ? obj.sessionToken : undefined,
  }
}

const isBearerAuth = (headers: Record<string, string> | undefined) => {
  const auth = headers?.authorization ?? headers?.Authorization
  return typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
}

const signRequest = (
  url: string,
  body: string,
  headers: Record<string, string>,
  credentials: BedrockCredentials,
) =>
  Effect.tryPromise({
    try: async () => {
      const signer = new AwsV4Signer({
        url,
        method: "POST",
        headers: Object.entries(headers),
        body,
        region: credentials.region,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        service: "bedrock",
      })
      const signed = await signer.sign()
      const out: Record<string, string> = {}
      signed.headers.forEach((value, key) => {
        out[key] = value
      })
      return out
    },
    catch: (error) =>
      new InvalidRequestError({
        message: `Bedrock Converse SigV4 signing failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
  })

const toHttp = Effect.fn("BedrockConverse.toHttp")(function* (target: BedrockConverseTarget, request: LLMRequest) {
  const url = `${baseUrl(request)}/model/${encodeURIComponent(target.modelId)}/converse-stream`
  const body = encodeTarget(target)
  const baseHeaders: Record<string, string> = {
    ...request.model.headers,
    "content-type": "application/json",
  }

  if (isBearerAuth(request.model.headers)) {
    return HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders(baseHeaders),
      HttpClientRequest.bodyText(body, "application/json"),
    )
  }

  const credentials = credentialsFromInput(request)
  if (!credentials) {
    return yield* invalid(
      "Bedrock Converse requires either a Bearer API key in headers or AWS credentials in model.native.aws_credentials",
    )
  }
  const signed = yield* signRequest(url, body, baseHeaders, credentials)
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeaders({ ...baseHeaders, ...signed }),
    HttpClientRequest.bodyText(body, "application/json"),
  )
})

const mapFinishReason = (reason: string | undefined): FinishReason => {
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
  // `metadata` (carries usage). We accumulate both before emitting a single
  // `request-finish` event so consumers see one terminal event with both.
  readonly finishReason: FinishReason | undefined
}

const finishToolCall = (tool: ToolAccumulator | undefined) =>
  Effect.gen(function* () {
    if (!tool) return [] as ReadonlyArray<LLMEvent>
    const input = yield* ProviderShared.parseJson(
      ADAPTER,
      tool.input || "{}",
      `Invalid JSON input for Bedrock Converse tool call ${tool.name}`,
    )
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
      return [{ ...state, finishReason: mapFinishReason(chunk.messageStop.stopReason) }, []] as const
    }

    if (chunk.metadata) {
      const reason = state.finishReason ?? "stop"
      const usage = mapUsage(chunk.metadata.usage)
      return [
        { ...state, finishReason: undefined },
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

const concat = (left: Uint8Array, right: Uint8Array) => {
  const next = new Uint8Array(left.length + right.length)
  next.set(left)
  next.set(right, left.length)
  return next
}

const consumeFrames = (state: Uint8Array, chunk: Uint8Array) =>
  Effect.gen(function* () {
    let buffer = concat(state, chunk)
    const out: string[] = []
    while (buffer.length >= 4) {
      const totalLength = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, false)
      if (buffer.length < totalLength) break

      const decoded = yield* Effect.try({
        try: () => eventCodec.decode(buffer.subarray(0, totalLength)),
        catch: (error) =>
          ProviderShared.chunkError(
            ADAPTER,
            `Failed to decode Bedrock Converse event-stream frame: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      })
      buffer = buffer.slice(totalLength)

      if (decoded.headers[":message-type"]?.value !== "event") continue
      const eventType = decoded.headers[":event-type"]?.value
      if (typeof eventType !== "string") continue
      const payload = utf8.decode(decoded.body)
      if (!payload) continue
      // The AWS event stream pads short payloads with a `p` field. Drop it
      // before re-validating against the chunk schema.
      const parsed = JSON.parse(payload) as Record<string, unknown>
      delete parsed.p
      out.push(JSON.stringify({ [eventType]: parsed }))
    }
    return [buffer, out] as const
  })

const parseStream = (response: HttpClientResponse.HttpClientResponse) =>
  response.stream.pipe(
    Stream.mapError((error) =>
      ProviderShared.chunkError(ADAPTER, "Failed to read Bedrock Converse stream", String(error)),
    ),
    // Frame buffer: accumulate bytes, emit decoded JSON event strings as they
    // become available. `mapAccumEffect` flattens the per-step `ReadonlyArray`
    // automatically so the downstream stream sees one JSON string per element.
    Stream.mapAccumEffect(() => new Uint8Array(0), consumeFrames),
    Stream.mapEffect(decodeChunk),
    Stream.mapAccumEffect(
      (): ParserState => ({ tools: {}, finishReason: undefined }),
      processChunk,
      {
        // If a stream ends after `messageStop` but before `metadata` (rare but
        // possible on truncated transports), still surface a terminal finish.
        onHalt: (state): ReadonlyArray<LLMEvent> =>
          state.finishReason ? [{ type: "request-finish", reason: state.finishReason }] : [],
      },
    ),
  )

export const adapter = Adapter.define<BedrockConverseDraft, BedrockConverseTarget>({
  id: ADAPTER,
  protocol: "bedrock-converse",
  redact: (target) => target,
  prepare,
  validate: (draft) => decodeTarget(draft).pipe(Effect.mapError((error) => invalid(error.message))),
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
