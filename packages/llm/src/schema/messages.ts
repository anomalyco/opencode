import { Schema } from "effect"
import { JsonSchema, MessageRole, ProviderMetadata } from "./ids"
import { CacheHint, CachePolicy, GenerationOptions, HttpOptions, ModelSchema, ProviderOptions } from "./options"
import { isRecord } from "../utils/record"

const systemPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.SystemPart" })
export type SystemPart = Schema.Schema.Type<typeof systemPartSchema>

const makeSystemPart = (text: string): SystemPart => ({ type: "text", text })

export const SystemPart = Object.assign(systemPartSchema, {
  make: makeSystemPart,
  content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
    if (input === undefined) return []
    return typeof input === "string" ? [makeSystemPart(input)] : Array.isArray(input) ? [...input] : [input]
  },
})

export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Text" })
export type TextPart = Schema.Schema.Type<typeof TextPart>

export const MediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Media" })
export type MediaPart = Schema.Schema.Type<typeof MediaPart>

export const ToolResultMediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.String,
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.ToolResult.Media" })
export type ToolResultMediaPart = Schema.Schema.Type<typeof ToolResultMediaPart>

export const ToolResultContentPart = Schema.Union([TextPart, ToolResultMediaPart])
export type ToolResultContentPart = Schema.Schema.Type<typeof ToolResultContentPart>

export class ToolTextContent extends Schema.Class<ToolTextContent>("Tool.TextContent")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export const ToolFileSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("data"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("url"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("file"), uri: Schema.String }),
]).pipe(Schema.toTaggedUnion("type"))
export type ToolFileSource = Schema.Schema.Type<typeof ToolFileSource>

export class ToolFileContent extends Schema.Class<ToolFileContent>("Tool.FileContent")({
  type: Schema.Literal("file"),
  source: ToolFileSource,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
}) {}

/** Ordered, provider-independent content shown to models and UIs after a tool succeeds. */
export const ToolContent = Schema.Union([ToolTextContent, ToolFileContent]).pipe(Schema.toTaggedUnion("type"))
export type ToolContent = Schema.Schema.Type<typeof ToolContent>

export const toolText = (value: ConstructorParameters<typeof ToolTextContent>[0]) => new ToolTextContent(value)
export const toolFile = (value: ConstructorParameters<typeof ToolFileContent>[0]) => new ToolFileContent(value)

const inlineData = (uri: string) => {
  if (!uri.startsWith("data:")) return undefined
  const match = /^data:[^;,]+;base64,(.*)$/s.exec(uri)
  if (!match) throw new Error("Tool file data URI must contain raw base64 bytes")
  return match[1]!
}

const legacyInlineData = (value: string) => {
  const data = inlineData(value)
  if (data !== undefined) return data
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return value
  throw new Error("Legacy tool-result media must contain raw base64 bytes or a base64 data URI")
}

/** Convert a legacy attachment URI without guessing unknown string semantics. */
export const toolFileSourceFromUri = (uri: string): ToolFileSource => {
  const data = inlineData(uri)
  if (data !== undefined) return { type: "data", data }
  const url = URL.parse(uri)
  if (url?.protocol === "file:") return { type: "file", uri }
  if (url?.protocol === "http:" || url?.protocol === "https:") return { type: "url", url: uri }
  throw new Error(`Unsupported tool file URI: ${uri}`)
}

const isToolResultValue = (value: unknown): value is ToolResultValue =>
  isRecord(value) &&
  (value.type === "text" || value.type === "json" || value.type === "error" || value.type === "content") &&
  "value" in value

export const ToolResultValue = Object.assign(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("json"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("text"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("error"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("content"),
      value: Schema.Array(ToolResultContentPart),
    }),
  ]).annotate({ identifier: "LLM.ToolResult" }),
  {
    is: isToolResultValue,
    make: (value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue => {
      if (isToolResultValue(value)) return value
      if (type === "content") return { type, value: Array.isArray(value) ? value : [] }
      return { type, value }
    },
  },
)
export type ToolResultValue = Schema.Schema.Type<typeof ToolResultValue>

export interface ToolOutput {
  readonly structured: unknown
  readonly content: ReadonlyArray<ToolContent>
}

export const ToolOutput = Object.assign(
  Schema.Struct({
    structured: Schema.Unknown,
    content: Schema.Array(ToolContent),
  }).annotate({ identifier: "LLM.ToolOutput" }),
  {
    make: (structured: unknown, content: ReadonlyArray<ToolContent> = []): ToolOutput => ({
      structured,
      content: content.map((item) =>
        item.type === "text"
          ? toolText({ type: "text", text: item.text })
          : toolFile({ type: "file", source: item.source, mime: item.mime, name: item.name }),
      ),
    }),
    fromResultValue: (result: ToolResultValue): ToolOutput | undefined => {
      switch (result.type) {
        case "json":
          return { structured: result.value, content: [] }
        case "text":
          return { structured: {}, content: [toolText({ type: "text", text: toolResultText(result.value) })] }
        case "content":
          return {
            structured: {},
            content: result.value.map((item) =>
              item.type === "text"
                ? toolText({ type: "text", text: item.text })
                : toolFile({
                    type: "file",
                    source: { type: "data", data: legacyInlineData(item.data) },
                    mime: item.mediaType,
                    name: item.filename,
                  }),
            ),
          }
        case "error":
          return undefined
      }
    },
    toResultValue: (output: ToolOutput): ToolResultValue => {
      if (output.content.length === 0) return { type: "json", value: output.structured }
      if (output.content.length === 1 && output.content[0]?.type === "text")
        return { type: "text", value: output.content[0].text }
      const unsupported = output.content.find((item) => item.type === "file" && item.source.type !== "data")
      if (unsupported?.type === "file")
        return {
          type: "error",
          value: `Tool file source "${unsupported.source.type}" must be materialized to inline data before provider conversion`,
        }
      return {
        type: "content",
        value: output.content.map((item) => {
          if (item.type === "text") return { type: "text", text: item.text }
          if (item.source.type !== "data")
            throw new Error("Unmaterialized tool file source reached provider conversion")
          return { type: "media", mediaType: item.mime, data: item.source.data, filename: item.name }
        }),
      }
    },
  },
)

