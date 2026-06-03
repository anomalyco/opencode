import { type LLMEvent, type ToolResultValue, type Usage } from "@opencode-ai/llm"
import { DateTime, Effect } from "effect"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { ToolOutput } from "../../tool-output"
import { SessionEvent } from "../event"
import { SessionSchema } from "../schema"

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly agent: string
  readonly model: ModelV2.Ref
}

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

const tokens = (usage: Usage | undefined) => {
  const reasoning = safe(usage?.reasoningTokens)
  const read = safe(usage?.cacheReadInputTokens)
  const write = safe(usage?.cacheWriteInputTokens)
  return {
    input: safe(usage?.nonCachedInputTokens),
    output: safe(usage?.visibleOutputTokens),
    reasoning,
    cache: { read, write },
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value }

const message = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

type ToolOutput =
  | { readonly structured: Record<string, unknown>; readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string } | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }> }
  | { readonly error: { readonly type: "unknown"; readonly message: string } }

const output = (result: ToolResultValue): ToolOutput => {
  switch (result.type) {
    case "json":
      return { structured: record(result.value), content: [] }
    case "text":
      return { structured: {}, content: [ToolOutput.text({ type: "text", text: message(result.value) })] }
    case "content":
      return {
        structured: {},
        content: result.value.map((item: (typeof result.value)[number]) =>
          item.type === "text"
            ? ToolOutput.text({ type: "text", text: item.text })
            : ToolOutput.file({ type: "file", uri: item.data, mime: item.mediaType, name: item.filename })),
      }
    case "error":
      return { error: { type: "unknown" as const, message: message(result.value) } }
  }
  throw new Error(`Unsupported tool result: ${message(result)}`)
}

