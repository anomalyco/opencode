import { Effect, Option } from "effect"
import {
  AIError,
  type FinishReasonDetails,
  LLMEvent,
  type ProviderMetadata,
  type ToolCall,
  type ToolInputError,
} from "../../schema/index.js"
import { eventError, parseToolInput, type ToolAccumulator } from "../shared.js"
import { parse } from "./partial-json.js"

type StreamKey = string | number
const parsePartialInput = Option.liftThrowable(parse)

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
    namespace: tool.namespace,
    providerExecuted: tool.providerExecuted ? true : undefined,
    providerMetadata: tool.providerMetadata,
  })

const inputDelta = (tool: PendingTool, text: string): LLMEvent => {
  const raw = tool.input
  let parsed: unknown
  return {
    ...LLMEvent.toolInputDelta({
      id: tool.id,
      name: tool.name,
      namespace: tool.namespace,
      text,
    }),
    get input() {
      return (parsed ??= Option.getOrElse(parsePartialInput(raw), () => ({})))
    },
  }
}

const toolCall = (route: string, tool: PendingTool, inputOverride?: string) => {
  const raw = inputOverride ?? tool.input
  return parseToolInput(route, tool.name, raw).pipe(
    Effect.map(
      (input): ToolCall =>
        LLMEvent.toolCall({
          id: tool.id,
          name: tool.name,
          namespace: tool.namespace,
          input,
          providerExecuted: tool.providerExecuted ? true : undefined,
          providerMetadata: tool.providerMetadata,
        }),
    ),
    Effect.catch((error) =>
      tool.providerExecuted
        ? Effect.fail(error)
        : Effect.succeed(LLMEvent.toolInputError({ id: tool.id, name: tool.name, namespace: tool.namespace, raw })),
    ),
  )
}

const inputEnd = (tool: PendingTool) =>
  LLMEvent.toolInputEnd({
    id: tool.id,
    name: tool.name,
    namespace: tool.namespace,
    providerMetadata: tool.providerMetadata,
  })

const finishEvents = (tool: PendingTool, event: ToolCall | ToolInputError): ReadonlyArray<LLMEvent> => [
  inputEnd(tool),
  event,
]

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

export const isError = <K extends StreamKey>(result: AppendOutcome<K> | AIError): result is AIError =>
  result instanceof AIError

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
  delta: {
    readonly id?: string
    readonly name?: string
    readonly text: string
    readonly providerMetadata?: ProviderMetadata
  },
  missingToolMessage: string,
): AppendOutcome<K> | AIError => {
  const current = tools[key]
  const id = current?.id ?? delta.id
  const name = current?.name ?? delta.name
  if (!id || !name) return eventError(route, missingToolMessage)

  const tool = {
    id,
    name,
    namespace: current?.namespace,
    input: `${current?.input ?? ""}${delta.text}`,
    providerExecuted: current?.providerExecuted,
    providerMetadata: current?.providerMetadata ?? delta.providerMetadata,
  }
  if (current && delta.text.length === 0 && current.id === id && current.name === name)
    return { tools, tool: current, events: [] }
  return appendTool(tools, key, tool, delta.text)
}

/**
 * Append argument text to a started tool. Returns `undefined` when no tool is
 * open under `key`, for protocols that ignore deltas without a matching block.
 */
export const append = <K extends StreamKey>(tools: State<K>, key: K, text: string): AppendOutcome<K> | undefined => {
  const current = tools[key]
  if (!current) return undefined
  if (text.length === 0) return { tools, tool: current, events: [] }
  return appendTool(tools, key, { ...current, input: `${current.input}${text}` }, text)
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
): AppendOutcome<K> | AIError => append(tools, key, text) ?? eventError(route, missingToolMessage)

/**
 * Finalize one pending tool call: parse the accumulated raw JSON, remove it
 * from state, and reject malformed local arguments without repairing them.
 * Missing keys are a no-op because some providers emit stop events for
 * non-tool content blocks.
 *
 * Pass `input` when the provider sends an authoritative final input string.
 * OpenAI Responses can send accumulated deltas and then repeat the completed
 * arguments on `response.output_item.done`; the final value wins.
 */
export const finish = <K extends StreamKey>(route: string, tools: State<K>, key: K, input?: string) =>
  Effect.gen(function* () {
    const tool = tools[key]
    if (!tool) return { tools }
    return {
      tools: withoutTool(tools, key),
      events: finishEvents(tool, yield* toolCall(route, tool, input)),
    }
  })

/**
 * Finalize every pending tool call at once. OpenAI Chat has this shape: it does
 * not emit per-tool stop events, so all accumulated calls finish independently
 * when the choice receives a terminal `finish_reason`.
 */
