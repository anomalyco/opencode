export * as AISDK from "./aisdk"

import { makeLocationNode } from "./effect/app-node"
import type {
  JSONSchema7,
  JSONValue,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolChoice,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider"
import {
  FinishReason,
  InvalidProviderOutputReason,
  LLMEvent,
  LLMError,
  Model,
  ProviderID,
  ProviderMetadata,
  ToolResultValue,
  UnknownProviderReason,
  type ContentPart,
  type LLMRequest,
  type ToolDefinition,
  type UsageInput,
} from "@opencode-ai/llm"
import { Auth, Endpoint, type AnyRoute } from "@opencode-ai/llm/route"
import { Cause, Context, Effect, Layer, Option, Schema, Scope, Stream } from "effect"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { State } from "./state"

type SDK = any
type UserContent = Extract<LanguageModelV3Message, { role: "user" }>["content"]
type AssistantContent = Extract<LanguageModelV3Message, { role: "assistant" }>["content"]
type ToolResultContent = Extract<AssistantContent[number], { type: "tool-result" }>

export interface SDKEvent {
  readonly model: ModelV2.Info
  readonly package: string
  readonly options: Record<string, any>
  sdk?: SDK
}

export interface LanguageEvent {
  readonly model: ModelV2.Info
  readonly sdk: SDK
  readonly options: Record<string, any>
  language?: LanguageModelV3
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

function prepareOptions(model: ModelV2.Info, pkg: string) {
  const options: Record<string, any> = {
    name: model.providerID,
    ...(model.settings ?? {}),
    headers: model.headers,
    body: model.body,
  }

  const customFetch = options.fetch
  const chunkTimeout = options.chunkTimeout
  delete options.chunkTimeout
  options.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const opts = { ...(init ?? {}) }
    const signals = [
      opts.signal,
      typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined,
      options.timeout !== undefined && options.timeout !== null && options.timeout !== false
        ? AbortSignal.timeout(options.timeout)
        : undefined,
    ].filter((item): item is AbortSignal | AbortController => Boolean(item))
    const chunkAbortCtl = signals.find((item): item is AbortController => item instanceof AbortController)
    const abortSignals = signals.map((item) => (item instanceof AbortController ? item.signal : item))
    if (abortSignals.length === 1) opts.signal = abortSignals[0]
    if (abortSignals.length > 1) opts.signal = AbortSignal.any(abortSignals)

    if (
      (pkg === "@ai-sdk/openai" || pkg === "@ai-sdk/azure" || pkg === "@ai-sdk/amazon-bedrock/mantle") &&
      opts.body &&
      opts.method === "POST"
    ) {
      const body = JSON.parse(opts.body as string)
      if (body.store !== true && Array.isArray(body.input)) {
        for (const item of body.input) {
          if ("id" in item) delete item.id
        }
        opts.body = JSON.stringify(body)
      }
    }

    if (typeof opts.body === "string" && model.body !== undefined) {
      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(opts.body))
      if (Schema.is(Schema.Record(Schema.String, Schema.Json))(decoded)) {
        opts.body = JSON.stringify(ProviderV2.mergeOverlay(decoded, model.body))
      }
    }

    const res = await (typeof customFetch === "function" ? customFetch : fetch)(input, {
      ...opts,
      timeout: false,
    })
    if (!chunkAbortCtl || typeof chunkTimeout !== "number") return res
    return wrapSSE(res, chunkTimeout, chunkAbortCtl)
  }

  return options
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("AISDK.InitError", {
  providerID: ProviderV2.ID,
  cause: Schema.Defect(),
}) {}

function initError(providerID: ProviderV2.ID) {
  return Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))
}

