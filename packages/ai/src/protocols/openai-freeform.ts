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
  /** The tool's other parameters, set on a first line. */
  readonly options?: {
    readonly fields: ReadonlyArray<OptionField>
    /** How to write the line, added to the custom tool's description. */
    readonly description: string
    /** The grammar for the line and the raw text, when the model takes Lark. */
    readonly grammar?: string
  }
}

interface OptionField {
  readonly name: string
  readonly schema: JsonSchema
  readonly required: boolean
}

// The other parameters go on a first line as a JSON object, `// @options: {"timeout": 5000}`, then the field's text.
// It is a JavaScript comment, so the line reads naturally before code.
export const PREFIX = "// @options:"

/**
 * How a tool goes out: a custom tool when it declares `freeform` with its required string parameter. Other parameters
 * need a grammar for their values, and a raw text body when the model can't take Lark; otherwise the tool stays a
 * JSON tool.
 */
export const resolve = (tool: ToolDefinition, lark = true): Custom | undefined => {
  const field = ToolDefinition.freeformField(tool.inputSchema, tool.freeform)
  if (tool.freeform === undefined || tool.native !== undefined || field === undefined) return undefined
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : []
  const fields = Object.entries(Schema.is(JsonSchema)(tool.inputSchema.properties) ? tool.inputSchema.properties : {})
    .filter(([name]) => name !== field)
    .map(([name, schema]) => ({
      name,
      schema: Schema.is(JsonSchema)(schema) ? schema : {},
      required: required.includes(name),
    }))
  if (fields.length === 0) return { field, format: tool.freeform }
  const rules = fields.flatMap((item) => valueRule(item.schema) ?? [])
  if (rules.length !== fields.length || (!lark && tool.freeform.type !== "text")) return undefined
  return {
    field,
    format: tool.freeform,
    options: {
      fields,
      description: describe(field, fields),
      grammar: lark ? lineGrammar(fields, rules, tool.freeform) : undefined,
    },
  }
}

// Keys in any order, with spaces after `{`, `:` and `,` and before `}`. The tool's own schema checks the values it
// gets, as it does for a JSON call. Without required parameters a call may leave the line out, so plain raw text
// can't start with the prefix. A tool's own grammar becomes the body, its `start` renamed to `fb_start`.
const lineGrammar = (fields: ReadonlyArray<OptionField>, rules: ReadonlyArray<string>, format: Freeform) => {
  const body = format.type === "text" ? "ff_body" : "fb_start"
  const plain = format.type === "text" ? "ff_plain" : body
  return [
    `start: ff_line ${body}${fields.some((item) => item.required) ? "" : ` | ${plain}`}`,
    `ff_line: ${larkString(PREFIX)} " "* "{" " "* ff_pair (" "* "," " "* ff_pair)* " "* "}" "\\n"`,
    `ff_pair: ${fields.map((item, index) => `${larkString(encodeJson(item.name))} " "* ":" " "* ${rules[index]}`).join(" | ")}`,
    ...(format.type === "text"
      ? ["ff_body: /[\\s\\S]+/", `ff_plain: /${notStartingWith(PREFIX)}/`]
      : format.type === "regex"
        ? [`fb_start: /${format.pattern.replace(/\\?\//g, "\\/")}/`]
        : [format.grammar.replace(/^([ \t]*)start([ \t]*:)/m, "$1fb_start$2")]),
  ].join("\n")
}

const valueRule = (schema: JsonSchema) => {
  if (Array.isArray(schema.enum))
    return schema.enum.length === 0
      ? undefined
      : `(${schema.enum.map((item) => larkString(encodeJson(item))).join(" | ")})`
  if (schema.type === "boolean") return '("true" | "false")'
  if (schema.type === "number") return "/-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/"
  if (schema.type === "string") return '/"(?:[^"\\\\\\x00-\\x1f]|\\\\["\\\\\\/bfnrt]|\\\\u[0-9a-fA-F]{4})*"/'
  if (schema.type !== "integer") return undefined
  const lowest = minimum(schema)
  if (lowest >= 1) return "/[1-9][0-9]*/"
  return lowest >= 0 ? "/0|[1-9][0-9]*/" : "/-?(?:0|[1-9][0-9]*)/"
}

