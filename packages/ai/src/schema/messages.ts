import { Schema } from "effect"
import { Tool } from "@opencode-ai/schema/tool"
import {
  CacheHint,
  CachePolicy,
  GenerationOptions,
  HttpOptions,
  JsonSchema,
  LanguageModelSchema,
  type LanguageModel,
  ProviderOptions,
} from "./options.js"
import { ProviderID } from "./ids.js"

export const MessageRole = Schema.Literals(["system", "user", "assistant", "tool"])
export type MessageRole = Schema.Schema.Type<typeof MessageRole>

export const ProviderMetadata = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)).annotate({
  identifier: "LLM.ProviderMetadata",
})
export type ProviderMetadata = Schema.Schema.Type<typeof ProviderMetadata>

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
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Media" })
export type MediaPart = Schema.Schema.Type<typeof MediaPart>

const toolResultValueSchema = Schema.Union([
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
    value: Schema.Array(Tool.Content),
  }),
]).annotate({ identifier: "LLM.ToolResult" })
export type ToolResultValue = Schema.Schema.Type<typeof toolResultValueSchema>
const isToolResultValue = Schema.is(toolResultValueSchema)

export const ToolResultValue = Object.assign(toolResultValueSchema, {
  is: isToolResultValue,
  make: (value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue => {
    if (isToolResultValue(value)) return value
    if (type === "content") return { type, value: Array.isArray(value) ? value : [] }
    return { type, value }
  },
})

export interface ToolOutput {
  readonly structured: unknown
  readonly content: ReadonlyArray<Tool.Content>
}

export const ToolOutput = Object.assign(
  Schema.Struct({
    structured: Schema.Unknown,
    content: Schema.Array(Tool.Content),
  }).annotate({ identifier: "LLM.ToolOutput" }),
  {
    make: (structured: unknown, content: ReadonlyArray<Tool.Content> = []): ToolOutput => ({ structured, content }),
    fromResultValue: (result: ToolResultValue): ToolOutput | undefined => {
      switch (result.type) {
        case "json":
          return { structured: result.value, content: [] }
        case "text":
          return { structured: {}, content: [{ type: "text", text: toolResultText(result.value) }] }
        case "content":
          return { structured: {}, content: result.value }
        case "error":
          return undefined
      }
    },
    toResultValue: (output: ToolOutput): ToolResultValue => {
      if (output.content.length === 0) return { type: "json", value: output.structured }
      if (output.content.length === 1 && output.content[0]?.type === "text")
        return { type: "text", value: output.content[0].text }
      return { type: "content", value: output.content }
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
    namespace: Schema.optional(Schema.String),
    input: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    cache: Schema.optional(CacheHint),
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
    namespace: Schema.optional(Schema.String),
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
      namespace: input.namespace,
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
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Reasoning" })
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>

/** A provider-generated context checkpoint, distinct from visible assistant text. */
type CompactionContent =
  | { readonly encrypted: string; readonly text?: never }
  | { readonly text: string | null; readonly encrypted?: never }

const compactionPartSchema = Schema.Struct({
  type: Schema.Literal("compaction"),
  provider: ProviderID,
  id: Schema.optional(Schema.String),
  encrypted: Schema.optional(Schema.String),
  /** Null means the provider failed to produce a summary; prior history must be retained. */
  text: Schema.optional(Schema.NullOr(Schema.String)),
})
  .pipe(
    Schema.refine(
      (part): part is typeof part & CompactionContent => (part.encrypted !== undefined) !== (part.text !== undefined),
      { message: "Compaction requires either encrypted content or a summary" },
    ),
  )
  .annotate({ identifier: "LLM.Content.Compaction" })
export type CompactionPart = typeof compactionPartSchema.Type
export const CompactionPart = Object.assign(compactionPartSchema, {
  make: (input: Omit<CompactionPart, "type" | "encrypted" | "text"> & CompactionContent): CompactionPart =>
    Schema.decodeUnknownSync(compactionPartSchema)({ type: "compaction", ...input }),
})

export const ContentPart = Schema.Union([
  TextPart,
  MediaPart,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  CompactionPart,
]).pipe(Schema.toTaggedUnion("type"))
export type ContentPart = Schema.Schema.Type<typeof ContentPart>

export class Message extends Schema.Class<Message>("LLM.Message")({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
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

export const ToolFreeformGrammar = Tool.FreeformGrammar
export type ToolFreeformGrammar = Schema.Schema.Type<typeof ToolFreeformGrammar>

export const ToolFreeform = Tool.Freeform
export type ToolFreeform = Schema.Schema.Type<typeof ToolFreeform>

const toolDefinitionFields = {
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  outputSchema: Schema.optional(JsonSchema),
  /** Optional string-input representation for protocols and models that support freeform tools. */
  freeform: Schema.optional(ToolFreeform),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}

export type ToolDefinitionInput = Schema.Struct.Type<typeof toolDefinitionFields>

export class ToolDefinition extends Schema.Class<ToolDefinition>("LLM.ToolDefinition")({
  type: Schema.Literal("tool"),
  ...toolDefinitionFields,
}) {
  constructor(input: ToolDefinitionInput) {
    super({ ...input, type: "tool" })
  }
}

export namespace ToolDefinition {
  export type Input = ToolDefinition | ToolDefinitionInput

  /** Normalize tool definition input into the canonical `ToolDefinition` class. */
  export const make = (input: Input) => (input instanceof ToolDefinition ? input : new ToolDefinition(input))
}

export type ToolNamespace = {
  readonly type: "namespace"
  readonly name: string
  readonly description?: string
  readonly tools: ReadonlyArray<ToolEntry>
}

export type ToolNamespaceInput = Omit<ToolNamespace, "type" | "tools"> & {
  readonly tools: ReadonlyArray<ToolEntryInput>
}
export type ToolNamespaceEntryInput = ToolNamespaceInput & { readonly type: "namespace" }

export const ToolNamespace: Schema.Codec<ToolNamespace> & {
  readonly make: (input: ToolNamespace | ToolNamespaceInput) => ToolNamespace
} = Object.assign(
  Schema.Struct({
    type: Schema.Literal("namespace"),
    name: Schema.String,
    description: Schema.optional(Schema.UndefinedOr(Schema.String)),
    tools: Schema.Array(Schema.suspend((): Schema.Codec<ToolEntry> => ToolEntry)),
  }).annotate({ identifier: "LLM.ToolNamespace" }),
  {
    make: (input: ToolNamespace | ToolNamespaceInput): ToolNamespace => ({
      ...input,
      type: "namespace",
      tools: input.tools.map(ToolEntry.make),
    }),
  },
)

export type ToolEntry = ToolDefinition | ToolNamespace
export type ToolEntryInput = ToolDefinition.Input | ToolNamespaceEntryInput
export const ToolEntry: Schema.Codec<ToolEntry> & {
  readonly make: (input: ToolEntryInput) => ToolEntry
} = Object.assign(
  Schema.Union([ToolDefinition, ToolNamespace]).pipe(
    Schema.toTaggedUnion("type"),
    Schema.annotate({ identifier: "LLM.ToolEntry" }),
  ),
  {
    make: (input: ToolEntryInput): ToolEntry =>
      "type" in input && input.type === "namespace" ? ToolNamespace.make(input) : ToolDefinition.make(input),
  },
)

export class ToolChoice extends Schema.Class<ToolChoice>("LLM.ToolChoice")({
  type: Schema.Literals(["auto", "none", "required", "tool"]),
  name: Schema.optional(Schema.String),
  disableParallelToolUse: Schema.optional(Schema.Boolean),
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

const requestSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  model: LanguageModelSchema,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolEntry),
  toolChoice: Schema.optional(ToolChoice),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  cache: Schema.optional(CachePolicy),
  // Stable cache affinity for protocols that support provider-managed prompt caching.
  promptCacheKey: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export class LLMRequest<Model extends LanguageModel = LanguageModel> extends Schema.Class<LLMRequest>("LLM.Request")(
  requestSchema.fields,
) {
  declare readonly model: Model

  // Preserve model inference instead of inheriting the schema's erased constructor signature.
  // oxlint-disable-next-line no-useless-constructor
  constructor(input: LLMRequest.Input<Model>) {
    super(input)
  }
}

export namespace LLMRequest {
  export type Input<Model extends LanguageModel = LanguageModel> = Omit<typeof requestSchema.Type, "model"> & {
    readonly model: Model
  }

  export const input = <Model extends LanguageModel>(request: LLMRequest<Model>): Input<Model> => ({
    id: request.id,
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    toolChoice: request.toolChoice,
    generation: request.generation,
    providerOptions: request.providerOptions,
    http: request.http,
    cache: request.cache,
    promptCacheKey: request.promptCacheKey,
    metadata: request.metadata,
  })

  export function update<Model extends LanguageModel>(
    request: LLMRequest,
    patch: Partial<Input<Model>> & { readonly model: Model },
  ): LLMRequest<Model>
  export function update<Model extends LanguageModel>(
    request: LLMRequest<Model>,
    patch: Partial<Omit<Input, "model">> & { readonly model?: undefined },
  ): LLMRequest<Model>
  export function update(request: LLMRequest, patch: Partial<Input>): LLMRequest
  export function update(request: LLMRequest, patch: Partial<Input>) {
    if (Object.keys(patch).length === 0) return request
    return new LLMRequest({
      ...input(request),
      ...patch,
      model: patch.model ?? request.model,
    })
  }
}