export interface Interface {
  readonly hook: {
    readonly sdk: (
      callback: (event: SDKEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly language: (
      callback: (event: LanguageEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  readonly runSDK: (event: SDKEvent) => Effect.Effect<SDKEvent>
  readonly runLanguage: (event: LanguageEvent) => Effect.Effect<LanguageEvent>
  readonly language: (model: ModelV2.Info) => Effect.Effect<LanguageModelV3, InitError>
  readonly model: (model: ModelV2.Info) => Effect.Effect<Model, InitError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AISDK") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let sdkHooks: ((event: SDKEvent) => Effect.Effect<void> | void)[] = []
    let languageHooks: ((event: LanguageEvent) => Effect.Effect<void> | void)[] = []
    const languages = new Map<string, LanguageModelV3>()
    const sdks = new Map<string, SDK>()
    const functionIDs = new WeakMap<object, number>()
    let nextFunctionID = 0
    const cacheKey = (input: unknown) =>
      JSON.stringify(input, (_key, value: unknown) => {
        if (typeof value !== "function") return value
        const existing = functionIDs.get(value)
        if (existing !== undefined) return `function:${existing}`
        const id = nextFunctionID++
        functionIDs.set(value, id)
        return `function:${id}`
      }) ?? ""

    const register = <Event>(
      hooks: () => ((event: Event) => Effect.Effect<void> | void)[],
      update: (hooks: ((event: Event) => Effect.Effect<void> | void)[]) => void,
    ) =>
      Effect.fn("AISDK.hook")(function* (callback: (event: Event) => Effect.Effect<void> | void) {
        const scope = yield* Scope.Scope
        let active = true
        update([...hooks(), callback])
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          update(hooks().filter((item) => item !== callback))
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

    const run = Effect.fnUntraced(function* <Event>(
      hooks: readonly ((event: Event) => Effect.Effect<void> | void)[],
      event: Event,
    ) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    const service = Service.of({
      hook: {
        sdk: register(
          () => sdkHooks,
          (next) => (sdkHooks = next),
        ),
        language: register(
          () => languageHooks,
          (next) => (languageHooks = next),
        ),
      },
      runSDK: (event) => run(sdkHooks, event),
      runLanguage: (event) => run(languageHooks, event),
      language: Effect.fn("AISDK.language")(function* (model) {
        const key = cacheKey({
          providerID: model.providerID,
          id: model.id,
          modelID: model.modelID,
          package: model.package,
          settings: model.settings,
          headers: model.headers,
          body: model.body,
          limit: model.limit,
        })
        const existing = languages.get(key)
        if (existing) return existing
        if (!ProviderV2.isAISDK(model.package))
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error(`Unsupported package ${model.package}`),
          })

        const packageName = ProviderV2.packageName(model.package) ?? ""
        const options = prepareOptions(model, packageName)
        const sdkKey = cacheKey({
          providerID: model.providerID,
          package: packageName,
          settings: model.settings,
          headers: model.headers,
          body: model.body,
        })
        const sdk =
          sdks.get(sdkKey) ??
          (yield* service.runSDK({ model, package: packageName, options }).pipe(initError(model.providerID))).sdk
        if (!sdk)
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error("No AISDK provider plugin returned an SDK"),
          })
        sdks.set(sdkKey, sdk)
        const result = yield* service.runLanguage({ model, sdk, options }).pipe(initError(model.providerID))
        const language = yield* Effect.sync(() => result.language ?? sdk.languageModel(model.modelID ?? model.id)).pipe(
          initError(model.providerID),
        )
        languages.set(key, language)
        return language
      }),
      model: Effect.fn("AISDK.model")(function* (model) {
        return modelFromLanguage(model, yield* service.language(model))
      }),
    })
    return service
  }),
)

export const defaultLayer = locationLayer

function modelFromLanguage(info: ModelV2.Info, language: LanguageModelV3) {
  const settings = requestSettings(info.settings)
  const optionKey = providerOptionKey(ProviderV2.packageName(info.package), info.providerID)
  const route: AnyRoute = {
    id: `ai-sdk:${ProviderV2.packageName(info.package) ?? "unknown"}`,
    provider: ProviderID.make(info.providerID),
    providerMetadataKey: optionKey,
    protocol: "ai-sdk",
    endpoint: Endpoint.path("/", { baseURL: "https://ai-sdk.local" }),
    auth: Auth.none,
    transport: {
      id: "ai-sdk",
      prepare: (input) => Effect.succeed(input.body),
      frames: () => Stream.empty,
    },
    defaults: {
      headers: info.headers,
      http:
        info.body === undefined && info.headers === undefined
          ? undefined
          : { body: info.body === undefined ? undefined : { ...info.body }, headers: info.headers },
      limits: { context: info.limit.context, output: info.limit.output },
      providerOptions: settings === undefined ? undefined : { [optionKey]: settings },
    },
    body: {
      schema: Schema.Unknown,
      from: (request) => Effect.succeed(callOptions(request)),
    },
    with: () => route,
    model: (input) => Model.make({ ...input, provider: "provider" in input ? input.provider : info.providerID, route }),
    prepareTransport: (body) => Effect.succeed(body),
    streamPrepared: (prepared) => streamLanguage(language, prepared as LanguageModelV3CallOptions),
  }
  return Model.make({ id: info.modelID ?? info.id, provider: info.providerID, route })
}

function providerOptionKey(packageName: string | undefined, providerID: ProviderV2.ID) {
  if (packageName === "@ai-sdk/google") return "google"
  if (packageName === "@ai-sdk/google-vertex") return "vertex"
  if (packageName === "@ai-sdk/google-vertex/anthropic") return "anthropic"
  if (packageName === "@ai-sdk/amazon-bedrock" || packageName === "@ai-sdk/amazon-bedrock/mantle") return "bedrock"
  if (packageName === "@ai-sdk/azure") return "azure"
  if (packageName === "@openrouter/ai-sdk-provider") return "openrouter"
  if (packageName?.startsWith("@ai-sdk/")) return packageName.slice("@ai-sdk/".length)
  return providerID
}

function requestSettings(settings: Readonly<Record<string, unknown>> | undefined) {
  if (settings === undefined) return undefined
  const result = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !["apiKey", "authToken", "baseURL", "chunkTimeout", "fetch", "timeout"].includes(key),
    ),
  )
  return Object.keys(result).length === 0 ? undefined : result
}

