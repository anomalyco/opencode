import { Cause, Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { RequestExecutor } from "./executor.js"
import type {
  HttpMiddleware,
  TransportExecution,
  TransportRuntime,
  WebSocketChannelExecutor,
} from "./transport/index.js"
import { applyCachePolicy } from "../cache-policy.js"
import { applyEffortUpdates } from "../effort-updates.js"
import { mapToolUpdates, planToolUpdates } from "../tool-updates.js"
import { normalizeToolHistory } from "../tool-history.js"
import { sanitizeSurrogates } from "../utils/sanitize.js"
import * as ProviderShared from "../protocols/shared.js"
import { ToolSchemaProjection } from "../protocols/utils/tool-schema.js"
import type { ProviderOptions } from "../schema/index.js"
import type { LLMRequestInput } from "../llm.js"
import {
  AIError,
  CompactionResponse,
  CompactionCheckpointResponse,
  AIErrorReason,
  LLMResponse,
  ResponseFold,
  LanguageModel,
  Message,
  LLMEvent,
  InvalidProviderOutputError,
  ToolChoice,
  ToolEntry,
  type LLMRequest,
  mergeGeneration,
  mergeProviderOptions,
  mergeTransport,
  withPartial,
} from "../schema/index.js"

export interface Interface {
  readonly compact: CompactMethod
  readonly stream: StreamMethod
  readonly generate: GenerateMethod
}

export interface StreamOptions {
  readonly http?: HttpMiddleware
  readonly webSocket?: WebSocketChannelExecutor
}

export interface StreamMethod {
  (request: LLMRequest, options?: StreamOptions): Stream.Stream<LLMEvent, AIError>
}

export interface GenerateMethod {
  (request: LLMRequest, options?: StreamOptions): Effect.Effect<LLMResponse, AIError>
}

export type CompactOperation = (
  request: LLMRequest,
  executor: RequestExecutor.Interface,
  options?: Pick<StreamOptions, "http">,
) => Effect.Effect<CompactionResponse, AIError>

export type TriggerCompactOperation = (
  request: LLMRequest,
  executor: RequestExecutor.Interface,
  options: TriggerCompactOptions,
) => Effect.Effect<CompactionCheckpointResponse, AIError>

/** Protocol capabilities, not deployment/model eligibility. */
export interface CompactionOperations {
  readonly endpoint?: CompactOperation
  readonly trigger?: TriggerCompactOperation
}

export interface EndpointCompactOptions extends Pick<StreamOptions, "http"> {
  readonly mechanism?: "endpoint"
  readonly webSocket?: never
}

export interface TriggerCompactOptions extends StreamOptions {
  readonly mechanism: "trigger"
}

type EndpointModel = LanguageModel<ProviderOptions, { readonly endpoint: CompactOperation }>
type TriggerModel = LanguageModel<ProviderOptions, { readonly trigger: TriggerCompactOperation }>

/** A text request whose model supports explicit compaction. */
export type CompactionRequest = LLMRequestInput & { readonly model: EndpointModel }
/** A text request whose model supports trigger compaction checkpoints. */
export type CheckpointRequest = LLMRequestInput & { readonly model: TriggerModel }

export interface CompactMethod<R = never> {
  (
    request: LLMRequest & { readonly model: TriggerModel },
    options: TriggerCompactOptions,
  ): Effect.Effect<CompactionCheckpointResponse, AIError, R>
  (
    request: LLMRequest & { readonly model: EndpointModel },
    options?: EndpointCompactOptions,
  ): Effect.Effect<CompactionResponse, AIError, R>
}

/** Whether a model, or a text request's model, supports compaction through the given mechanism. */
export function canCompact<Model extends LanguageModel>(
  model: Model,
  options: { readonly mechanism: "trigger" },
): model is Model & TriggerModel
export function canCompact<Request extends { readonly model: LanguageModel }>(
  request: Request,
  options: { readonly mechanism: "trigger" },
): request is Request & { readonly model: TriggerModel }
export function canCompact<Model extends LanguageModel>(
  model: Model,
  options?: { readonly mechanism?: "endpoint" },
): model is Model & EndpointModel
export function canCompact<Request extends { readonly model: LanguageModel }>(
  request: Request,
  options?: { readonly mechanism?: "endpoint" },
): request is Request & { readonly model: EndpointModel }
export function canCompact(
  target: LanguageModel | { readonly model: LanguageModel },
  options?: { readonly mechanism?: string },
) {
  const model = target instanceof LanguageModel ? target : target.model
  const served = model.capabilities?.compaction
  if (options?.mechanism === "trigger") return model.api.compact?.trigger !== undefined && served?.trigger !== false
  if (options?.mechanism !== undefined && options.mechanism !== "endpoint") return false
  return model.api.compact?.endpoint !== undefined && served?.endpoint !== false
}

const unsupportedCompaction = (model: LanguageModel, mechanism: string | undefined) => {
  if (mechanism !== undefined && mechanism !== "endpoint" && mechanism !== "trigger")
    return ProviderShared.invalidRequest(`Unknown compaction mechanism: ${mechanism}`)
  return ProviderShared.unsupportedOperation({
    operation: mechanism === "trigger" ? "compact.trigger" : "compact",
    provider: model.provider,
    route: model.api.id,
    message: `${label(model)} does not support ${mechanism === "trigger" ? "trigger" : "explicit"} compaction`,
  })
}

export class LLMClientService extends Context.Service<LLMClientService, Interface>()("@opencode/LLMClient") {}
export const Service = LLMClientService
export type Service = LLMClientService

const resolveRequestOptions = (request: LLMRequest): LLMRequest => {
  const messages = normalizeToolHistory(request.messages)
  const normalized = messages === request.messages ? request : { ...request, messages }
  const options = normalized.model.options
  return {
    ...normalized,
    ...mergeGeneration(options, normalized),
    providerOptions: mergeProviderOptions(options?.providerOptions, normalized.providerOptions),
    ...mergeTransport(options, normalized),
  }
}

const streamError = (route: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof AIError) return failed
  return ProviderShared.eventError(route, message, undefined, cause)
}

