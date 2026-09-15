export * as SessionAdvisor from "./advisor"

import { Option, Schema } from "effect"
import { Advisor } from "@opencode-ai/schema/advisor"
import { MessageID, PartID, SessionID } from "./schema"
import { SessionV1, type WithParts } from "@opencode-ai/schema/session-v1"
import type { ModelMessage } from "ai"

export const endpoint = "https://api.anthropic.com/v1"
export const interrupted = "[Advisor consultation interrupted; no advice was received.]"
export const unavailable = "[Historical advisor consultation unavailable for native replay.]"

export const Result = Schema.Union([
  Schema.Struct({ type: Schema.Literal("advisor_result"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("advisor_redacted_result"), encryptedContent: Schema.String }),
  Schema.Struct({ type: Schema.Literal("advisor_tool_result_error"), errorCode: Schema.String }),
])
export type Result = typeof Result.Type

const origin = {
  version: Schema.Literal(1),
  providerID: Schema.String,
  executorModelID: Schema.String,
  endpoint: Schema.String,
}
const settings = { ...origin, ...Advisor.Settings.fields }

export const Call = Schema.Union([
  Schema.Struct({ ...settings, state: Schema.Literal("pending") }),
  Schema.Struct({ ...settings, state: Schema.Literal("completed"), result: Result }),
  Schema.Struct({ ...settings, state: Schema.Literal("abandoned"), result: Schema.optional(Result) }),
])
export type Call = typeof Call.Type

export const Entry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("part"), partID: PartID }),
  Schema.Struct({ type: Schema.Literal("advisor-result"), callID: Schema.String }),
])
export type Entry = typeof Entry.Type

const Count = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
export const Usage = Schema.Struct({
  complete: Schema.Boolean,
  cost: Count,
  iterations: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      input: Count,
      output: Count,
      cacheRead: Count,
      cacheWrite: Count,
      cost: Schema.optional(Count),
    }),
  ),
})
export type Usage = typeof Usage.Type

export const Response = Schema.Struct({
  ...origin,
  entries: Schema.Array(Entry),
  rawFinishReason: Schema.optional(Schema.String),
  interrupted: Schema.Boolean,
  usage: Schema.optional(Usage),
})
export type Response = typeof Response.Type

export type Owner = {
  sessionID: SessionID
  messageID: MessageID
  partID: PartID
  definition: Call
}

export type Run = {
  pending: Map<string, Owner>
  pauseResumptions: number
}

export function call(part: { metadata?: Record<string, unknown> }) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(Call)(part.metadata?.opencodeAdvisor))
}

export function response(part: { metadata?: Record<string, unknown> }) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(Response)(part.metadata?.opencodeAdvisor))
}

/**
 * Rewrite a response ledger's part references after parts were copied with new IDs (e.g. session fork).
 * Unknown references are left untouched so the replay fallback can detect them.
 */
export function remap<T extends { type: string; metadata?: Record<string, unknown> }>(
  part: T,
  ids: ReadonlyMap<string, PartID>,
): T {
  if (part.type !== "step-finish") return part
  const ledger = response(part)
  if (!ledger) return part
  const entries = ledger.entries.map((entry) =>
    entry.type === "part" ? { ...entry, partID: ids.get(entry.partID) ?? entry.partID } : entry,
  )
  return { ...part, metadata: { ...part.metadata, opencodeAdvisor: { ...ledger, entries } } }
}

type Content = Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string>[number]

/** Whether a projected history still carries native advisor blocks. */
export function native(messages: readonly ModelMessage[]) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          (part.type === "tool-call" && part.toolName === "advisor" && part.providerExecuted) ||
          (part.type === "tool-result" &&
            part.toolName === "advisor" &&
            (part.output.type === "json" || part.output.type === "error-json") &&
            Schema.is(Result)(part.output.value)),
      ),
  )
}

/**
 * Replace native advisor blocks with text markers. Used when the history was projected for a direct
 * Anthropic request but the effective route or credentials can no longer carry the beta.
 */
export function demote(messages: readonly ModelMessage[]): ModelMessage[] {
  const answered = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (part.type === "tool-result" && part.toolName === "advisor") answered.add(part.toolCallId)
    }
  }
  const output: ModelMessage[] = []
  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      output.push(message)
      continue
    }
    const content = message.content.flatMap((part): Content[] => {
      if (part.type === "tool-call" && part.toolName === "advisor" && part.providerExecuted) {
        return answered.has(part.toolCallId) ? [] : [{ type: "text", text: interrupted }]
      }
      if (part.type === "tool-result" && part.toolName === "advisor") {
        const value = part.output.type === "json" || part.output.type === "error-json" ? part.output.value : undefined
        return [{ type: "text", text: Schema.is(Result)(value) ? display(value) : unavailable }]
      }
      return [part]
    })
    if (content.length) output.push({ ...message, content })
  }
  return output
}

export function display(result: Result) {
  switch (result.type) {
    case "advisor_result":
      return result.text
    case "advisor_redacted_result":
      return "[Advisor consultation completed; advice is encrypted.]"
    case "advisor_tool_result_error":
      // The code is replayed into model context; only a plain identifier is rendered.
      return `[Advisor unavailable: ${/^[A-Za-z0-9_.-]{1,64}$/.test(result.errorCode) ? result.errorCode : "unknown"}]`
  }
}

export function tailStart(messages: WithParts[], start: number) {
  const owners = new Map<string, number>()
  const key = (sessionID: string, callID: string) => `${sessionID}\0${callID}`
  for (const [index, message] of messages.entries()) {
    for (const part of message.parts) {
      if (part.type === "tool" && call(part)?.state === "completed") owners.set(key(part.sessionID, part.callID), index)
    }
  }
  const spans = messages.flatMap((message, index) =>
    message.parts.flatMap((part) => {
      if (part.type !== "step-finish") return []
      const ledger = response(part)
      if (!ledger || ledger.interrupted) return []
      return ledger.entries.flatMap((entry) => {
        if (entry.type !== "advisor-result") return []
        const owner = owners.get(key(message.info.sessionID, entry.callID))
        return owner === undefined ? [] : [{ low: Math.min(owner, index), high: Math.max(owner, index) }]
      })
    }),
  )
  let boundary = start
  while (true) {
    const next = spans.reduce(
      (value, span) => (span.low < boundary && span.high >= boundary ? Math.min(value, span.low) : value),
      boundary,
    )
    if (next === boundary) return boundary
    boundary = next
  }
}

export function forShare(part: typeof SessionV1.Part.Type): typeof SessionV1.Part.Type {
  if ((part.type !== "tool" && part.type !== "step-finish") || part.metadata?.opencodeAdvisor === undefined) return part
  if (part.type === "step-finish") {
    const ledger = response(part)
    return {
      ...part,
      metadata: { opencodeAdvisor: { version: 1, redacted: true, ...(ledger?.usage ? { usage: ledger.usage } : {}) } },
    }
  }
  const native = call(part)
  const metadata = { providerExecuted: true, opencodeAdvisor: { version: 1, redacted: true } }
  if (part.state.status === "completed") {
    return {
      ...part,
      metadata,
      state: {
        ...part.state,
        input: {},
        metadata: {},
        output: native?.state === "completed" ? display(native.result) : unavailable,
      },
    }
  }
  if (part.state.status === "pending") return { ...part, metadata, state: { ...part.state, input: {}, raw: "" } }
  if (part.state.status === "error")
    return { ...part, metadata, state: { ...part.state, input: {}, metadata: {}, error: interrupted } }
  return { ...part, metadata, state: { ...part.state, input: {}, metadata: {} } }
}