function callOptions(request: LLMRequest): LanguageModelV3CallOptions {
  return {
    prompt: prompt(request),
    maxOutputTokens: request.generation?.maxTokens ?? request.model.route.defaults.limits?.output,
    temperature: request.generation?.temperature,
    stopSequences: request.generation?.stop === undefined ? undefined : [...request.generation.stop],
    topP: request.generation?.topP,
    topK: request.generation?.topK,
    presencePenalty: request.generation?.presencePenalty,
    frequencyPenalty: request.generation?.frequencyPenalty,
    seed: request.generation?.seed,
    responseFormat: responseFormat(request),
    tools: request.tools.map(tool),
    toolChoice: toolChoice(request.toolChoice),
    headers: request.http?.headers,
    providerOptions: providerOptions(request.providerOptions),
  }
}

function prompt(request: LLMRequest): LanguageModelV3Prompt {
  const system = request.system
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n\n")
  const messages = request.messages.flatMap(message)
  if (!system.length) return messages
  return [{ role: "system", content: system }, ...messages]
}

function message(input: LLMRequest["messages"][number]): LanguageModelV3Message[] {
  switch (input.role) {
    case "system":
      return [{ role: "system", content: input.content.flatMap(text).join("\n\n") }]
    case "user":
      return [{ role: "user", content: input.content.flatMap(userPart) }]
    case "assistant":
      return [{ role: "assistant", content: input.content.flatMap(assistantPart) }]
    case "tool": {
      const content = input.content.flatMap(toolResultPart)
      return content.length ? [{ role: "tool", content }] : []
    }
  }
}

function text(part: ContentPart) {
  return part.type === "text" ? [part.text] : []
}

