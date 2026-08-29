import { AIError, TransportError } from "../schema/index.js"
import type { ChannelCheckpoint, ChannelObservation, WebSocketChannelDriver } from "../route/transport/index.js"
import { Effect, Option, Schema } from "effect"
import * as ProviderShared from "./shared.js"
import { OpenResponses } from "./open-responses.js"

const PROTOCOL = "open-responses.websocket.v1"
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
  if (value.type === "reasoning")
    return {
      type: value.type,
      summary: value.summary,
      encrypted_content: value.encrypted_content,
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
  observation: Extract<ChannelObservation, { readonly type: "provider-failure" }>,
  recovery: "retry-full" | "rotate-and-retry-full",
): ChannelObservation => ({
  type: "rejected",
  recovery,
  error: new AIError({
    reason: new TransportError({
      message: observation.error.message,
      body: observation.error.reason.body,
      http: observation.error.reason.http,
      cause: observation.error.reason.cause,
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
          Effect.mapError((cause) =>
            ProviderShared.eventError(input.id, `Invalid ${input.name} WebSocket event`, frame, cause),
          ),
        )
        const observation = yield* input.base.observe(create, frame)
        if (event.type === "response.output_item.done" && event.item) output.push(event.item)
        if (observation.type === "provider-failure") {
          const rejection = code(event)
          if (rejection === "previous_response_not_found") return rejected(observation, "retry-full")
          if (rejection === "websocket_connection_limit_reached") return rejected(observation, "rotate-and-retry-full")
        }
        if (observation.type !== "completed") return observation
        const responseID = event.response?.id
        if (!responseID || responseID.trim().length === 0) return observation
        return {
          ...observation,
          checkpoint: {
            protocol: PROTOCOL,
            value: {
              version: VERSION,
              responseID,
              request,
              output: event.response?.output ? [...event.response.output] : output.slice(),
            } satisfies CheckpointValue,
          },
        }
      }),
  }
}

export const OpenResponsesContinuation = { driver } as const
