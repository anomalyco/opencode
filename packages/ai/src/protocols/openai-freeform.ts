import { Option, Schema } from "effect"
import {
  JsonSchema,
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

export interface Custom {
  /** The tool's required string parameter, which the raw text fills. */
  readonly field: string
  readonly format: Freeform
  /** With an options line: the prefix it starts with, the optional parameters it may set, and the full grammar. */
  readonly options?: {
    readonly prefix: string
    readonly description: string
    readonly fields: ReadonlyArray<string>
    readonly grammar: string
  }
}

/**
 * How a tool goes out: a custom tool when it declares `freeform` with one required string parameter. An options line
 * needs a grammar for every optional parameter's value; without one the tool stays a JSON tool.
 */
export const resolve = (tool: ToolDefinition): Custom | undefined => {
  const field = ToolDefinition.freeformField(tool.inputSchema, tool.freeform)
  if (tool.freeform === undefined || tool.native !== undefined || field === undefined) return undefined
  if (!("options" in tool.freeform)) return { field, format: tool.freeform }
  const properties = Object.entries(
    Schema.is(JsonSchema)(tool.inputSchema.properties) ? tool.inputSchema.properties : {},
  )
  const values = properties.flatMap(([name, schema]) =>
    name === field ? [] : [{ name, value: Schema.is(JsonSchema)(schema) ? valueRule(schema) : undefined }],
  )
  if (values.length === 0 || values.some((item) => item.value === undefined)) return undefined
  const prefix = tool.freeform.options.prefix
  return {
    field,
    format: tool.freeform,
    options: {
      prefix,
      description: tool.freeform.options.description,
      fields: values.map((item) => item.name),
      grammar: optionsGrammar(prefix, values as ReadonlyArray<{ name: string; value: string }>, tool.freeform.grammar),
    },
  }
}

// The options line is canonical JSON: keys in schema order, no spaces, so a replayed call reproduces the model's text.
// Without a body grammar the raw text can't start with the prefix otherwise, so a call either writes a valid line or
// none.
const optionsGrammar = (
  prefix: string,
  values: ReadonlyArray<{ readonly name: string; readonly value: string }>,
  body: string | undefined,
) =>
  [
    `start: options_line body | ${body === undefined ? "plain" : "body"}`,
    `options_line: ${larkString(`${prefix} {`)} (${values.map((_, index) => `option_${index}`).join(" | ")}) "}\\n"`,
    ...values.map(
      (_, index) =>
        `option_${index}: pair_${index}${values
          .slice(index + 1)
          .map((_, offset) => ` ("," pair_${index + offset + 1})?`)
          .join("")}`,
    ),
    ...values.map((item, index) => `pair_${index}: ${larkString(`${encodeJson(item.name)}:`)} ${item.value}`),
    ...(body === undefined ? ["body: /[\\s\\S]+/", `plain: /${notStartingWith(prefix)}/`] : [body]),
  ].join("\n")

// Only forms `JSON.stringify` writes back unchanged, so replay is exact; `number` would allow `1.0` or `1e2`. Integers
// stop at 15 digits, past which parsing can round them.
const valueRule = (schema: JsonSchema): string | undefined => {
  if (Array.isArray(schema.enum)) return `(${schema.enum.map((item) => larkString(encodeJson(item))).join(" | ")})`
  if (schema.type === "boolean") return '("true" | "false")'
  if (schema.type === "string") return '/"(?:[^"\\\\\\x00-\\x1f]|\\\\["\\\\bfnrt])*"/'
  if (schema.type !== "integer") return undefined
  const minimum =
    typeof schema.minimum === "number"
      ? schema.minimum
      : typeof schema.exclusiveMinimum === "number"
        ? schema.exclusiveMinimum + 1
        : undefined
  if (minimum === undefined || minimum < 0) return "/0|-?[1-9][0-9]{0,14}/"
  return minimum >= 1 ? "/[1-9][0-9]{0,14}/" : "/0|[1-9][0-9]{0,14}/"
}

const larkString = (text: string) => JSON.stringify(text)

// A regex for text that does not start with `prefix`: it differs from the prefix at some character, or is a shorter
// prefix of it.
const notStartingWith = (prefix: string) => {
  const chars = [...prefix]
  const head = (end: number) => chars.slice(0, end).map(escapeRegex).join("")
  const differs = chars.map((char, index) => `${head(index)}[^${escapeClass(char)}]`)
  const shorter = chars.slice(1).map((_, index) => head(index + 1))
  return [`(?:${differs.join("|")})[\\s\\S]*`, ...shorter].join("|")
}

const escapeRegex = (char: string) => char.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")
const escapeClass = (char: string) => char.replace(/[\\\]^\-/]/g, "\\$&")

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
  if (custom.options) return { syntax: "lark" as const, definition: custom.options.grammar }
  const format = custom.format
  if (format.type === "text") return undefined
  return { syntax: format.type, definition: format.type === "regex" ? format.pattern : (format.grammar ?? "") }
}

