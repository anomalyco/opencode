import { Effect, Stream } from "effect"
import type { LLMEvent, LLMRequest } from "../schema"

export type LogLevel = "info" | "debug" | "trace"

export const formatMessages = (request: LLMRequest): string => {
  const parts: Array<string> = []
  for (const part of request.system) {
    if (part.type === "text") parts.push(`system: ${part.text}`)
  }
  for (const message of request.messages) {
    const texts: Array<string> = []
    for (const part of message.content) {
      if (part.type === "text") texts.push(part.text)
      if (part.type === "tool-call") texts.push(`tool-call(${part.name}): ${JSON.stringify(part.input)}`)
      if (part.type === "tool-result") texts.push(`tool-result(${part.name}): ${JSON.stringify(part.result)}`)
    }
    parts.push(`${message.role}: ${texts.join("\n")}`)
  }
  return parts.join("\n")
}

export const formatEvents = (events: ReadonlyArray<LLMEvent>): string => {
  const segments: Array<string> = []
  let pending = ""
  let kind: "text" | "reasoning" = "text"
  const flush = () => {
    if (!pending) return
    segments.push(kind === "reasoning" ? `[reasoning]: ${pending}` : pending)
    pending = ""
  }
  for (const event of events) {
    if (event.type === "text-delta") {
      if (kind !== "text") {
        flush()
        kind = "text"
      }
      pending += event.text
      continue
    }
    if (event.type === "reasoning-delta") {
      if (kind !== "reasoning") {
        flush()
        kind = "reasoning"
      }
      pending += event.text
      continue
    }
    if (event.type === "tool-call" || event.type === "tool-result") {
      flush()
      segments.push(
        event.type === "tool-call"
          ? `tool-call(${event.name}): ${JSON.stringify(event.input)}`
          : `tool-result(${event.name}): ${JSON.stringify(event.result)}`,
      )
      continue
    }
    if (event.type === "provider-error") {
      flush()
      segments.push(`error: ${event.message}`)
      continue
    }
    if (event.type === "finish" && event.usage) {
      flush()
      segments.push(`usage: ${JSON.stringify(event.usage)}`)
    }
  }
  flush()
  return segments.join("\n")
}

// Trace severity sits above Debug, so runtimes configured at Debug still pass
// trace entries through while keeping the three tiers distinguishable.
export const log = (level: LogLevel, label: string, data: Record<string, unknown>): Effect.Effect<void> => {
  switch (level) {
    case "info":
      return Effect.logInfo(label, data)
    case "debug":
      return Effect.logDebug(label, data)
    case "trace":
      return Effect.logTrace(label, data)
  }
}

export const logRequest = (request: LLMRequest, level: LogLevel, body?: unknown): Effect.Effect<void> => {
  const model = `${request.model.provider}/${request.model.id}`
  const payload: Record<string, unknown> = { model, messages: formatMessages(request) }
  if (level !== "info" && request.generation) {
    payload.generation = Object.fromEntries(
      Object.entries(request.generation).filter(([, value]) => value !== undefined),
    )
  }
  if (level === "trace" && body !== undefined) {
    payload.body = JSON.stringify(body)
  }
  return log(level, "LLM request", payload)
}

export const logEvents = (request: LLMRequest, events: ReadonlyArray<LLMEvent>, level: LogLevel): Effect.Effect<void> =>
  log(level, "LLM response", {
    model: `${request.model.provider}/${request.model.id}`,
    response: formatEvents(events),
  })

// Accumulates the response in the stream itself so a single "LLM response"
// entry is emitted once, when the terminal event (finish or provider-error)
// passes through, instead of one entry per streamed delta.
export const responseStream = (model: string, level: LogLevel) => {
  const collected: Array<LLMEvent> = []
  return <E>(events: Stream.Stream<LLMEvent, E>): Stream.Stream<LLMEvent, E> =>
    events.pipe(
      Stream.mapEffect((event) =>
        Effect.gen(function* () {
          collected.push(event)
          if (event.type === "finish" || event.type === "provider-error") {
            yield* log(level, "LLM response", { model, response: formatEvents(collected) })
          }
          return event
        }),
      ),
    )
}

export * as MessageLogger from "./message-logger"
