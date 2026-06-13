import { Effect } from "effect"
import { LLMError, LLMEvent, type ProviderMetadata, type ToolCall } from "../../schema"
import { eventError, parseToolInput, type ToolAccumulator } from "../shared"

type StreamKey = string | number

/**
 * One pending streamed tool call. Providers emit the tool identity and JSON
 * argument text across separate chunks; `input` is the raw JSON string collected
 * so far, not the parsed object.
 */
export interface PendingTool extends ToolAccumulator {
  readonly providerExecuted?: boolean
  readonly providerMetadata?: ProviderMetadata
}

/**
 * Sparse parser state keyed by the provider's stream-local tool identifier.
 *
 * This key is not the final tool-call id (`call_...`). It is the id/index the
 * provider uses while streaming a partial call: OpenAI Chat / Anthropic /
 * Bedrock use numeric content indexes, while OpenAI Responses uses string
 * `item_id`s. The generic keeps each protocol internally consistent.
 */
export type State<K extends StreamKey> = Partial<Record<K, PendingTool>>

/**
 * Result of adding argument text to one pending tool call. It returns both the
 * next `tools` state and the updated `tool` because parsers often need the
 * current id/name immediately. `events` contains lifecycle and delta events
 * produced by the append; metadata-only deltas update identity without output.
 */
export interface AppendOutcome<K extends StreamKey> {
  readonly tools: State<K>
  readonly tool: PendingTool
  readonly events: ReadonlyArray<LLMEvent>
}

/** Create empty accumulator state for one provider stream. */
export const empty = <K extends StreamKey>(): State<K> => ({})

const withTool = <K extends StreamKey>(tools: State<K>, key: K, tool: PendingTool): State<K> => {
  return { ...tools, [key]: tool }
}

const withoutTool = <K extends StreamKey>(tools: State<K>, key: K): State<K> => {
  const next = { ...tools }
  delete next[key]
  return next
}

const inputStart = (tool: PendingTool) =>
  LLMEvent.toolInputStart({
    id: tool.id,
    name: tool.name,
    providerMetadata: tool.providerMetadata,
  })

const inputDelta = (tool: PendingTool, text: string) =>
  LLMEvent.toolInputDelta({
    id: tool.id,
    name: tool.name,
    text,
  })

const toolCall = (route: string, tool: PendingTool, inputOverride?: string) =>
  parseToolInput(route, tool.name, inputOverride ?? tool.input).pipe(
    Effect.map(
      (input): ToolCall =>
        LLMEvent.toolCall({
          id: tool.id,
          name: tool.name,
          input,
          providerExecuted: tool.providerExecuted ? true : undefined,
          providerMetadata: tool.providerMetadata,
        }),
    ),
  )

/** Store the updated tool and produce the optional public delta event. */
const appendTool = <K extends StreamKey>(
  tools: State<K>,
  key: K,
  tool: PendingTool,
  text: string,
): AppendOutcome<K> => {
  const events: LLMEvent[] = []
  if (!tools[key]) events.push(inputStart(tool))
  if (text.length > 0) events.push(inputDelta(tool, text))
  return {
    tools: withTool(tools, key, tool),
    tool,
    events,
  }
}

export const isError = <K extends StreamKey>(result: AppendOutcome<K> | LLMError): result is LLMError =>
  result instanceof LLMError

/**
 * Register a tool call whose start event arrived before any argument deltas.
 * Used by Anthropic `content_block_start`, Bedrock `contentBlockStart`, and
 * OpenAI Responses `response.output_item.added`.
 */
export const start = <K extends StreamKey>(
  tools: State<K>,
  key: K,
  tool: Omit<PendingTool, "input"> & { readonly input?: string },
) => withTool(tools, key, { ...tool, input: tool.input ?? "" })

/**
 * Append a streamed argument delta, starting the tool if this provider encodes
 * identity on the first delta instead of a separate start event. OpenAI Chat has
 * this shape: `tool_calls[].index` is the stream key, and `id` / `name` may only
 * appear on the first delta for that index.
 */
export const appendOrStart = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  delta: { readonly id?: string; readonly name?: string; readonly text: string },
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => {
  const current = tools[key]
  const id = delta.id ?? current?.id
  const name = delta.name ?? current?.name
  if (!id || !name) return eventError(route, missingToolMessage)

  const tool = {
    id,
    name,
    input: `${current?.input ?? ""}${delta.text}`,
    providerExecuted: current?.providerExecuted,
    providerMetadata: current?.providerMetadata,
  }
  if (current && delta.text.length === 0 && current.id === id && current.name === name)
    return { tools, tool: current, events: [] }
  return appendTool(tools, key, tool, delta.text)
}

/**
 * Append argument text to a tool that must already have been started. This keeps
 * protocols honest when their stream grammar promises a start event before any
 * argument delta.
 */
export const appendExisting = <K extends StreamKey>(
  route: string,
  tools: State<K>,
  key: K,
  text: string,
  missingToolMessage: string,
): AppendOutcome<K> | LLMError => {
  const current = tools[key]
  if (!current) return eventError(route, missingToolMessage)
  if (text.length === 0) return { tools, tool: current, events: [] }
  return appendTool(tools, key, { ...current, input: `${current.input}${text}` }, text)
}

/**
 * Finalize one pending tool call: parse the accumulated raw JSON, remove it
 * from state, and return the optional public `tool-call` event. Missing keys are
 * a no-op because some providers emit stop events for non-tool content blocks.
 */
export const finish = <K extends StreamKey>(route: string, tools: State<K>, key: K) =>
  Effect.gen(function* () {
    const tool = tools[key]
    if (!tool) return { tools }
    return {
      tools: withoutTool(tools, key),
      events: [
        LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
        yield* toolCall(route, tool),
      ],
    }
  })

/**
 * Finalize one pending tool call with an authoritative final input string.
 * OpenAI Responses can send accumulated deltas and then repeat the completed
 * arguments on `response.output_item.done`; the final value wins.
 */
export const finishWithInput = <K extends StreamKey>(route: string, tools: State<K>, key: K, input: string) =>
  Effect.gen(function* () {
    const tool = tools[key]
    if (!tool) return { tools }
    return {
      tools: withoutTool(tools, key),
      events: [
        LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
        yield* toolCall(route, tool, input),
      ],
    }
  })

/**
 * Finalize every pending tool call at once. OpenAI Chat has this shape: it does
 * not emit per-tool stop events, so all accumulated calls finish when the choice
 * receives a terminal `finish_reason`.
 */
export const finishAll = <K extends StreamKey>(route: string, tools: State<K>) =>
  Effect.gen(function* () {
    const pending = Object.values<PendingTool | undefined>(tools).filter(
      (tool): tool is PendingTool => tool !== undefined,
    )
    return {
      tools: empty<K>(),
      events: yield* Effect.forEach(pending, (tool) =>
        toolCall(route, tool).pipe(
          Effect.map((call) => [
            LLMEvent.toolInputEnd({ id: tool.id, name: tool.name, providerMetadata: tool.providerMetadata }),
            call,
          ]),
        ),
      ).pipe(Effect.map((events) => events.flat())),
    }
  })

export * as ToolStream from "./tool-stream"