export const finishAll = <K extends StreamKey>(route: string, tools: State<K>) =>
  Effect.gen(function* () {
    const pending = Object.values<PendingTool | undefined>(tools).filter(
      (tool): tool is PendingTool => tool !== undefined,
    )
    return {
      tools: empty<K>(),
      events: yield* Effect.forEach(pending, (tool) =>
        toolCall(route, tool).pipe(Effect.map((event) => finishEvents(tool, event))),
      ).pipe(Effect.map((events) => events.flat())),
    }
  })

/**
 * One Chat tool call under its stream key. Chat providers may split the call id
 * and name across deltas, so a slot buffers argument text until both arrive and
 * only then opens with `tool-input-start`. Freeform calls stream raw text that
 * the parser re-encodes as JSON arguments.
 */
export type Slot =
  | {
      readonly status: "buffering"
      readonly freeform: boolean
      readonly id?: string
      readonly name?: string
      readonly input: string
      readonly providerMetadata?: ProviderMetadata
    }
  | { readonly status: "open"; readonly freeform: boolean; readonly tool: PendingTool }

/**
 * Chat tool calls stream until the first finish reason, which settles every
 * slot. The settled events wait for the end of the stream so late text and
 * reasoning still precede them.
 */
export type Slots<K extends StreamKey> =
  | { readonly status: "streaming"; readonly slots: ReadonlyMap<K, Slot> }
  | { readonly status: "finished"; readonly reason: FinishReasonDetails; readonly events: ReadonlyArray<LLMEvent> }

export const slotID = (slot: Slot | undefined) => (slot?.status === "open" ? slot.tool.id : slot?.id)

/** Add one delta to a slot, opening it once both id and name are known. */
export const slotDelta = <K extends StreamKey>(
  slots: ReadonlyMap<K, Slot>,
  key: K,
  delta: {
    readonly id?: string
    readonly name?: string
    readonly text: string
    readonly freeform: boolean
    readonly providerMetadata?: ProviderMetadata
  },
) => {
  const slot = slots.get(key)
  if (slot?.status === "open") {
    if (delta.text.length === 0) return { slots, events: [] }
    const tool = {
      ...slot.tool,
      input: `${slot.tool.input}${delta.text}`,
      providerMetadata: slot.tool.providerMetadata ?? delta.providerMetadata,
    }
    return {
      slots: new Map(slots).set(key, { ...slot, freeform: slot.freeform || delta.freeform, tool }),
      events: [inputDelta(tool, delta.text)],
    }
  }
  const id = slot?.id ?? delta.id
  const name = slot?.name ?? delta.name
  const input = `${slot?.input ?? ""}${delta.text}`
  // A call may only reveal that it is freeform after its first delta.
  const freeform = (slot?.freeform ?? false) || delta.freeform
  const providerMetadata = slot?.providerMetadata ?? delta.providerMetadata
  if (!id || !name)
    return {
      slots: new Map(slots).set(key, { status: "buffering", freeform, id, name, input, providerMetadata }),
      events: [],
    }
  const tool = { id, name, input, providerMetadata }
  return {
    slots: new Map(slots).set(key, { status: "open", freeform, tool }),
    events: input.length > 0 ? [inputStart(tool), inputDelta(tool, input)] : [inputStart(tool)],
  }
}

export const hasBufferedSlot = (slots: ReadonlyMap<StreamKey, Slot>) =>
  [...slots.values()].some((slot) => slot.status === "buffering")

/**
 * Settle every open slot. A completed response parses each call, appending
 * `freeformEnd` to freeform input first. Truncation and filtering abandon open
 * calls: their input ends without a call, and the consumer settles them as
 * incomplete. Buffered slots never started, so they produce nothing.
 */
export const finishSlots = <K extends StreamKey>(
  route: string,
  slots: ReadonlyMap<K, Slot>,
  reason: FinishReasonDetails["normalized"] | undefined,
  freeformEnd = "",
) =>
  Effect.gen(function* () {
    const open = [...slots.values()].flatMap((slot) => (slot.status === "open" ? [slot] : []))
    if (reason === "length" || reason === "content-filter") return open.map((slot) => inputEnd(slot.tool))
    const closed = open.map((slot) =>
      slot.freeform && freeformEnd
        ? { tool: { ...slot.tool, input: `${slot.tool.input}${freeformEnd}` }, delta: freeformEnd }
        : { tool: slot.tool, delta: "" },
    )
    const deltas = closed.flatMap((item) => (item.delta ? [inputDelta(item.tool, item.delta)] : []))
    const calls = yield* Effect.forEach(closed, (item) =>
      toolCall(route, item.tool).pipe(Effect.map((event) => finishEvents(item.tool, event))),
    )
    return [...deltas, ...calls.flat()]
  })

export * as ToolStream from "./tool-stream.js"