function userPart(part: ContentPart): UserContent {
  if (part.type === "text") return [{ type: "text", text: part.text }]
  if (part.type === "media")
    return [{ type: "file", mediaType: part.mediaType, data: part.data, filename: part.filename }]
  return []
}

function assistantPart(part: ContentPart): AssistantContent {
  switch (part.type) {
    case "text":
      return [{ type: "text", text: part.text }]
    case "media":
      return [{ type: "file", mediaType: part.mediaType, data: part.data, filename: part.filename }]
    case "reasoning":
      return [{ type: "reasoning", text: part.text, providerOptions: providerOptions(part.providerMetadata) }]
    case "tool-call":
      return [
        {
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: part.input,
          providerExecuted: part.providerExecuted,
          providerOptions: providerOptions(part.providerMetadata),
        },
      ]
    case "tool-result":
      return toolResultPart(part)
  }
}

function toolResultPart(part: ContentPart): ToolResultContent[] {
  if (part.type !== "tool-result") return []
  return [
    {
      type: "tool-result",
      toolCallId: part.id,
      toolName: part.name,
      output: toolOutput(part.result),
      providerOptions: providerOptions(part.providerMetadata),
    },
  ]
}

function toolOutput(result: ToolResultValue) {
  switch (result.type) {
    case "text":
    case "error":
      return { type: "text" as const, value: messageValue(result.value) }
  }
  return { type: "json" as const, value: jsonValue(result.value) }
}

function tool(input: ToolDefinition): LanguageModelV3FunctionTool {
  return {
    type: "function",
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema as JSONSchema7,
  }
}

function toolChoice(input: LLMRequest["toolChoice"]): LanguageModelV3ToolChoice | undefined {
  if (!input) return undefined
  if (input.type === "tool") return input.name === undefined ? undefined : { type: "tool", toolName: input.name }
  return { type: input.type }
}

function responseFormat(request: LLMRequest): LanguageModelV3CallOptions["responseFormat"] {
  if (request.responseFormat?.type === "json")
    return { type: "json", schema: request.responseFormat.schema as JSONSchema7 }
  if (request.responseFormat) return { type: "text" }
}

function providerOptions(input: LLMRequest["providerOptions"]): SharedV3ProviderOptions | undefined {
  if (!input) return undefined
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, jsonObject(value)]))
}

function streamLanguage(language: LanguageModelV3, options: LanguageModelV3CallOptions) {
  const state = { step: 0, toolNames: {} as Record<string, string> }
  return Stream.concat(
    Stream.make(LLMEvent.stepStart({ index: state.step })),
    Stream.unwrap(
      Effect.tryPromise({
        try: () => language.doStream(options),
        catch: (error) => llmError("doStream", error),
      }).pipe(
        Effect.map((result) =>
          Stream.fromReadableStream({
            evaluate: () => result.stream,
            onError: (error) => llmError("readStream", error),
          }).pipe(
            Stream.mapEffect((event) => streamPartEvents(state, event)),
            Stream.flatMap((events) => Stream.fromIterable(events)),
          ),
        ),
      ),
    ),
  )
}

