import { Option, Schema } from "effect"
import {
  ToolDefinition,
  type Freeform,
  type LLMEvent,
  type LLMRequest,
  type ProviderMetadata,
} from "../schema/index.js"
import { encodeJson, flattenTools, isRecord } from "./shared.js"
import { ToolStream } from "./utils/tool-stream.js"
import { toolsUpdate } from "../tool-updates.js"

// Freeform tools as OpenAI custom tools, shared by Responses and Chat Completions:
// https://platform.openai.com/docs/guides/function-calling#custom-tools
// Calls keep the normal `{ field: raw }` input everywhere else; only the wire carries raw text.
// A `text` tool with `optionsPrefix` and optional fields beside its string carries them on an optional first line,
// `<prefix> <JSON object>`, constrained by a Lark grammar.

export interface Custom {
  /** The tool's one required string parameter, which the raw text fills. */
  readonly field: string
  readonly format: Freeform
  /** The options line's prefix, when the tool has optional fields beside its string. */
  readonly optionsPrefix?: string
  /** The optional fields the options line may set; it drops any others. */
  readonly options?: ReadonlyArray<string>
}

/** How a tool goes out: a custom tool when it declares `freeform` with one required string parameter. */
export const resolve = (tool: ToolDefinition): Custom | undefined => {
  if (tool.freeform === undefined || tool.native !== undefined) return undefined
  const prefix = tool.freeform.type === "text" ? tool.freeform.optionsPrefix : undefined
  const field = ToolDefinition.freeformField(tool.inputSchema, prefix !== undefined)
  if (field === undefined) return undefined
  const options = optionFields(tool, field).map(([name]) => name)
  return prefix !== undefined && options.length > 0
    ? { field, format: tool.freeform, optionsPrefix: prefix, options }
    : { field, format: tool.freeform }
}

/** Custom tools in this request, including ones added mid-conversation, by flattened tool name. */
export const tools = (request: LLMRequest): ReadonlyMap<string, Custom> => {
  const added = request.messages.flatMap((message) => toolsUpdate(message)?.add ?? [])
  return new Map(
    flattenTools([...request.tools, ...added]).flatMap((tool) => {
      const custom = resolve(tool)
      return custom ? [[tool.name, custom] as const] : []
    }),
  )
}

/** The format's grammar, or `undefined` for unconstrained text. */
export const grammar = (custom: Custom) => {
  if (custom.optionsPrefix !== undefined)
    return {
      syntax: "lark" as const,
      definition: [
        "start: pragma_source | plain_source",
        "pragma_source: PRAGMA_LINE NEWLINE SOURCE",
        "plain_source: SOURCE",
        "",
        `PRAGMA_LINE: /[ \\t]*${escapeRegex(custom.optionsPrefix).replaceAll("/", "\\/")}[^\\r\\n]*/`,
        "NEWLINE: /\\r?\\n/",
        "SOURCE: /[\\s\\S]+/",
        "",
      ].join("\n"),
    }
  const format = custom.format
  return format.type === "text"
    ? undefined
    : { syntax: format.type, definition: format.type === "regex" ? format.pattern : format.grammar }
}

/** The tool description, with a line on how to set the optional fields when the tool has an options line. */
export const description = (tool: ToolDefinition, custom: Custom) => {
  if (custom.optionsPrefix === undefined) return tool.description
  const fields = optionFields(tool, custom.field).map(([name, property]) => {
    const type = typeof property.type === "string" ? ` (${property.type})` : ""
    return `\`${name}\`${type}${typeof property.description === "string" ? `: ${property.description}` : ""}`
  })
  return `${tool.description}\nTo set other parameters, start with the line \`${custom.optionsPrefix} <JSON object>\` and put the ${custom.field} on the next line. Parameters: ${fields.join("; ")}`
}

const optionFields = (tool: ToolDefinition, field: string) =>
  Object.entries(isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {}).flatMap(
    ([name, property]) => (name !== field && isRecord(property) ? [[name, property] as const] : []),
  )

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Raw text replayed for a past call: its field, after an options line for any other fields, or the whole input as JSON
 * when the field is not a string.
 */
export const toRaw = (custom: Custom, input: unknown) => {
  const value = isRecord(input) ? input[custom.field] : undefined
  if (!isRecord(input) || typeof value !== "string") return encodeJson(input ?? {})
  const options = Object.entries(input).filter(([name, option]) => name !== custom.field && option !== undefined)
  if (custom.optionsPrefix === undefined || options.length === 0) return value
  return `${custom.optionsPrefix} ${encodeJson(Object.fromEntries(options))}\n${value}`
}