const minimum = (schema: JsonSchema) =>
  Math.max(
    typeof schema.minimum === "number" ? schema.minimum : -Infinity,
    typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum + 1 : -Infinity,
  )

const describe = (field: string, fields: ReadonlyArray<OptionField>) => {
  const required = fields.filter((item) => item.required)
  const example = required.length > 0 ? required : [fields.find((item) => item.schema.type === "boolean") ?? fields[0]]
  return [
    required.length === 0
      ? `To set the parameters below, start with a \`${PREFIX}\` line holding a JSON object of them, then write \`${field}\` from the next line. Leave the line out to use the defaults.`
      : `Start with a \`${PREFIX}\` line holding a JSON object of the parameters below, then write \`${field}\` from the next line.`,
    ...fields.map(
      (item) =>
        `- \`${item.name}\` (${Array.isArray(item.schema.enum) ? `one of ${item.schema.enum.map((value) => encodeJson(value)).join(", ")}` : String(item.schema.type)}${item.required ? ", required" : ""})${typeof item.schema.description === "string" ? `: ${item.schema.description}` : ""}`,
    ),
    "For example:",
    `${PREFIX} {${example.map((item) => `${encodeJson(item.name)}: ${encodeJson(sample(item.schema))}`).join(", ")}}`,
    `<${field}>`,
  ].join("\n")
}

const sample = (schema: JsonSchema) => {
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (schema.type === "boolean") return true
  if (schema.type === "string") return "..."
  return Math.max(1, minimum(schema))
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
  const lark = request.model.capabilities?.tools?.freeform?.includes("lark") ?? true
  const added = request.messages.flatMap((message) => toolsUpdate(message)?.add ?? [])
  return new Map(
    flattenTools([...request.tools, ...added]).flatMap((tool) => {
      const custom = resolve(tool, lark)
      return custom ? [[tool.name, custom] as const] : []
    }),
  )
}

/** The grammar to send, or `undefined` for unconstrained text. */
export const grammar = (custom: Custom) => {
  if (custom.options)
    return custom.options.grammar === undefined
      ? undefined
      : { syntax: "lark" as const, definition: custom.options.grammar }
  const format = custom.format
  if (format.type === "text") return undefined
  return { syntax: format.type, definition: format.type === "regex" ? format.pattern : format.grammar }
}

/** The custom tool's description, with how to write the line when the tool has other parameters. */
export const description = (tool: ToolDefinition, custom: Custom) =>
  custom.options ? `${tool.description}\n\n${custom.options.description}` : tool.description

/**
 * Raw text replayed for a past call: its field after a line for the other parameters, or the whole input as JSON when
 * the field is not a string. The line the model wrote, saved as `header`, replays as is while it still says the same,
 * so the prompt cache holds; otherwise, as for a call another model made, a fresh line is written.
 */
export const toRaw = (custom: Custom, input: unknown, header?: unknown) => {
  const value = isRecord(input) ? input[custom.field] : undefined
  if (typeof value !== "string" || !isRecord(input)) return encodeJson(input ?? {})
  const fields = custom.options?.fields ?? []
  const options = encodeJson(pick(fields, input))
  if (options === "{}") return value
  const saved = typeof header === "string" ? Option.getOrUndefined(decodeLine(header)) : undefined
  const same = saved !== undefined && encodeJson(pick(fields, saved)) === options
  return `${same ? header : `${PREFIX} ${options}`}\n${value}`
}