/** The custom tool's description, with how to write the options line when it has one. */
export const description = (tool: ToolDefinition, custom: Custom) =>
  custom.options ? `${tool.description}\n\n${custom.options.description}` : tool.description

/** Raw text replayed for a past call: its field, or the whole input as JSON when the field is not a string. */
export const toRaw = (custom: Custom, input: unknown) => {
  const value = isRecord(input) ? input[custom.field] : undefined
  if (typeof value !== "string" || !isRecord(input)) return encodeJson(input ?? {})
  const options = custom.options?.fields.flatMap((name) => (input[name] === undefined ? [] : [[name, input[name]]]))
  if (!custom.options || !options?.length) return value
  return `${custom.options.prefix} ${encodeJson(Object.fromEntries(options))}\n${value}`
}

/**
 * JSON arguments for a raw call. A call to an undeclared custom tool fills `input`. An options line that is not a JSON
 * object of the tool's optional parameters leaves the raw text, which is not JSON, so the call fails as malformed.
 */
export const fromRaw = (custom: Custom | undefined, raw: string) => {
  if (!custom?.options || !raw.startsWith(custom.options.prefix)) return encodeJson({ [field(custom)]: raw })
  const end = raw.indexOf("\n")
  const options = Option.getOrUndefined(
    decodeArguments(raw.slice(custom.options.prefix.length, end === -1 ? undefined : end)),
  )
  const fields = custom.options.fields
  if (!options || !Object.keys(options).every((name) => fields.includes(name))) return raw
  return encodeJson({ ...options, [custom.field]: end === -1 ? "" : raw.slice(end + 1) })
}

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
 * decode to it, so an authoritative final input that disagrees replaces the streamed one instead. A closed call with
 * an options line keeps the streamed raw text in its deltas, and its input becomes the parsed fields.
 */
export const close = <K extends string | number>(
  tools: ToolStream.State<K>,
  keys: Iterable<K>,
  custom: ReadonlyMap<string, Custom>,
  final?: string,
) =>
  [...keys].reduce<{ readonly tools: ToolStream.State<K>; readonly events: ReadonlyArray<LLMEvent> }>(
    (result, key) => {
      const pending = result.tools[key]
      const definition = pending && custom.get(pending.name)
      const streamed = pending && Option.getOrUndefined(decodeArguments(`${pending.input}${STREAM_END}`))
      const raw = streamed?.[field(definition)]
      if (!pending || (final !== undefined && raw !== final)) return result
      const appended = ToolStream.append(result.tools, key, STREAM_END)
      if (!appended) return result
      const parsed = definition?.options && typeof raw === "string" ? fromRaw(definition, raw) : undefined
      return {
        tools:
          parsed === undefined ? appended.tools : { ...appended.tools, [key]: { ...appended.tool, input: parsed } },
        events: [...result.events, ...appended.events],
      }
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