/** Persist one provider turn without executing tools or starting a continuation turn. */
export const createLLMEventPublisher = (events: EventV2.Interface, input: Input) => {
  const text = new Map<string, string[]>()
  const reasoning = new Map<string, string>()
  const tools = new Map<
    string,
    { readonly assistantMessageID: EventV2.ID; readonly name: string; input: string; inputEnded: boolean; called: boolean; settled: boolean; providerExecuted: boolean }
  >()
  const timestamp = DateTime.now
  let assistantMessageID: EventV2.ID | undefined

  const currentAssistantMessageID = () =>
    assistantMessageID === undefined
      ? Effect.die("Tool event before assistant step start")
      : Effect.succeed(assistantMessageID)

  const endText = Effect.fnUntraced(function* (textID: string) {
    const chunks = text.get(textID)
    if (!chunks) return yield* Effect.die(`Text end before start: ${textID}`)
    yield* events.publish(SessionEvent.Text.Ended, {
      sessionID: input.sessionID,
      timestamp: yield* timestamp,
      textID,
      text: chunks.join(""),
    })
    text.delete(textID)
  })

  const flushText = Effect.fn("SessionRunner.flushText")(function* () {
    for (const textID of text.keys()) yield* endText(textID)
  })

  const startToolInput = Effect.fnUntraced(function* (event: { readonly id: string; readonly name: string }) {
    if (tools.has(event.id)) return yield* Effect.die(`Duplicate tool input start: ${event.id}`)
    const assistantMessageID = yield* currentAssistantMessageID()
    tools.set(event.id, { assistantMessageID, name: event.name, input: "", inputEnded: false, called: false, settled: false, providerExecuted: false })
    yield* events.publish(SessionEvent.Tool.Input.Started, {
      sessionID: input.sessionID,
      timestamp: yield* timestamp,
      assistantMessageID,
      callID: event.id,
      name: event.name,
    })
  })

  const endToolInput = Effect.fnUntraced(function* (event: { readonly id: string; readonly name: string }) {
    const tool = tools.get(event.id)
    if (!tool) return yield* Effect.die(`Tool input end before start: ${event.id}`)
    if (tool.name !== event.name) return yield* Effect.die(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`)
    if (tool.inputEnded) return yield* Effect.die(`Duplicate tool input end: ${event.id}`)
    tool.inputEnded = true
    yield* events.publish(SessionEvent.Tool.Input.Ended, {
      sessionID: input.sessionID,
      timestamp: yield* timestamp,
      assistantMessageID: tool.assistantMessageID,
      callID: event.id,
      text: tool.input,
    })
  })

  const publish = Effect.fn("SessionRunner.publishLLMEvent")(function* (event: LLMEvent) {
    switch (event.type) {
      case "step-start":
        assistantMessageID = (yield* events.publish(SessionEvent.Step.Started, { ...input, timestamp: yield* timestamp })).id
        return
      case "text-start":
        if (text.has(event.id)) return yield* Effect.die(`Duplicate text start: ${event.id}`)
        text.set(event.id, [])
        yield* events.publish(SessionEvent.Text.Started, { sessionID: input.sessionID, timestamp: yield* timestamp, textID: event.id })
        return
      case "text-delta":
        {
          const chunks = text.get(event.id)
          if (!chunks) return yield* Effect.die(`Text delta before start: ${event.id}`)
          chunks.push(event.text)
        }
        yield* events.publish(SessionEvent.Text.Delta, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          textID: event.id,
          delta: event.text,
        })
        return
      case "text-end":
        yield* endText(event.id)
        return
      case "reasoning-start":
        if (reasoning.has(event.id)) return yield* Effect.die(`Duplicate reasoning start: ${event.id}`)
        reasoning.set(event.id, "")
        yield* events.publish(SessionEvent.Reasoning.Started, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          reasoningID: event.id,
        })
        return
      case "reasoning-delta":
        if (!reasoning.has(event.id)) return yield* Effect.die(`Reasoning delta before start: ${event.id}`)
        reasoning.set(event.id, `${reasoning.get(event.id)}${event.text}`)
        yield* events.publish(SessionEvent.Reasoning.Delta, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          reasoningID: event.id,
          delta: event.text,
        })
        return
      case "reasoning-end": {
        const value = reasoning.get(event.id)
        if (value === undefined) return yield* Effect.die(`Reasoning end before start: ${event.id}`)
        reasoning.delete(event.id)
        yield* events.publish(SessionEvent.Reasoning.Ended, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          reasoningID: event.id,
          text: value,
        })
        return
      }
      case "tool-input-start":
        yield* startToolInput(event)
        return
      case "tool-input-delta": {
        const tool = tools.get(event.id)
        if (!tool) return yield* Effect.die(`Tool input delta before start: ${event.id}`)
        if (tool.name !== event.name) return yield* Effect.die(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`)
        if (tool.inputEnded) return yield* Effect.die(`Tool input delta after end: ${event.id}`)
        tool.input += event.text
        yield* events.publish(SessionEvent.Tool.Input.Delta, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          delta: event.text,
        })
        return
      }
      case "tool-input-end":
        yield* endToolInput(event)
        return
      case "tool-call": {
        if (!tools.has(event.id)) yield* startToolInput(event)
        const tool = tools.get(event.id)!
        if (!tool.inputEnded) yield* endToolInput(event)
        if (tool.name !== event.name) return yield* Effect.die(`Tool call name changed for ${event.id}: ${tool.name} -> ${event.name}`)
        if (tool.called) return yield* Effect.die(`Duplicate tool call: ${event.id}`)
        tool.called = true
        tool.providerExecuted = event.providerExecuted === true
        yield* events.publish(SessionEvent.Tool.Called, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          tool: event.name,
          input: record(event.input),
          provider: {
            executed: tool.providerExecuted,
            ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
          },
        })
        return
      }
      case "tool-result": {
        const tool = tools.get(event.id)
        if (!tool?.called) return yield* Effect.die(`Tool result before call: ${event.id}`)
        if (tool.name !== event.name) return yield* Effect.die(`Tool result name changed for ${event.id}: ${tool.name} -> ${event.name}`)
        if (tool.settled) {
          if (event.result.type === "error") return
          return yield* Effect.die(`Duplicate tool result: ${event.id}`)
        }
        tool.settled = true
        const result = output(event.result)
        const provider = {
          executed: event.providerExecuted === true || tool.providerExecuted,
          ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
        }
        if ("error" in result) {
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID: input.sessionID,
            timestamp: yield* timestamp,
            assistantMessageID: tool.assistantMessageID,
            callID: event.id,
            error: result.error,
            provider,
          })
          return
        }
        yield* events.publish(SessionEvent.Tool.Success, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          ...result,
          provider,
        })
        return
      }
      case "tool-error": {
        const tool = tools.get(event.id)
        if (!tool?.called) return yield* Effect.die(`Tool error before call: ${event.id}`)
        if (tool.name !== event.name) return yield* Effect.die(`Tool error name changed for ${event.id}: ${tool.name} -> ${event.name}`)
        if (tool.settled) return yield* Effect.die(`Duplicate tool error: ${event.id}`)
        tool.settled = true
        yield* events.publish(SessionEvent.Tool.Failed, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          error: { type: "unknown", message: event.message },
          provider: {
            executed: tool.providerExecuted,
            ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
          },
        })
        return
      }
      case "step-finish":
        yield* flushText()
        yield* events.publish(SessionEvent.Step.Ended, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          finish: event.reason,
          cost: 0,
          tokens: tokens(event.usage),
        })
        return
      case "finish":
        return
      case "provider-error":
        yield* flushText()
        yield* events.publish(SessionEvent.Step.Failed, {
          sessionID: input.sessionID,
          timestamp: yield* timestamp,
          error: { type: "unknown", message: event.message },
        })
        return
    }
  })

  return { publish, flushText }
}