const pick = (fields: ReadonlyArray<OptionField>, input: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(fields.flatMap((item) => (input[item.name] === undefined ? [] : [[item.name, input[item.name]]])))

/**
 * JSON arguments for a raw call, with its line as `header`. A call to an undeclared custom tool fills `input`. A line
 * that isn't a JSON object stays raw text, which fails as malformed JSON; the tool's schema checks the rest.
 */
export const parse = (custom: Custom | undefined, raw: string) => {
  const end = raw.indexOf("\n")
  if (!custom?.options || !raw.startsWith(PREFIX) || end === -1) return { input: encodeJson({ [field(custom)]: raw }) }
  const header = raw.slice(0, end)
  const options = Option.getOrUndefined(decodeLine(header))
  if (options === undefined) return { input: raw }
  return { input: encodeJson({ ...options, [custom.field]: raw.slice(end + 1) }), header }
}

const decodeLine = (header: string) => decodeArguments(header.slice(PREFIX.length))

const field = (custom: Custom | undefined) => custom?.field ?? "input"

// Streamed raw text is re-encoded as JSON-argument fragments, so the tool-input events match a JSON tool's.
/** The opening fragment, `{"field":"`, followed by the escaped first text. */
export const streamStart = (custom: Custom | undefined, raw = "") =>
  `{${encodeJson(field(custom))}:"${streamDelta(raw)}`
export const streamDelta = (raw: string) => encodeJson(raw).slice(1, -1)
const STREAM_END = '"}'

const decodeArguments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

/**
 * Close the JSON fragment of each open custom call, and set its input from the raw text. With a `final` raw input
 * that the streamed fragments don't decode to, the final one sets the input and the streamed one stays unclosed. A
 * line the model wrote goes in the call's provider metadata as `header`, so it replays exactly.
 */
export const close = <K extends string | number>(
  tools: ToolStream.State<K>,
  keys: Iterable<K>,
  custom: ReadonlyMap<string, Custom>,
  metadataKey: string,
  final?: string,
) =>
  [...keys].reduce<{ readonly tools: ToolStream.State<K>; readonly events: ReadonlyArray<LLMEvent> }>(
    (result, key) => {
      const pending = result.tools[key]
      if (!pending) return result
      const definition = custom.get(pending.name)
      const streamed = Option.getOrUndefined(decodeArguments(`${pending.input}${STREAM_END}`))?.[field(definition)]
      if (final !== undefined && streamed !== final)
        return {
          tools: { ...result.tools, [key]: settle(pending, definition, metadataKey, final) },
          events: result.events,
        }
      const appended = ToolStream.append(result.tools, key, STREAM_END)
      if (!appended) return result
      return {
        tools:
          typeof streamed === "string"
            ? { ...appended.tools, [key]: settle(appended.tool, definition, metadataKey, streamed) }
            : appended.tools,
        events: [...result.events, ...appended.events],
      }
    },
    { tools, events: [] },
  )

const settle = (
  tool: ToolStream.PendingTool,
  custom: Custom | undefined,
  metadataKey: string,
  raw: string,
): ToolStream.PendingTool => {
  const parsed = parse(custom, raw)
  if (parsed.header === undefined) return { ...tool, input: parsed.input }
  return {
    ...tool,
    input: parsed.input,
    providerMetadata: {
      ...tool.providerMetadata,
      [metadataKey]: { ...tool.providerMetadata?.[metadataKey], header: parsed.header },
    },
  }
}

/** Provider metadata marking a call that arrived as a custom tool call. */
export const metadata = (itemId: string, custom: boolean) => (custom ? { itemId, custom: true } : { itemId })

/**
 * Whether a replayed call keeps its item id: only when it goes out as the type it arrived as, since OpenAI item ids
 * name their type (`fc_`, `ctc_`). The `call_id` always survives.
 */
export const keepsItemID = (providerMetadata: ProviderMetadata | undefined, key: string, custom: boolean) =>
  (providerMetadata?.[key]?.custom === true) === custom

export * as OpenAIFreeform from "./openai-freeform.js"
