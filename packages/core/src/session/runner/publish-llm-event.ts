import { type LLMEvent, type ProviderMetadata, type ToolResultValue } from "@opencode-ai/ai"
import { Clock, Effect, Iterable } from "effect"
import { isArrayNonEmpty, isReadonlyArrayNonEmpty } from "effect/Array"
import { Bus } from "../../bus.js"
import { Model } from "../../model.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Money } from "@opencode-ai/schema/money"
import { Agent } from "../../agent.js"
import { Snapshot } from "../../snapshot.js"
import { RelativePath } from "../../schema.js"
import { SessionUsage } from "../usage.js"
import { Tool } from "@opencode-ai/schema/tool"

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly providerMetadataKey: string
  readonly snapshot?: Snapshot.ID
  readonly assistantMessageID: SessionMessage.ID
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value }

/** Immutable fold of the durable facts a step's writer has recorded so far. */
export interface StepRecord {
  /** The model produced visible output this attempt, which bars transparent retries and overflow recovery. */
  readonly outputStarted: boolean
  readonly providerFailed: boolean
  /** The step's recorded assistant failure, if any. */
  readonly failure?: SessionError.Error
  /** Present once the provider finished the step normally. */
  readonly finish?: {
    readonly finish: Extract<LLMEvent, { type: "step-finish" }>["reason"]["normalized"]
    readonly rawFinish?: string
    readonly providerState?: SessionMessage.ProviderState
    readonly tokens: ReturnType<typeof SessionUsage.tokens>
  }
  readonly needsContinuation: boolean
}

/** Derives canonical model content from a provider-hosted tool result. */
type NonEmptyContent = readonly [Tool.Content, ...Tool.Content[]]

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const hostedContent = (result: ToolResultValue): NonEmptyContent => {
  if (result.type === "content" && isReadonlyArrayNonEmpty(result.value)) return result.value
  return [{ type: "text", text: stringify(result.value) }]
}

/**
 * Persist one step without executing tools or starting a continuation step.
 *
 * Concurrency invariant: the provider loop and each owned tool fiber call these methods
 * concurrently without a lock. Two rules keep that safe, and every method must preserve
 * them. (1) Commit state marks synchronously before the first await: never a yield
 * between a check (`tool.settled`, `stepStarted`, ...) and its mark, so check-and-mark
 * stays atomic under cooperative scheduling. (2) Never require a cross-source event
 * order: each publishing fiber is sequential, so per-source order holds by construction,
 * and consumers fold by id/ordinal rather than global position.
 */