function streamPartEvents(
  state: { step: number; toolNames: Record<string, string> },
  event: LanguageModelV3StreamPart,
): Effect.Effect<ReadonlyArray<LLMEvent>, LLMError> {
  switch (event.type) {
    case "stream-start":
    case "response-metadata":
    case "raw":
    case "file":
    case "source":
    case "tool-approval-request":
      return Effect.succeed([])
    case "text-start":
      return Effect.succeed([
        LLMEvent.textStart({ id: event.id, providerMetadata: providerMetadata(event.providerMetadata) }),
      ])
    case "text-delta":
      return Effect.succeed([
        LLMEvent.textDelta({
          id: event.id,
          text: event.delta,
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "text-end":
      return Effect.succeed([
        LLMEvent.textEnd({ id: event.id, providerMetadata: providerMetadata(event.providerMetadata) }),
      ])
    case "reasoning-start":
      return Effect.succeed([
        LLMEvent.reasoningStart({ id: event.id, providerMetadata: providerMetadata(event.providerMetadata) }),
      ])
    case "reasoning-delta":
      return Effect.succeed([
        LLMEvent.reasoningDelta({
          id: event.id,
          text: event.delta,
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "reasoning-end":
      return Effect.succeed([
        LLMEvent.reasoningEnd({ id: event.id, providerMetadata: providerMetadata(event.providerMetadata) }),
      ])
    case "tool-input-start":
      state.toolNames[event.id] = event.toolName
      return Effect.succeed([
        LLMEvent.toolInputStart({
          id: event.id,
          name: event.toolName,
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "tool-input-delta":
      return Effect.succeed([
        LLMEvent.toolInputDelta({ id: event.id, name: state.toolNames[event.id] ?? "unknown", text: event.delta }),
      ])
    case "tool-input-end":
      return Effect.succeed([
        LLMEvent.toolInputEnd({
          id: event.id,
          name: state.toolNames[event.id] ?? "unknown",
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "tool-call":
      state.toolNames[event.toolCallId] = event.toolName
      return Effect.succeed([
        LLMEvent.toolCall({
          id: event.toolCallId,
          name: event.toolName,
          input: parseToolInput(event.input),
          providerExecuted: event.providerExecuted,
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "tool-result":
      delete state.toolNames[event.toolCallId]
      return Effect.succeed([
        LLMEvent.toolResult({
          id: event.toolCallId,
          name: event.toolName,
          result: ToolResultValue.make(event.result, event.isError ? "error" : "json"),
          providerExecuted: true,
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "finish":
      return Effect.succeed([
        LLMEvent.stepFinish({
          index: state.step++,
          reason: finishReason(event.finishReason),
          usage: usage(event.usage),
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
        LLMEvent.finish({
          reason: finishReason(event.finishReason),
          usage: usage(event.usage),
          providerMetadata: providerMetadata(event.providerMetadata),
        }),
      ])
    case "error":
      return Effect.fail(llmError("stream", event.error))
  }
}

function usage(input: Extract<LanguageModelV3StreamPart, { type: "finish" }>["usage"]): UsageInput | undefined {
  const output = {
    inputTokens: input.inputTokens.total,
    nonCachedInputTokens: input.inputTokens.noCache,
    cacheReadInputTokens: input.inputTokens.cacheRead,
    cacheWriteInputTokens: input.inputTokens.cacheWrite,
    outputTokens: input.outputTokens.total,
    reasoningTokens: input.outputTokens.reasoning,
    totalTokens:
      input.inputTokens.total === undefined || input.outputTokens.total === undefined
        ? undefined
        : input.inputTokens.total + input.outputTokens.total,
  }
  return Object.values(output).some((value) => value !== undefined) ? output : undefined
}

function finishReason(value: LanguageModelV3FinishReason): FinishReason {
  return value.unified === "other" ? "unknown" : value.unified
}

function providerMetadata(value: unknown) {
  return Schema.is(ProviderMetadata)(value) ? value : undefined
}

function parseToolInput(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function jsonObject(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, jsonValue(value)]))
}

function jsonValue(input: unknown): JSONValue {
  try {
    const encoded = JSON.stringify(input)
    return encoded === undefined ? null : (JSON.parse(encoded) as JSONValue)
  } catch {
    return messageValue(input)
  }
}

function messageValue(input: unknown) {
  if (typeof input === "string") return input
  try {
    return JSON.stringify(input) ?? String(input)
  } catch {
    return String(input)
  }
}

function llmError(method: string, error: unknown) {
  const reason =
    error instanceof LLMError
      ? new InvalidProviderOutputReason({ message: error.message })
      : new UnknownProviderReason({ message: error instanceof Error ? error.message : String(error) })
  return new LLMError({
    module: "AISDK",
    method,
    reason,
  })
}

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
