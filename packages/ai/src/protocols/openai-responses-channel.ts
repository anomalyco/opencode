import { AIError, TransportReason } from "../schema/index.js"
import type { ChannelCheckpoint, ChannelObservation, WebSocketChannelDriver } from "../route/transport/index.js"
import { Effect, Option, Schema } from "effect"
import * as ProviderShared from "./shared.js"
import { OpenResponses } from "./open-responses.js"

const PROTOCOL = "openai-responses.websocket.v1"
const VERSION = 1
const decodeEvent = Schema.decodeUnknownEffect(OpenResponses.protocol.stream.event)

interface CheckpointValue {
  readonly version: typeof VERSION
  readonly responseID: string
  readonly request: Readonly<Record<string, unknown>>
  readonly output: ReadonlyArray<unknown>
}

export interface DriverInput {
  readonly id: string
  readonly name: string
  readonly request: Readonly<Record<string, unknown>>
  readonly message: string
  readonly base: WebSocketChannelDriver
}

const checkpointValue = (checkpoint: ChannelCheckpoint | undefined): CheckpointValue | undefined => {
  if (checkpoint?.protocol !== PROTOCOL || !ProviderShared.isRecord(checkpoint.value)) return undefined
  if (checkpoint.value.version !== VERSION) return undefined
  if (typeof checkpoint.value.responseID !== "string" || checkpoint.value.responseID.trim().length === 0)
    return undefined
  if (!ProviderShared.isRecord(checkpoint.value.request) || !Array.isArray(checkpoint.value.output)) return undefined
  return {
    version: VERSION,
    responseID: checkpoint.value.responseID,
    request: checkpoint.value.request,
    output: checkpoint.value.output,
  }
}

const canonical = (value: unknown): string => {
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (!ProviderShared.isRecord(value)) return ProviderShared.encodeJson(value)
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${ProviderShared.encodeJson(key)}:${canonical(value[key])}`)
    .join(",")}}`
}

const json = (value: unknown) => {
  if (typeof value !== "string") return value
  return Option.getOrElse(Schema.decodeUnknownOption(ProviderShared.Json)(value), () => value)
}

const comparable = (value: unknown) => {
  if (!ProviderShared.isRecord(value)) return value
  if (value.type === "message" && value.role === "assistant")
    return {
      role: "assistant",
      content: value.content,
      ...(value.phase === undefined ? {} : { phase: value.phase }),
    }
  if (value.type === "function_call")
    return {
      type: value.type,
      call_id: value.call_id,
      name: value.name,
      arguments: json(value.arguments),
    }
  if (value.type === "reasoning") {
    const { id: _id, ...reasoning } = value
    return reasoning
  }
  return value
}

const invariant = (request: Readonly<Record<string, unknown>>) => {
  const { type: _type, input: _input, previous_response_id: _previousResponseID, ...rest } = request
  return rest
}

const incremental = (
  request: Readonly<Record<string, unknown>>,
  checkpoint: CheckpointValue,
): ReadonlyArray<unknown> | undefined => {
  const input = request.input
  const previousInput = checkpoint.request.input
  if (!Array.isArray(input) || !Array.isArray(previousInput)) return undefined
  if (canonical(invariant(request)) !== canonical(invariant(checkpoint.request))) return undefined
  const baseline = [...previousInput, ...checkpoint.output]
  if (input.length <= baseline.length) return undefined
  if (!baseline.every((item, index) => canonical(comparable(item)) === canonical(comparable(input[index]))))
    return undefined
  return input.slice(baseline.length)
}

const code = (event: OpenResponses.Event) => event.code || event.error?.code || event.response?.error?.code || undefined

const rejected = (
  input: DriverInput,
  observation: Extract<ChannelObservation, { readonly type: "provider-failure" }>,
  recovery: "retry-full" | "rotate-and-retry-full",
): ChannelObservation => ({
  type: "rejected",
  recovery,
  error: new AIError({
    module: input.id,
    method: "stream",
    reason: new TransportReason({
      message: observation.error.message,
      transport: "websocket",
      operation: "read",
      phase: "receive",
      delivery: "rejected",
      recovery,
    }),
  }),
})

export const driver = (input: DriverInput): WebSocketChannelDriver => {
  const { previous_response_id: _previousResponseID, ...request } = input.request
  let output: unknown[] = []
  return {
    create: (checkpoint) =>
      Effect.sync(() => {
        output = []
        const previous = checkpointValue(checkpoint)
        const delta = previous ? incremental(request, previous) : undefined
        if (!previous || !delta) return { message: ProviderShared.encodeJson(request), mode: "full" as const }
        return {
          message: ProviderShared.encodeJson({ ...request, input: delta, previous_response_id: previous.responseID }),
          mode: "incremental" as const,
        }
      }),
    observe: (create, frame) =>
      Effect.gen(function* () {
        const event = yield* decodeEvent(frame).pipe(
          Effect.mapError(() => ProviderShared.eventError(input.id, `Invalid ${input.name} WebSocket event`, frame)),
        )
        const observation = yield* input.base.observe(create, frame)
        if (event.type === "response.output_item.done" && event.item) output.push(event.item)
        if ((event.type === "response.completed" || event.type === "response.incomplete") && event.response?.output)
          output = [...event.response.output]
        if (observation.type === "provider-failure") {
          const rejection = code(event)
          if (rejection === "previous_response_not_found") return rejected(input, observation, "retry-full")
          if (rejection === "websocket_connection_limit_reached")
            return rejected(input, observation, "rotate-and-retry-full")
        }
        if (observation.type !== "completed") return observation
        const responseID = event.response?.id
        if (!responseID || responseID.trim().length === 0) return observation
        return {
          ...observation,
          checkpoint: {
            protocol: PROTOCOL,
            value: { version: VERSION, responseID, request, output: output.slice() } satisfies CheckpointValue,
          },
        }
      }),
  }
}

export const OpenAIResponsesChannel = { driver } as const
