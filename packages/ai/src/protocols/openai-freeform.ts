import { Option, Schema } from "effect"
import {
  ToolDefinition,
  type Freeform,
  type LLMEvent,
  type LLMRequest,
  type ProviderMetadata,
  type ToolEntry,
} from "../schema/index.js"
import { encodeJson, flattenTools, isRecord } from "./shared.js"
import { ToolStream } from "./utils/tool-stream.js"
import { toolsUpdate } from "../tool-updates.js"

// Freeform tools as OpenAI custom tools, shared by Responses and Chat Completions:
// https://platform.openai.com/docs/guides/function-calling#custom-tools
// Calls keep the normal `{ field: raw }` input everywhere else; only the wire carries raw text.

export interface Custom {
  /** The tool's one required string parameter, which the raw text fills. */
  readonly field: string
  readonly format: Freeform
}

/** How a tool goes out: a custom tool when it declares `freeform` with one required string parameter. */
export const resolve = (tool: ToolDefinition): Custom | undefined => {
  const field = ToolDefinition.freeformField(tool.inputSchema)
  if (tool.freeform === undefined || tool.native !== undefined || field === undefined) return undefined
  return { field, format: tool.freeform }
}

/** Custom tools in this request as they stand after every mid-conversation change, by flattened tool name. */
export const tools = (request: LLMRequest): ReadonlyMap<string, Custom> =>
  request.messages.reduce(
    (custom, message) => declare(custom, toolsUpdate(message)?.add ?? []),
    declare(new Map(), request.tools),
  )

/**
 * The custom tools after `tools` are declared: a custom definition is recorded, and a name redefined as a JSON tool
 * is dropped. A removed tool keeps its last format, so a call to it already in the history replays the same way.
 */
export const declare = (
  custom: ReadonlyMap<string, Custom>,
  tools: ReadonlyArray<ToolEntry>,
): ReadonlyMap<string, Custom> =>
  flattenTools(tools).reduce((next, tool) => {
    const resolved = resolve(tool)
    if (resolved) return new Map(next).set(tool.name, resolved)
    if (!next.has(tool.name)) return next
    const without = new Map(next)
    without.delete(tool.name)
    return without
  }, custom)

/** The format's grammar, or `undefined` for unconstrained text. */
export const grammar = (format: Freeform) =>
  format.type === "text"
    ? undefined
    : { syntax: format.type, definition: format.type === "regex" ? format.pattern : format.grammar }

/** Raw text replayed for a past call: its field, or the whole input as JSON when the field is not a string. */
export const toRaw = (custom: Custom, input: unknown) => {
  const value = isRecord(input) ? input[custom.field] : undefined
  return typeof value === "string" ? value : encodeJson(input ?? {})
}

/** JSON arguments for a raw call. A call to an undeclared custom tool fills `input`. */
export const fromRaw = (custom: Custom | undefined, raw: string) => encodeJson({ [field(custom)]: raw })

const field = (custom: Custom | undefined) => custom?.field ?? "input"

// Streamed raw text is re-encoded as JSON-argument fragments, so the tool-input events match a JSON tool's.
/** The opening fragment, `{"field":"`, followed by the escaped first text. */
export const streamStart = (custom: Custom | undefined, raw = "") =>
  `{${encodeJson(field(custom))}:"${streamDelta(raw)}`
export const streamDelta = (raw: string) => encodeJson(raw).slice(1, -1)
const STREAM_END = '"}'

const decodeArguments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

/**
 * Close the JSON fragment of each open custom call. With a `final` raw input, a call only closes when its fragments
 * decode to it, so an authoritative final input that disagrees replaces the streamed one instead.
 */
export const close = <K extends string | number>(
  tools: ToolStream.State<K>,
  keys: Iterable<K>,
  final?: { readonly custom: Custom | undefined; readonly raw: string },
) =>
  [...keys].reduce<{ readonly tools: ToolStream.State<K>; readonly events: ReadonlyArray<LLMEvent> }>(
    (result, key) => {
      const pending = result.tools[key]
      const streamed = pending && Option.getOrUndefined(decodeArguments(`${pending.input}${STREAM_END}`))
      if (!pending || (final !== undefined && streamed?.[field(final.custom)] !== final.raw)) return result
      const appended = ToolStream.append(result.tools, key, STREAM_END)
      return appended ? { tools: appended.tools, events: [...result.events, ...appended.events] } : result
    },
    { tools, events: [] },
  )

/** Provider metadata marking a call that arrived as a custom tool call. */
export const metadata = (itemId: string, custom: boolean) => (custom ? { itemId, custom: true } : { itemId })

/**
 * Whether a replayed call keeps its item id: only when it goes out as the type it arrived as, since OpenAI item ids
 * name their type (`fc_`, `ctc_`). The `call_id` always survives.
 */
export const keepsItemID = (providerMetadata: ProviderMetadata | undefined, key: string, custom: boolean) =>
  (providerMetadata?.[key]?.custom === true) === custom

export * as OpenAIFreeform from "./openai-freeform.js"
