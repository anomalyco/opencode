import { ToolOutput, type LLMEvent, type ProviderMetadata, type ToolResultValue, type Usage } from "@opencode-ai/llm"
import { Effect } from "effect"
import { EventV2 } from "../../event"
import { ModelV2 } from "../../model"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Money } from "@opencode-ai/schema/money"
import { AgentV2 } from "../../agent"
import { Snapshot } from "../../snapshot"

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly model: ModelV2.Ref
  readonly providerMetadataKey: string
  readonly snapshot?: Snapshot.ID
  readonly assistantMessageID?: SessionMessage.ID
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

type SettledOutput =
  | { readonly structured: Record<string, unknown>; readonly content: ToolOutput["content"] }
  | { readonly error: SessionError.Error }

const settledOutput = (value: ToolOutput | undefined, result: ToolResultValue): SettledOutput => {
  if (result.type === "error") return { error: { type: "tool.execution", message: message(result.value) } }
  const settled = value ?? ToolOutput.fromResultValue(result)
  if (!settled) throw new Error(`Unsupported tool result: ${message(result)}`)
  return { structured: record(settled.structured), content: settled.content }
}

/** Persist one step without executing tools or starting a continuation step. */
export const createLLMEventPublisher = (events: Pick<EventV2.Interface, "publish">, input: Input) => {
  const tools = new Map<
    string,
    {
      readonly assistantMessageID: SessionMessage.ID
      readonly name: string
      called: boolean
      settled: boolean
      providerExecuted: boolean
    }
  >()
  let assistantMessageID = input.assistantMessageID
  let stepStarted = false
  let stepFailed = false
  let providerFailed = false
  let retryEvidence = false
  let stepFailure: SessionError.Error | undefined
  let stepSettlement:
    | {
        readonly finish: Extract<LLMEvent, { type: "step-finish" }>["reason"]
        readonly tokens: ReturnType<typeof tokens>
      }
    | undefined

  const startAssistant = Effect.fnUntraced(function* () {
    if (stepStarted && assistantMessageID !== undefined) return assistantMessageID
    assistantMessageID ??= SessionMessage.ID.create()
    stepStarted = true
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      assistantMessageID,
      snapshot: input.snapshot,
    })
    return assistantMessageID
  })
  const currentAssistantMessageID = () =>
    assistantMessageID === undefined
      ? Effect.die(new Error("Tool event before assistant step start"))
      : Effect.succeed(assistantMessageID)
  const providerState = (metadata: ProviderMetadata | undefined) => metadata?.[input.providerMetadataKey]
  const fragments = (
    name: string,
    ended: (id: string, value: string, ordinal: number, state?: Record<string, unknown>) => Effect.Effect<void>,
    single = false,
  ) => {
    const chunks = new Map<
      string,
      { readonly ordinal: number; readonly values: string[]; state?: Record<string, unknown> }
    >()
    let nextOrdinal = 0
    const start = (id: string, state?: Record<string, unknown>) =>
      Effect.suspend(() => {
        if (chunks.has(id)) return Effect.die(new Error(`Duplicate ${name} start: ${id}`))
        if (single && chunks.size > 0) return Effect.die(new Error(`${name} start before end: ${id}`))
        const ordinal = nextOrdinal++
        chunks.set(id, { ordinal, values: [], state })
        return Effect.succeed(ordinal)
      })
    const append = (id: string, value: string, state?: Record<string, unknown>) =>
      Effect.suspend(() => {
        const current = chunks.get(id)
        if (!current) return Effect.die(new Error(`${name} delta before start: ${id}`))
        current.values.push(value)
        if (state !== undefined) current.state = { ...current.state, ...state }
        return Effect.succeed(current.ordinal)
      })
    const end = Effect.fnUntraced(function* (id: string, state?: Record<string, unknown>) {
      const current = chunks.get(id)
      if (!current) return yield* Effect.die(new Error(`${name} end before start: ${id}`))
      yield* ended(
        id,
        current.values.join(""),
        current.ordinal,
        state === undefined ? current.state : { ...current.state, ...state },
      )
      chunks.delete(id)
    })
    const flush = Effect.fnUntraced(function* () {
      for (const id of chunks.keys()) yield* end(id)
    })
    return { start, append, end, flush, has: (id: string) => chunks.has(id) }
  }

  const text = fragments(
    "text",
    (_textID, value, ordinal) =>
      Effect.gen(function* () {
        yield* events.publish(SessionEvent.Text.Ended, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          text: value,
        })
      }),
    true,
  )
  const reasoning = fragments(
    "reasoning",
    (_reasoningID, value, ordinal, state) =>
      Effect.gen(function* () {
        yield* events.publish(SessionEvent.Reasoning.Ended, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          text: value,
          state,
        })
      }),
    true,
  )
  const toolInput = fragments("tool input", (callID, value) =>
    Effect.gen(function* () {
      const tool = tools.get(callID)
      if (!tool) return yield* Effect.die(new Error(`Tool input end before start: ${callID}`))
      yield* events.publish(SessionEvent.Tool.Input.Ended, {
        sessionID: input.sessionID,
        assistantMessageID: tool.assistantMessageID,
        callID,
        text: value,
      })
    }),
  )

  const flushFragments = Effect.fnUntraced(function* () {
    yield* text.flush()
    yield* reasoning.flush()
    yield* toolInput.flush()
  })

  const startToolInput = Effect.fnUntraced(function* (event: { readonly id: string; readonly name: string }) {
    if (tools.has(event.id)) return yield* Effect.die(new Error(`Duplicate tool input start: ${event.id}`))
    const assistantMessageID = yield* startAssistant()
    tools.set(event.id, {
      assistantMessageID,
      name: event.name,
      called: false,
      settled: false,
      providerExecuted: false,
    })
    yield* toolInput.start(event.id)
    yield* events.publish(SessionEvent.Tool.Input.Started, {
      sessionID: input.sessionID,
      assistantMessageID,
      callID: event.id,
      name: event.name,
    })
  })

  const endToolInput = Effect.fnUntraced(function* (event: { readonly id: string; readonly name: string }) {
    const tool = tools.get(event.id)
    if (!tool) return yield* Effect.die(new Error(`Tool input end before start: ${event.id}`))
    if (tool.name !== event.name)
      return yield* Effect.die(new Error(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`))
    if (!toolInput.has(event.id)) return yield* Effect.die(new Error(`Duplicate tool input end: ${event.id}`))
    yield* toolInput.end(event.id)
  })

  const flush = Effect.fn("SessionRunner.flush")(function* () {
    yield* flushFragments()
  })

  const failTools = Effect.fnUntraced(function* (error: SessionError.Error, mode: "all" | "hosted" | "uncalled") {
    let failed = false
    for (const [callID, tool] of tools) {
      if (
        tool.settled ||
        (mode === "hosted" && !tool.providerExecuted) ||
        (mode === "uncalled" && tool.called)
      )
        continue
      tool.settled = true
      failed = true
      yield* events.publish(SessionEvent.Tool.Failed, {
        sessionID: input.sessionID,
        assistantMessageID: tool.assistantMessageID,
        callID,
        error,
        executed: tool.providerExecuted,
      })
    }
    return failed
  })

  const failAssistant = Effect.fnUntraced(function* (error: SessionError.Error, replace = false) {
    yield* flush()
    yield* failTools(error, "uncalled")
    yield* startAssistant()
    if (replace || stepFailure === undefined) stepFailure = error
  })

  const publishStepFailure = Effect.fnUntraced(function* (usage?: {
    readonly cost: Money.USD
    readonly tokens: ReturnType<typeof tokens>
  }) {
    if (stepFailed || stepFailure === undefined) return
    const assistantMessageID = yield* startAssistant()
    stepFailed = true
    yield* events.publish(SessionEvent.Step.Failed, {
      sessionID: input.sessionID,
      assistantMessageID,
      error: stepFailure,
      ...usage,
    })
  })

  const failUnsettledTools = Effect.fn("SessionRunner.failUnsettledTools")(function* (
    error: SessionError.Error,
    hostedOnly = false,
  ) {
    return yield* failTools(error, hostedOnly ? "hosted" : "all")
  })

  const assistantMessageIDForTool = (callID: string) => {
    const tool = tools.get(callID)
    return tool ? Effect.succeed(tool.assistantMessageID) : Effect.die(new Error(`Unknown tool call: ${callID}`))
  }

  const publish = Effect.fn("SessionRunner.publishLLMEvent")(function* (event: LLMEvent, error?: SessionError.Error) {
    switch (event.type) {
      case "step-start":
        yield* startAssistant()
        return
      case "text-start":
        retryEvidence = true
        const startedTextOrdinal = yield* text.start(event.id)
        yield* events.publish(SessionEvent.Text.Started, {
          sessionID: input.sessionID,
          assistantMessageID: yield* startAssistant(),
          ordinal: startedTextOrdinal,
        })
        return
      case "text-delta":
        const deltaTextOrdinal = yield* text.append(event.id, event.text)
        yield* events.publish(SessionEvent.Text.Delta, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal: deltaTextOrdinal,
          delta: event.text,
        })
        return
      case "text-end":
        yield* text.end(event.id)
        return
      case "reasoning-start":
        retryEvidence = true
        const startedReasoningOrdinal = yield* reasoning.start(event.id, providerState(event.providerMetadata))
        yield* events.publish(SessionEvent.Reasoning.Started, {
          sessionID: input.sessionID,
          assistantMessageID: yield* startAssistant(),
          ordinal: startedReasoningOrdinal,
          state: providerState(event.providerMetadata),
        })
        return
      case "reasoning-delta":
        const deltaReasoningOrdinal = yield* reasoning.append(
          event.id,
          event.text,
          providerState(event.providerMetadata),
        )
        yield* events.publish(SessionEvent.Reasoning.Delta, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal: deltaReasoningOrdinal,
          delta: event.text,
        })
        return
      case "reasoning-end":
        yield* reasoning.end(event.id, providerState(event.providerMetadata))
        return
      case "tool-input-start":
        retryEvidence = true
        yield* startToolInput(event)
        return
      case "tool-input-delta": {
        const tool = tools.get(event.id)
        if (!tool) return yield* Effect.die(new Error(`Tool input delta before start: ${event.id}`))
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (!toolInput.has(event.id)) return yield* Effect.die(new Error(`Tool input delta after end: ${event.id}`))
        yield* toolInput.append(event.id, event.text)
        yield* events.publish(SessionEvent.Tool.Input.Delta, {
          sessionID: input.sessionID,
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
        retryEvidence = true
        if (!tools.has(event.id)) yield* startToolInput(event)
        const tool = tools.get(event.id)!
        if (toolInput.has(event.id)) yield* endToolInput(event)
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool call name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (tool.called) return yield* Effect.die(new Error(`Duplicate tool call: ${event.id}`))
        tool.called = true
        tool.providerExecuted = event.providerExecuted === true
        yield* events.publish(SessionEvent.Tool.Called, {
          sessionID: input.sessionID,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          input: record(event.input),
          executed: tool.providerExecuted,
          state: providerState(event.providerMetadata),
        })
        return
      }
      case "tool-result": {
        const tool = tools.get(event.id)
        if (!tool?.called) return yield* Effect.die(new Error(`Tool result before call: ${event.id}`))
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool result name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (tool.settled) {
          if (event.result.type === "error") return
          return yield* Effect.die(new Error(`Duplicate tool result: ${event.id}`))
        }
        tool.settled = true
        const result = error ? { error } : settledOutput(event.output, event.result)
        const executed = event.providerExecuted === true || tool.providerExecuted
        const resultState = providerState(event.providerMetadata)
        if ("error" in result) {
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID: input.sessionID,
            assistantMessageID: tool.assistantMessageID,
            callID: event.id,
            error: result.error,
            result: event.result,
            executed,
            resultState,
          })
          return
        }
        yield* events.publish(SessionEvent.Tool.Success, {
          sessionID: input.sessionID,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          ...result,
          ...(executed ? { result: event.result } : {}),
          executed,
          resultState,
        })
        return
      }
      case "tool-error": {
        const tool = tools.get(event.id)
        if (!tool?.called) return yield* Effect.die(new Error(`Tool error before call: ${event.id}`))
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool error name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (tool.settled) return yield* Effect.die(new Error(`Duplicate tool error: ${event.id}`))
        tool.settled = true
        yield* events.publish(SessionEvent.Tool.Failed, {
          sessionID: input.sessionID,
          assistantMessageID: tool.assistantMessageID,
          callID: event.id,
          error:
            event.message === `Unknown tool: ${event.name}`
              ? { type: "tool.unknown", message: event.message }
              : { type: "tool.execution", message: event.message },
          executed: tool.providerExecuted,
          resultState: providerState(event.providerMetadata),
        })
        return
      }
      case "step-finish":
        yield* flush()
        if (stepSettlement) return yield* Effect.die(new Error("Duplicate step finish"))
        stepSettlement = { finish: event.reason, tokens: tokens(event.usage) }
        if (event.reason === "content-filter") {
          providerFailed = true
          yield* failAssistant({ type: "provider.content-filter", message: "Provider blocked the response" }, true)
          return
        }
        return
      case "finish":
        return
      case "provider-error":
        providerFailed = true
        yield* failAssistant({ type: "provider.unknown", message: event.message }, true)
        return
    }
  })

  return {
    publish,
    flush,
    failAssistant,
    publishStepFailure,
    failUnsettledTools,
    hasProviderError: () => providerFailed,
    hasRetryEvidence: () => retryEvidence,
    stepFailure: () => stepFailure,
    stepSettlement: () => stepSettlement,
    startAssistant,
    assistantMessageID: assistantMessageIDForTool,
  }
}