const incompleteStreamError = (route: string) =>
  new AIError({
    reason: new InvalidProviderOutputError({
      message: "The provider response ended unexpectedly.",
      classification: "incomplete-stream",
      route,
    }),
  })

const requireTerminalEvent = (route: string) => (events: Stream.Stream<LLMEvent, AIError>) =>
  Stream.suspend(() => {
    let terminal = false
    return events.pipe(
      Stream.mapEffect((event) => {
        // Raw events carry provider frames that may trail the terminal event.
        if (terminal && !LLMEvent.is.raw(event))
          return Effect.fail(
            ProviderShared.eventError(route, `Provider emitted ${event.type} after the terminal event`),
          )
        if (LLMEvent.is.finish(event)) terminal = true
        return Effect.succeed(event)
      }),
      Stream.onEnd(Effect.suspend(() => (terminal ? Effect.void : Effect.fail(incompleteStreamError(route))))),
    )
  })

const decodeJsonOption = Schema.decodeUnknownOption(ProviderShared.Json)

// JSON text frames are parsed; non-JSON sentinels such as `[DONE]` stay strings.
const rawFrame = (frame: unknown) =>
  typeof frame === "string" ? Option.getOrElse(decodeJsonOption(frame), () => frame) : frame

// Transports may interleave their own marker objects with provider frames, e.g. Gemini's continuation boundary.
const isProviderFrame = (frame: unknown) =>
  typeof frame !== "object" ||
  frame === null ||
  Array.isArray(frame) ||
  Object.getPrototypeOf(frame) === Object.prototype

const label = (model: LanguageModel) => `${model.provider}/${model.api.id}`

export const prepareTransport = (body: unknown, request: LLMRequest, options?: StreamOptions) => {
  const model = request.model
  return model.api.transport.prepare({
    body,
    request,
    endpoint: { baseURL: model.baseURL, path: model.api.path, query: model.query },
    auth: model.auth,
    encodeBody: ProviderShared.encodeJson,
    middleware: RequestExecutor.withFetch(request.fetch, options?.http),
    webSocket: options?.webSocket,
  })
}

