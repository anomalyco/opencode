import { Effect } from "effect"
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
  const texts: Array<string> = []
  for (const event of events) {
    if (event.type === "text-delta") texts.push(event.text)
    if (event.type === "reasoning-delta") texts.push(`[reasoning]: ${event.text}`)
    if (event.type === "tool-call") texts.push(`tool-call(${event.name}): ${JSON.stringify(event.input)}`)
    if (event.type === "tool-result") texts.push(`tool-result(${event.name}): ${JSON.stringify(event.result)}`)
    if (event.type === "finish" && event.usage) {
      texts.push(`usage: ${JSON.stringify(event.usage)}`)
    }
  }
  return texts.join("")
}

const logAtLevel = (level: LogLevel, label: string, data: Record<string, unknown>): Effect.Effect<void> => {
  switch (level) {
    case "info": return Effect.logInfo(label, data)
    case "debug": return Effect.logDebug(label, data)
    case "trace": return Effect.logDebug(label, data)
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
  return logAtLevel(level, "LLM request", payload)
}

export const logEvents = (request: LLMRequest, events: ReadonlyArray<LLMEvent>, level: LogLevel): Effect.Effect<void> =>
  logAtLevel(level, "LLM response", {
    model: `${request.model.provider}/${request.model.id}`,
    response: formatEvents(events),
  })

export * as MessageLogger from "./message-logger"