const toolResultText = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const ToolCallPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal("tool-call"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: "LLM.Content.ToolCall" }),
  {
    make: (input: Omit<ToolCallPart, "type">): ToolCallPart => ({ type: "tool-call", ...input }),
  },
)
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>

export const ToolResultPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal("tool-result"),
    id: Schema.String,
    name: Schema.String,
    result: ToolResultValue,
    providerExecuted: Schema.optional(Schema.Boolean),
    cache: Schema.optional(CacheHint),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: "LLM.Content.ToolResult" }),
  {
    make: (
      input: Omit<ToolResultPart, "type" | "result"> & {
        readonly result: unknown
        readonly resultType?: ToolResultValue["type"]
      },
    ): ToolResultPart => ({
      type: "tool-result",
      id: input.id,
      name: input.name,
      result: ToolResultValue.make(input.result, input.resultType),
      providerExecuted: input.providerExecuted,
      cache: input.cache,
      metadata: input.metadata,
      providerMetadata: input.providerMetadata,
    }),
  },
)
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Reasoning" })
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>

export const ContentPart = Schema.Union([TextPart, MediaPart, ToolCallPart, ToolResultPart, ReasoningPart]).pipe(
  Schema.toTaggedUnion("type"),
)
export type ContentPart = Schema.Schema.Type<typeof ContentPart>

export class Message extends Schema.Class<Message>("LLM.Message")({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace Message {
  export type ContentInput = string | ContentPart | ReadonlyArray<ContentPart>
  export type SystemContentInput = string | TextPart | ReadonlyArray<TextPart>
  export type Input = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
    readonly content: ContentInput
  }

  export const text = (value: string): ContentPart => ({ type: "text", text: value })

  export const content = (input: ContentInput) =>
    typeof input === "string" ? [text(input)] : Array.isArray(input) ? [...input] : [input]

  export const make = (input: Message | Input) => {
    if (input instanceof Message) return input
    return new Message({ ...input, content: content(input.content) })
  }

  export const user = (content: ContentInput) => make({ role: "user", content })

  export const assistant = (content: ContentInput) => make({ role: "assistant", content })

  /**
   * Add an operator-authored instruction at this chronological point in the
   * conversation. This is distinct from the initial `LLMRequest.system`
   * prompt. Keep raw retrieved, tool, and web content out of privileged system
   * updates; pass that untrusted content through ordinary user/tool channels.
   */
  export const system = (content: SystemContentInput) => make({ role: "system", content })

  export const tool = (result: ToolResultPart | Parameters<typeof ToolResultPart.make>[0]) =>
    make({ role: "tool", content: ["type" in result ? result : ToolResultPart.make(result)] })
}

export class ToolDefinition extends Schema.Class<ToolDefinition>("LLM.ToolDefinition")({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  outputSchema: Schema.optional(JsonSchema),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace ToolDefinition {
  export type Input = ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]

  /** Normalize tool definition input into the canonical `ToolDefinition` class. */
  export const make = (input: Input) => (input instanceof ToolDefinition ? input : new ToolDefinition(input))
}

export class ToolChoice extends Schema.Class<ToolChoice>("LLM.ToolChoice")({
  type: Schema.Literals(["auto", "none", "required", "tool"]),
  name: Schema.optional(Schema.String),
}) {}

export namespace ToolChoice {
  export type Mode = Exclude<ToolChoice["type"], "tool">
  export type Input = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string

  const isMode = (value: string): value is Mode => value === "auto" || value === "none" || value === "required"

  /** Select a specific named tool. */
  export const named = (value: string) => new ToolChoice({ type: "tool", name: value })

  /** Normalize ergonomic tool-choice inputs into the canonical `ToolChoice` class. */
  export const make = (input: Input) => {
    if (input instanceof ToolChoice) return input
    if (input instanceof ToolDefinition) return named(input.name)
    if (typeof input === "string") return isMode(input) ? new ToolChoice({ type: input }) : named(input)
    return new ToolChoice(input)
  }
}

export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("json"), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal("tool"), tool: ToolDefinition }),
]).pipe(Schema.toTaggedUnion("type"))
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>

export class LLMRequest extends Schema.Class<LLMRequest>("LLM.Request")({
  id: Schema.optional(Schema.String),
  model: ModelSchema,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  responseFormat: Schema.optional(ResponseFormat),
  cache: Schema.optional(CachePolicy),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export namespace LLMRequest {
  export type Input = ConstructorParameters<typeof LLMRequest>[0]

  export const input = (request: LLMRequest): Input => ({
    id: request.id,
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    generation: request.generation,
    providerOptions: request.providerOptions,
    http: request.http,
    responseFormat: request.responseFormat,
    cache: request.cache,
    metadata: request.metadata,
  })

  export const update = (request: LLMRequest, patch: Partial<Input>) => {
    if (Object.keys(patch).length === 0) return request
    return new LLMRequest({
      ...input(request),
      ...patch,
      model: patch.model ?? request.model,
    })
  }
}