export const streamPrepared = (
  prepared: unknown,
  request: LLMRequest,
  runtime: TransportRuntime,
  options?: StreamOptions,
): Stream.Stream<LLMEvent, AIError> => {
  const api = request.model.api
  const protocol = api.protocol
  const route = label(request.model)
  const decodeEvent = (frame: unknown) =>
    Schema.decodeUnknownEffect(protocol.stream.event)(frame).pipe(
      Effect.mapError((cause) =>
        ProviderShared.eventError(
          api.id,
          `Invalid ${route} stream event`,
          typeof frame === "string" ? frame : ProviderShared.encodeJson(frame),
          cause,
        ),
      ),
    )
  return Stream.unwrap(
    api.transport.execute(prepared, request, runtime, options).pipe(
      Effect.map((execution: TransportExecution<unknown>) => {
        const terminal = protocol.stream.terminal
        // Preserve assembled inputs; replace only serialized event fallbacks with their original wire data.
        const frameError =
          (frame: unknown, event: unknown = frame) =>
          (error: AIError) =>
            new AIError({
              reason: AIErrorReason.make({
                ...error.reason,
                message: error.reason.message,
                cause: error.reason.cause,
                body:
                  error.reason.body !== undefined && error.reason.body !== ProviderShared.encodeJson(event)
                    ? error.reason.body
                    : (execution.body?.(frame) ??
                      (typeof frame === "string" ? frame : ProviderShared.encodeJson(frame))),
              }),
            })
        const events = execution.frames.pipe(
          Stream.mapEffect((frame) =>
            decodeEvent(frame).pipe(
              Effect.catchCause((cause) => Effect.fail(streamError(route, `Failed to decode ${route} event`, cause))),
              Effect.map((event) => ({ event, frame })),
              Effect.mapError(frameError(frame)),
            ),
          ),
          terminal ? Stream.takeUntil(({ event }) => terminal(event)) : (stream) => stream,
        )
        const stream = Stream.suspend(() => {
          let state = protocol.stream.initial(request)
          const parsed = events.pipe(
            Stream.mapEffect(({ event, frame }) =>
              protocol.stream.step(state, event).pipe(
                Effect.catchCause((cause) => Effect.fail(streamError(route, `Failed to parse ${route} event`, cause))),
                Effect.map(([next, output]: readonly [unknown, ReadonlyArray<LLMEvent>]) => {
                  state = next
                  return request.includeRaw && isProviderFrame(frame)
                    ? [LLMEvent.raw({ data: execution.raw?.(frame) ?? rawFrame(frame) }), ...output]
                    : output
                }),
                Effect.mapError(frameError(frame, event)),
              ),
            ),
            Stream.flatMap(Stream.fromIterable),
          )
          const onHalt = protocol.stream.onHalt
          return onHalt
            ? parsed.pipe(
                Stream.concat(Stream.suspend(() => Stream.unwrap(onHalt(state).pipe(Effect.map(Stream.fromIterable))))),
              )
            : parsed
        }).pipe(
          Stream.catchCause((cause) => Stream.fail(streamError(route, `Failed to read ${route} stream`, cause))),
          requireTerminalEvent(route),
          Stream.mapError((error) =>
            error.reason.http !== undefined || execution.http === undefined
              ? error
              : new AIError({
                  reason: AIErrorReason.make({
                    ...error.reason,
                    message: error.reason.message,
                    cause: error.reason.cause,
                    http: error.reason.http ?? execution.http,
                  }),
                }),
          ),
        )
        return execution.complete ? stream.pipe(Stream.onEnd(execution.complete)) : stream
      }),
    ),
  )
}

const prepareRequest = (request: LLMRequest): LLMRequest => {
  const original = resolveRequestOptions(request)
  const sanitized = restoreClasses({ ...sanitizeSurrogates({ ...original, model: undefined }), model: original.model })
  // Deduplicate per sibling level; a tool and a namespace may share a name.
  const dedupe = (tools: LLMRequest["tools"]): LLMRequest["tools"] =>
    [...new Map(tools.map((tool) => [`${tool.type}:${tool.name}`, tool])).values()].map((tool) =>
      tool.type === "tool" ? tool : { ...tool, tools: dedupe(tool.tools) },
    )
  const project = (tools: LLMRequest["tools"]) => ToolSchemaProjection.tools(dedupe(tools), sanitized.model)
  const updated = planToolUpdates(sanitized)
  const resolved = applyCachePolicy(
    applyEffortUpdates(mapToolUpdates({ ...updated, tools: project(updated.tools) }, project)),
  )
  const headers = resolved.model.api.headers?.({ request: resolved })
  return headers === undefined ? resolved : { ...resolved, headers: { ...headers, ...resolved.headers } }
}

// Sanitizing copies changed class instances into plain records; rebuild them so protocols see the canonical classes.
const restoreClasses = (request: LLMRequest): LLMRequest => ({
  ...request,
  messages: request.messages.map(Message.make),
  tools: request.tools.map(ToolEntry.make),
  toolChoice: request.toolChoice === undefined ? undefined : ToolChoice.make(request.toolChoice),
})