/** JSON arguments for a raw call. A call to an undeclared custom tool fills `input`. */
export const fromRaw = (custom: Custom | undefined, raw: string) => {
  const parsed = split(custom, raw)
  return encodeJson({ ...parsed.options, [field(custom)]: parsed.body })
}

const field = (custom: Custom | undefined) => custom?.field ?? "input"

const decodeArguments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

// The options on a complete first line, and the body after it. Without one, or when the line's JSON is not an object,
// the whole text is the body: the line is then a comment the program ignores. Keys the tool does not declare, such as
// options a model learned for another harness, are dropped so they cannot fail the call's validation.
const split = (custom: Custom | undefined, raw: string) => {
  const line =
    custom?.optionsPrefix === undefined
      ? undefined
      : new RegExp(`^[ \\t]*${escapeRegex(custom.optionsPrefix)}([^\\r\\n]*)\\r?\\n`).exec(raw)
  const options = line ? Option.getOrUndefined(decodeArguments(line[1])) : undefined
  if (!line || !options) return { options: undefined, body: raw }
  return {
    options: Object.fromEntries(Object.entries(options).filter(([name]) => custom?.options?.includes(name))),
    body: raw.slice(line[0].length),
  }
}

/**
 * One open custom call's stream: the raw text held back while its first line may still be an options line, which
 * only a tool with an options line holds.
 */
export interface Stream {
  readonly custom: Custom | undefined
  readonly held?: string
}

// Streamed raw text is re-encoded as JSON-argument fragments, so the tool-input events match a JSON tool's.
/** The opening fragment, `{"field":"` followed by the escaped first text, or `{` while the first line is held. */
export const streamStart = (custom: Custom | undefined, raw = "") => {
  if (custom?.optionsPrefix === undefined)
    return { fragment: `{${opening(custom, undefined)}${escape(raw)}`, stream: { custom } satisfies Stream }
  const next = streamDelta({ custom, held: "" }, raw)
  return { fragment: `{${next.fragment}`, stream: next.stream }
}

/** The fragment for more raw text, which stays held until the first line is complete or cannot be an options line. */
export const streamDelta = (stream: Stream, raw: string): { readonly fragment: string; readonly stream: Stream } => {
  if (stream.held === undefined) return { fragment: escape(raw), stream }
  const text = `${stream.held}${raw}`
  const prefix = stream.custom?.optionsPrefix ?? ""
  const start = text.replace(/^[ \t]*/, "")
  if (!text.includes("\n") && (start.startsWith(prefix) || prefix.startsWith(start)))
    return { fragment: "", stream: { custom: stream.custom, held: text } }
  const parsed = split(stream.custom, text)
  return {
    fragment: `${opening(stream.custom, parsed.options)}${escape(parsed.body)}`,
    stream: { custom: stream.custom },
  }
}

const opening = (custom: Custom | undefined, options: Record<string, unknown> | undefined) =>
  `${options && Object.keys(options).length > 0 ? `${encodeJson(options).slice(1, -1)},` : ""}${encodeJson(field(custom))}:"`
const escape = (raw: string) => encodeJson(raw).slice(1, -1)
const STREAM_END = '"}'

/**
 * Close the JSON fragment of each open custom call, with any text still held as its body. With a `final` raw input, a
 * call only closes when its fragments decode to it, so an authoritative final input that disagrees replaces the
 * streamed one instead.
 */
export const close = <K extends string | number>(
  tools: ToolStream.State<K>,
  calls: Iterable<readonly [K, Stream | undefined]>,
  final?: { readonly custom: Custom | undefined; readonly raw: string },
) =>
  [...calls].reduce<{ readonly tools: ToolStream.State<K>; readonly events: ReadonlyArray<LLMEvent> }>(
    (result, [key, stream]) => {
      const pending = result.tools[key]
      const end = `${stream?.held === undefined ? "" : `${opening(stream.custom, undefined)}${escape(stream.held)}`}${STREAM_END}`
      const streamed = pending && Option.getOrUndefined(decodeArguments(`${pending.input}${end}`))
      if (!pending || (final !== undefined && encodeJson(streamed) !== fromRaw(final.custom, final.raw))) return result
      const appended = ToolStream.append(result.tools, key, end)
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