export const createLLMEventPublisher = (bus: Pick<Bus.Interface, "publish">, input: Input) => {
  const deltaBatchInterval = 100
  type ToolState = {
    readonly name: string
    called: boolean
    settled: boolean
    providerExecuted: boolean
    progress?: Tool.Metadata
  }
  const tools = new Map<string, ToolState>()
  const failureSnapshot = (tool: { readonly progress?: Tool.Metadata }, metadata?: Tool.Metadata) => {
    if (tool.progress === undefined) return metadata === undefined ? {} : { metadata }
    if (metadata === undefined) return { metadata: tool.progress }
    return { metadata: { ...tool.progress, ...metadata } }
  }
  const assistantMessageID = input.assistantMessageID
  let stepStarted = false
  let stepFailed = false
  let providerFailed = false
  let outputStarted = false
  let stepStreamed = false
  let stepFailure: SessionError.Error | undefined
  let stepSettlement: StepRecord["finish"]

  const startAssistant = Effect.fnUntraced(function* () {
    if (stepStarted) return assistantMessageID
    stepStarted = true
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      assistantMessageID,
      snapshot: input.snapshot,
    })
    return assistantMessageID
  })
  const currentAssistantMessageID = () =>
    stepStarted ? Effect.succeed(assistantMessageID) : Effect.die(new Error("Tool event before assistant step start"))
  const streamed = Effect.fnUntraced(function* () {
    if (stepStreamed) return
    stepStreamed = true
    yield* bus.publish(SessionEvent.Step.Streamed, {
      sessionID: input.sessionID,
      assistantMessageID: yield* startAssistant(),
    })
  })
  const providerState = (metadata: ProviderMetadata | undefined) => metadata?.[input.providerMetadataKey]
  const fragments = (
    name: string,
    ended: (id: string, value: string, ordinal: number, state?: Record<string, unknown>) => Effect.Effect<void>,
    delta?: (id: string, value: string, ordinal: number) => Effect.Effect<void>,
    single = false,
  ) => {
    type Fragment = {
      readonly ordinal: number
      readonly values: string[]
      pending: string
      publishedAt?: number
      state?: Record<string, unknown>
    }
    const chunks = new Map<string, Fragment>()
    let nextOrdinal = 0
    const start = (id: string, state?: Record<string, unknown>) =>
      Effect.suspend(() => {
        if (chunks.has(id)) return Effect.die(new Error(`Duplicate ${name} start: ${id}`))
        if (single && chunks.size > 0) return Effect.die(new Error(`${name} start before end: ${id}`))
        const ordinal = nextOrdinal++
        chunks.set(id, { ordinal, values: [], pending: "", state })
        return Effect.succeed(ordinal)
      })
    const publishDelta = Effect.fnUntraced(function* (id: string, force = false) {
      if (!delta) return undefined
      const current = chunks.get(id)
      if (!current) return yield* Effect.die(new Error(`${name} delta before start: ${id}`))
      if (!current.pending) return undefined
      const now = yield* Clock.currentTimeMillis
      if (!force && current.publishedAt === undefined) {
        current.publishedAt = now
        return undefined
      }
      if (!force && current.publishedAt !== undefined && now - current.publishedAt < deltaBatchInterval)
        return undefined
      yield* delta(id, current.pending, current.ordinal)
      current.pending = ""
      current.publishedAt = now
      return undefined
    })
    const append = Effect.fnUntraced(function* (id: string, value: string, state?: Record<string, unknown>) {
      const current = chunks.get(id)
      if (!current) return yield* Effect.die(new Error(`${name} delta before start: ${id}`))
      current.values.push(value)
      if (delta) current.pending += value
      if (state !== undefined) current.state = { ...current.state, ...state }
      yield* publishDelta(id)
      return current.ordinal
    })
    const end = Effect.fnUntraced(function* (id: string, state?: Record<string, unknown>, value?: string) {
      const current = chunks.get(id)
      if (!current) return yield* Effect.die(new Error(`${name} end before start: ${id}`))
      yield* publishDelta(id, true)
      yield* ended(
        id,
        value ?? current.values.join(""),
        current.ordinal,
        state === undefined ? current.state : { ...current.state, ...state },
      )
      chunks.delete(id)
      return undefined
    })
    const flush = Effect.fnUntraced(function* () {
      for (const id of Array.from(chunks.keys())) yield* end(id)
    })
    return { start, append, end, flush, has: (id: string) => chunks.has(id) }
  }

  const text = fragments(
    "text",
    (_textID, value, ordinal, state) =>
      Effect.gen(function* () {
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          text: value,
          state,
        })
      }),
    (_textID, value, ordinal) =>
      Effect.gen(function* () {
        yield* bus.publish(SessionEvent.Text.Delta, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          delta: value,
        })
      }),
    true,
  )
  const reasoning = fragments(
    "reasoning",
    (_reasoningID, value, ordinal, state) =>
      Effect.gen(function* () {
        yield* bus.publish(SessionEvent.Reasoning.Ended, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          text: value,
          state,
        })
      }),
    (_reasoningID, value, ordinal) =>
      Effect.gen(function* () {
        yield* bus.publish(SessionEvent.Reasoning.Delta, {
          sessionID: input.sessionID,
          assistantMessageID: yield* currentAssistantMessageID(),
          ordinal,
          delta: value,
        })
      }),
    true,
  )
  const toolInput = fragments("tool input", (id, value) =>
    Effect.gen(function* () {
      const tool = tools.get(id)
      if (!tool) return yield* Effect.die(new Error(`Tool input end before start: ${id}`))
      yield* bus.publish(SessionEvent.Tool.Input.Ended, {
        sessionID: input.sessionID,
        assistantMessageID,
        id,
        text: value,
      })
    }),
  )

  const flushFragments = Effect.fnUntraced(function* () {
    yield* text.flush()
    yield* reasoning.flush()
    yield* toolInput.flush()
  })

  const startToolInput = Effect.fnUntraced(function* (event: {
    readonly id: string
    readonly name: string
    readonly providerExecuted?: boolean
  }) {
    if (tools.has(event.id)) return yield* Effect.die(new Error(`Duplicate tool input start: ${event.id}`))
    yield* startAssistant()
    const tool: ToolState = {
      name: event.name,
      called: false,
      settled: false,
      providerExecuted: event.providerExecuted === true,
    }
    tools.set(event.id, tool)
    yield* toolInput.start(event.id)
    yield* bus.publish(SessionEvent.Tool.Input.Started, {
      sessionID: input.sessionID,
      assistantMessageID,
      id: event.id,
      name: event.name,
    })
    return tool
  })

  const endToolInput = Effect.fnUntraced(function* (
    event: { readonly id: string; readonly name: string },
    value?: string,
  ) {
    const tool = tools.get(event.id)
    if (!tool) return yield* Effect.die(new Error(`Tool input end before start: ${event.id}`))
    if (tool.name !== event.name)
      return yield* Effect.die(new Error(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`))
    if (!toolInput.has(event.id)) return yield* Effect.die(new Error(`Duplicate tool input end: ${event.id}`))
    yield* toolInput.end(event.id, undefined, value)
  })

  const failMalformedToolInput = Effect.fnUntraced(function* (event: {
    readonly id: string
    readonly name: string
    readonly raw: string
  }) {
    const tool = tools.get(event.id) ?? (yield* startToolInput(event))
    if (tool.called || tool.settled)
      return yield* Effect.die(new Error(`Malformed tool input after call settlement: ${event.id}`))
    if (tool.name !== event.name)
      return yield* Effect.die(new Error(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`))
    if (toolInput.has(event.id)) yield* endToolInput(event, event.raw)
    tool.settled = true
    yield* bus.publish(SessionEvent.Tool.Failed, {
      sessionID: input.sessionID,
      assistantMessageID,
      id: event.id,
      error: {
        type: "tool.input-json",
        message: "Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.",
      },
      ...failureSnapshot(tool),
      executed: false,
    })
  })

  const flush = Effect.fn("SessionRunner.flush")(flushFragments)

  const failTool = Effect.fnUntraced(function* (id: string, error: SessionError.Error, metadata?: Tool.Metadata) {
    const tool = tools.get(id)
    if (!tool || tool.settled) return false
    tool.settled = true
    yield* bus.publish(SessionEvent.Tool.Failed, {
      sessionID: input.sessionID,
      assistantMessageID,
      id,
      error:
        tool.name === "subagent" && error.type === "aborted" && typeof tool.progress?.sessionID === "string"
          ? { ...error, message: `${error.message} (sessionID: ${tool.progress.sessionID})` }
          : error,
      ...failureSnapshot(tool, metadata),
      executed: tool.providerExecuted,
    })
    return true
  })

  const failTools = Effect.fnUntraced(function* (error: SessionError.Error, mode: "all" | "hosted" | "uncalled") {
    let failed = false
    for (const [id, tool] of tools) {
      if (tool.settled || (mode === "hosted" && !tool.providerExecuted) || (mode === "uncalled" && tool.called))
        continue
      failed = (yield* failTool(id, error)) || failed
    }
    return failed
  })

  const failAssistant = Effect.fnUntraced(function* (error: SessionError.Error) {
    yield* flush()
    yield* failTools(error, "uncalled")
    yield* startAssistant()
    if (stepFailure === undefined) stepFailure = error
  })

  const publishStepFailure = Effect.fnUntraced(function* (details?: {
    readonly cost?: Money.USD
    readonly tokens?: ReturnType<typeof SessionUsage.tokens>
    readonly snapshot?: Snapshot.ID
    readonly files?: readonly RelativePath[]
  }) {
    if (stepFailed || stepFailure === undefined) return
    const assistantMessageID = yield* startAssistant()
    stepFailed = true
    yield* bus.publish(SessionEvent.Step.Failed, {
      sessionID: input.sessionID,
      assistantMessageID,
      error: stepFailure,
      finish: stepSettlement?.finish === "content-filter" ? stepSettlement.finish : undefined,
      rawFinish: stepSettlement?.rawFinish,
      providerState: stepSettlement?.providerState,
      ...details,
    })
  })

  const failUnsettledTools = Effect.fn("SessionRunner.failUnsettledTools")(
    (error: SessionError.Error, scope: "hosted" | "all" = "all") => failTools(error, scope),
  )

  const publish = Effect.fnUntraced(function* (event: LLMEvent) {
    switch (event.type) {
      case "step-start":
        yield* startAssistant()
        return
      case "text-start":
        outputStarted = true
        const startedTextOrdinal = yield* text.start(event.id, providerState(event.providerMetadata))
        yield* bus.publish(SessionEvent.Text.Started, {
          sessionID: input.sessionID,
          assistantMessageID: yield* startAssistant(),
          ordinal: startedTextOrdinal,
        })
        return
      case "text-delta":
        yield* text.append(event.id, event.text, providerState(event.providerMetadata))
        return
      case "text-end":
        yield* text.end(event.id, providerState(event.providerMetadata), event.text)
        return
      case "reasoning-start":
        outputStarted = true
        const startedReasoningOrdinal = yield* reasoning.start(event.id, providerState(event.providerMetadata))
        yield* bus.publish(SessionEvent.Reasoning.Started, {
          sessionID: input.sessionID,
          assistantMessageID: yield* startAssistant(),
          ordinal: startedReasoningOrdinal,
          state: providerState(event.providerMetadata),
        })
        return
      case "reasoning-delta":
        yield* reasoning.append(event.id, event.text, providerState(event.providerMetadata))
        return
      case "reasoning-end":
        yield* reasoning.end(event.id, providerState(event.providerMetadata), event.text)
        return
      case "tool-input-start":
        outputStarted = true
        yield* startToolInput(event)
        return
      case "tool-input-delta": {
        const tool = tools.get(event.id)
        if (!tool) return yield* Effect.die(new Error(`Tool input delta before start: ${event.id}`))
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (!toolInput.has(event.id)) return yield* Effect.die(new Error(`Tool input delta after end: ${event.id}`))
        yield* toolInput.append(event.id, event.text)
        return
      }
      case "tool-input-end":
        yield* endToolInput(event)
        return
      case "tool-input-error":
        outputStarted = true
        yield* failMalformedToolInput(event)
        return
      case "tool-call": {
        outputStarted = true
        const tool = tools.get(event.id) ?? (yield* startToolInput(event))
        if (toolInput.has(event.id)) yield* endToolInput(event)
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool call name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (tool.called) return yield* Effect.die(new Error(`Duplicate tool call: ${event.id}`))
        tool.called = true
        tool.providerExecuted = event.providerExecuted === true
        yield* bus.publish(SessionEvent.Tool.Called, {
          sessionID: input.sessionID,
          assistantMessageID,
          id: event.id,
          input: asRecord(event.input),
          executed: tool.providerExecuted,
          state: providerState(event.providerMetadata),
        })
        return
      }
      case "tool-result": {
        // Provider-hosted results only; local executions publish through `toolExecution`.
        const tool = tools.get(event.id)
        if (!tool?.called) return yield* Effect.die(new Error(`Tool result before call: ${event.id}`))
        if (tool.name !== event.name)
          return yield* Effect.die(new Error(`Tool result name changed for ${event.id}: ${tool.name} -> ${event.name}`))
        if (tool.settled) {
          // A late error result is a benign straggler (e.g. after an abort
          // sweep); a late success would mean double execution, so it dies.
          if (event.result.type === "error") return
          return yield* Effect.die(new Error(`Duplicate tool result: ${event.id}`))
        }
        tool.settled = true
        const executed = event.providerExecuted === true || tool.providerExecuted
        const resultState = providerState(event.providerMetadata)
        if (event.result.type === "error") {
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID: input.sessionID,
            assistantMessageID,
            id: event.id,
            error: { type: "tool.execution", message: stringify(event.result.value) },
            ...failureSnapshot(tool),
            executed,
            resultState,
          })
          return
        }
        yield* bus.publish(SessionEvent.Tool.Success, {
          sessionID: input.sessionID,
          assistantMessageID,
          id: event.id,
          content: hostedContent(event.result),
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
        yield* bus.publish(SessionEvent.Tool.Failed, {
          sessionID: input.sessionID,
          assistantMessageID,
          id: event.id,
          error:
            event.message === `Unknown tool: ${event.name}`
              ? { type: "tool.unknown", message: event.message }
              : { type: "tool.execution", message: event.message },
          ...failureSnapshot(tool),
          executed: tool.providerExecuted,
          resultState: providerState(event.providerMetadata),
        })
        return
      }
      case "step-finish":
        yield* flush()
        if (stepSettlement) return yield* Effect.die(new Error("Duplicate step finish"))
        stepSettlement = {
          finish: event.reason.normalized,
          rawFinish: event.reason.raw,
          providerState: providerState(event.providerMetadata),
          tokens: SessionUsage.tokens(event.usage),
        }
        if (event.reason.normalized === "content-filter") {
          providerFailed = true
          yield* failAssistant({ type: "provider.content-filter", message: "Provider blocked the response" })
          return
        }
        return
      case "finish":
        return
      case "provider-error":
        providerFailed = true
        yield* failAssistant({ type: "provider.unknown", message: event.message })
        return
    }
  })

  const publishTraced = Effect.fn("SessionRunner.publishLLMEvent")(publish)

  const progress = Effect.fnUntraced(function* (id: string, update: Tool.Metadata) {
    const tool = tools.get(id)
    if (!tool?.called || tool.settled) return yield* Effect.die(new Error(`Tool progress outside running call: ${id}`))
    tool.progress = update
    yield* bus.publish(SessionEvent.Tool.Progress, {
      sessionID: input.sessionID,
      assistantMessageID,
      id,
      metadata: update,
    })
  })

  /** Publishes one canonical terminal event for a locally executed tool call. */
  const toolExecution = Effect.fnUntraced(function* (id: string, name: string, result: Tool.Result) {
    const tool = tools.get(id)
    if (!tool?.called) return yield* Effect.die(new Error(`Tool execution before call: ${id}`))
    if (tool.name !== name)
      return yield* Effect.die(new Error(`Tool execution name changed for ${id}: ${tool.name} -> ${name}`))
    if (tool.settled) return yield* Effect.die(new Error(`Duplicate tool execution: ${id}`))
    tool.settled = true
    const content =
      typeof result.content === "string"
        ? [{ type: "text" as const, text: result.content }]
        : result.content === undefined
          ? []
          : [...result.content]
    if (!isArrayNonEmpty(content)) return yield* Effect.die(new Error(`Tool execution has no content: ${id}`))
    yield* bus.publish(SessionEvent.Tool.Success, {
      sessionID: input.sessionID,
      assistantMessageID,
      id,
      content,
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      executed: tool.providerExecuted,
    })
  })

  return {
    publish: (event: LLMEvent) => {
      if (event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "tool-input-delta")
        return publish(event)
      return publishTraced(event)
    },
    progress,
    toolExecution,
    flush,
    failAssistant,
    failTool,
    publishStepFailure,
    failUnsettledTools,
    hasProviderError: () => providerFailed,
    hasStarted: () => stepStarted,
    /** Immutable snapshot of everything recorded for this step so far. */
    record: (): StepRecord => ({
      outputStarted,
      providerFailed,
      failure: stepFailure,
      finish: stepSettlement,
      needsContinuation: Iterable.some(
        tools.values(),
        (tool) => !tool.providerExecuted && (tool.called || tool.settled),
      ),
    }),
    startAssistant,
    streamed,
  }
}