const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest, options?: StreamOptions) {
  const references = request.messages.flatMap((message) =>
    message.content.flatMap((part) => {
      if (part.type === "media") {
        const source = part.media.source
        return source.type === "url" ? [source.url] : source.type === "ref" ? [source.id] : []
      }
      if (part.type !== "tool-result" || part.result.type !== "content") return []
      return part.result.value.flatMap((item) => (item.type === "file" ? [item.uri] : []))
    }),
  )
  if (references.some((reference) => /^\s*file:/i.test(reference)))
    return yield* ProviderShared.invalidRequest(
      "Local file references must be read with Media.file(path) before sending",
    )
  const resolved = prepareRequest(request)
  const body = yield* resolved.model.api.protocol.body.from(resolved)
  const prepared = yield* prepareTransport(body, resolved, options)
  return { request: resolved, body, prepared }
})

/** Test-only projection of the execution compiler; exported from `@opencode/ai/testing`. */
export const compileRequest = Effect.fn("LLM.compileRequest")(function* (request: LLMRequest) {
  const compiled = yield* compile(request)
  return {
    id: compiled.request.id ?? "request",
    api: compiled.request.model.api.id,
    protocol: compiled.request.model.api.protocol.id,
    model: compiled.request.model,
    body: compiled.body,
    metadata: { transport: compiled.request.model.api.transport.id },
  }
})

const streamRequestWith = (runtime: TransportRuntime) => (request: LLMRequest, options?: StreamOptions) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request, options)
      return streamPrepared(compiled.prepared, compiled.request, runtime, options)
    }),
  )

export const generateWith = (stream: Interface["stream"]) =>
  Effect.fn("LLM.generate")(function* (request: LLMRequest, options?: StreamOptions) {
    let state = ResponseFold.empty()
    yield* stream(request, options).pipe(
      Stream.runForEach((event) => Effect.sync(() => (state = ResponseFold.reduce(state, event)))),
      Effect.mapError((error) => withPartial(error, ResponseFold.partial(state))),
    )
    const response = ResponseFold.complete(state)
    if (response) return response
    return yield* withPartial(incompleteStreamError(label(request.model)), ResponseFold.partial(state))
  })

export function stream(request: LLMRequest, options?: StreamOptions): Stream.Stream<LLMEvent, AIError, Service> {
  return Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(request, options)
    }),
  )
}

export function generate(request: LLMRequest, options?: StreamOptions): Effect.Effect<LLMResponse, AIError, Service> {
  return Effect.gen(function* () {
    return yield* (yield* Service).generate(request, options)
  })
}

/** Compact through the client for `options.mechanism`, failing typed when the request's route does not support it. */
export function compactRequest(
  request: LLMRequest,
  options?: EndpointCompactOptions | TriggerCompactOptions,
): Effect.Effect<CompactionResponse | CompactionCheckpointResponse, AIError, Service> {
  return Effect.gen(function* () {
    const client = yield* Service
    if (options?.mechanism === "trigger" && canCompact(request, options)) return yield* client.compact(request, options)
    if ((options?.mechanism === undefined || options.mechanism === "endpoint") && canCompact(request))
      return yield* client.compact(request, options)
    return yield* unsupportedCompaction(request.model, options?.mechanism)
  })
}

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const stream = streamRequestWith({ http: executor })
    function compact(
      request: LLMRequest & { readonly model: TriggerModel },
      options: TriggerCompactOptions,
    ): Effect.Effect<CompactionCheckpointResponse, AIError>
    function compact(
      request: LLMRequest & { readonly model: EndpointModel },
      options?: EndpointCompactOptions,
    ): Effect.Effect<CompactionResponse, AIError>
    function compact(request: LLMRequest, options?: EndpointCompactOptions | TriggerCompactOptions) {
      return Effect.suspend((): Effect.Effect<CompactionResponse | CompactionCheckpointResponse, AIError> => {
        if (options?.mechanism === "trigger" && canCompact(request, options))
          return request.model.api.compact.trigger(prepareRequest(request), executor, options)
        if ((options?.mechanism === undefined || options.mechanism === "endpoint") && canCompact(request))
          return request.model.api.compact.endpoint(prepareRequest(request), executor, options)
        return unsupportedCompaction(request.model, options?.mechanism)
      })
    }
    return Service.of({
      stream,
      generate: generateWith(stream),
      compact,
    })
  }),
)

export const LLMClient = {
  Service,
  layer,
  stream,
  generate,
} as const
