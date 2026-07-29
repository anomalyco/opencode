import { Effect, JsonSchema, Schema } from "effect"
import { LLMClient } from "./route/client"
import {
  GenerationOptions,
  HttpOptions,
  InvalidProviderOutputReason,
  LLMError,
  LLMEvent,
  LLMRequest,
  LLMResponse,
  Message,
  Model,
  SystemPart,
  ToolChoice,
  ToolDefinition,
  type ContentPart,
  type ModelProviderOptions,
} from "./schema"
import { make as makeTool, toDefinitions, type ToolSchema } from "./tool"

/** Input accepted by `LLM.request`, normalized into the canonical `LLMRequest` class. */
export type RequestInput<SelectedModel extends Model = Model> = Omit<
  ConstructorParameters<typeof LLMRequest>[0],
  "model" | "system" | "messages" | "tools" | "toolChoice" | "generation" | "http" | "providerOptions"
> & {
  readonly model: SelectedModel
  readonly system?: string | SystemPart | ReadonlyArray<SystemPart>
  readonly prompt?: string | ContentPart | ReadonlyArray<ContentPart>
  readonly messages?: ReadonlyArray<Message | Message.Input>
  readonly tools?: ReadonlyArray<ToolDefinition.Input>
  readonly toolChoice?: ToolChoice.Input
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: NoInfer<ModelProviderOptions<SelectedModel>>
  readonly http?: HttpOptions.Input
}

export const generate = LLMClient.generate

export const stream = LLMClient.stream

export const request = <const SelectedModel extends Model>(input: RequestInput<SelectedModel>) => {
  const {
    system: requestSystem,
    prompt,
    messages,
    tools,
    toolChoice: requestToolChoice,
    generation: requestGeneration,
    providerOptions: requestProviderOptions,
    http: requestHttp,
    ...rest
  } = input
  return new LLMRequest({
    ...rest,
    system: SystemPart.content(requestSystem),
    messages: [...(messages?.map(Message.make) ?? []), ...(prompt === undefined ? [] : [Message.user(prompt)])],
    tools: tools?.map(ToolDefinition.make) ?? [],
    toolChoice: requestToolChoice ? ToolChoice.make(requestToolChoice) : undefined,
    generation: requestGeneration === undefined ? undefined : GenerationOptions.make(requestGeneration),
    providerOptions: requestProviderOptions,
    http: requestHttp === undefined ? undefined : HttpOptions.make(requestHttp),
  })
}

const GENERATE_OBJECT_TOOL_NAME = "generate_object"

const GENERATE_OBJECT_TOOL_DESCRIPTION = "Return the structured result by calling this tool."

type GenerateObjectBase<SelectedModel extends Model = Model> = Omit<RequestInput<SelectedModel>, "tools" | "toolChoice">

export class GenerateObjectResponse<T> {
  constructor(
    readonly object: T,
    readonly response: LLMResponse,
  ) {}

  get events() {
    return this.response.events
  }

  get usage() {
    return this.response.usage
  }
}

export interface GenerateObjectOptions<S extends ToolSchema<any>, SelectedModel extends Model = Model>
  extends GenerateObjectBase<SelectedModel> {
  readonly schema: S
}

export interface GenerateObjectDynamicOptions<SelectedModel extends Model = Model>
  extends GenerateObjectBase<SelectedModel> {
  /** Raw JSON Schema object describing the expected output shape. */
  readonly jsonSchema: JsonSchema.JsonSchema
}

const runGenerateObject = Effect.fn("LLM.generateObject")(function* (
  options: GenerateObjectBase,
  tool: ReturnType<typeof makeTool>,
) {
  const baseRequest = request(options)
  const generateRequest = LLMRequest.update(baseRequest, {
    tools: toDefinitions({ [GENERATE_OBJECT_TOOL_NAME]: tool }),
    toolChoice: ToolChoice.named(GENERATE_OBJECT_TOOL_NAME),
  })
  const response = yield* LLMClient.generate(generateRequest)
  const call = response.toolCalls.find(
    (event) => LLMEvent.is.toolCall(event) && event.name === GENERATE_OBJECT_TOOL_NAME,
  )
  if (!call || !LLMEvent.is.toolCall(call))
    return yield* new LLMError({
      module: "LLM",
      method: "generateObject",
      reason: new InvalidProviderOutputReason({
        message: `generateObject: model did not call the forced \`${GENERATE_OBJECT_TOOL_NAME}\` tool`,
      }),
    })
  const object = yield* tool._decode(call.input).pipe(
    Effect.mapError(
      (error) =>
        new LLMError({
          module: "LLM",
          method: "generateObject",
          reason: new InvalidProviderOutputReason({
            message: `generateObject: tool input failed schema decode: ${error.message}`,
          }),
        }),
    ),
  )
  return new GenerateObjectResponse(object, response)
})

/**
 * Run a model and decode its output against `schema`. Works on every protocol
 * because it forces a synthetic tool call internally — provider-native JSON
 * modes are intentionally avoided so behaviour is uniform.
 *
 * Two input modes:
 *
 * 1. `schema: EffectSchema<T>` — `.object` is decoded and typed as `T`.
 *    Decode failures surface as `LLMError`.
 * 2. `jsonSchema: JsonSchema.JsonSchema` — `.object` is `unknown`. Use when
 *    the schema is only available at runtime (MCP, plugin manifests). Caller validates.
 */
export function generateObject<const SelectedModel extends Model, S extends ToolSchema<any>>(
  options: GenerateObjectOptions<S, SelectedModel>,
): Effect.Effect<GenerateObjectResponse<Schema.Schema.Type<S>>, LLMError>
export function generateObject<const SelectedModel extends Model>(
  options: GenerateObjectDynamicOptions<SelectedModel>,
): Effect.Effect<GenerateObjectResponse<unknown>, LLMError>
export function generateObject(options: GenerateObjectOptions<ToolSchema<any>> | GenerateObjectDynamicOptions) {
  if ("schema" in options) {
    const { schema, ...rest } = options
    return runGenerateObject(
      rest,
      makeTool({
        description: GENERATE_OBJECT_TOOL_DESCRIPTION,
        parameters: schema,
        success: Schema.Unknown as ToolSchema<unknown>,
        execute: () => Effect.void,
      }),
    )
  }
  const { jsonSchema, ...rest } = options
  return runGenerateObject(
    rest,
    makeTool({
      description: GENERATE_OBJECT_TOOL_DESCRIPTION,
      jsonSchema,
      execute: () => Effect.void,
    }),
  )
}
