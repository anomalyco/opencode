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

// The order-free grammar has a rule per subset of parameters; past this many, keys must follow the schema's order.
const ORDER_FREE_LIMIT = 4

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
      description: describe(field, fields, lark && fields.length > ORDER_FREE_LIMIT),
      grammar: lark ? lineGrammar(fields, rules, tool.freeform) : undefined,
    },
  }
}

// Spaces may follow `{`, `:` and `,` and precede `}`. Without required parameters a call may leave the line out, so
// plain raw text can't start with the prefix.
const lineGrammar = (fields: ReadonlyArray<OptionField>, rules: ReadonlyArray<string>, format: Freeform) => {
  const body = format.type === "text" ? "ff_body" : "fb_start"
  const plain = format.type === "text" ? "ff_plain" : body
  return [
    `start: ff_line ${body}${fields.some((item) => item.required) ? "" : ` | ${plain}`}`,
    `ff_line: ${larkString(PREFIX)} " "* "{" " "* ff_object " "* "}" "\\n"`,
    ...(fields.length > ORDER_FREE_LIMIT ? inOrder(fields) : anyOrder(fields)),
    ...rules.map(
      (rule, index) => `ff_pair_${index}: ${larkString(encodeJson(fields[index].name))} " "* ":" " "* ${rule}`,
    ),
    ...(format.type === "text"
      ? ["ff_body: /[\\s\\S]+/", `ff_plain: /${notStartingWith(PREFIX)}/`]
      : format.type === "regex"
        ? [`fb_start: /${format.pattern.replace(/\\?\//g, "\\/")}/`]
        : [renamed(format.grammar)]),
  ].join("\n")
}

// Each key at most once, in any order: `ff_rest_N` follows the pairs in bitmask N, and may end once every required
// one is in.
const anyOrder = (fields: ReadonlyArray<OptionField>) => {
  const all = (1 << fields.length) - 1
  const needed = fields.reduce((mask, item, index) => (item.required ? mask | (1 << index) : mask), 0)
  const choices = (used: number, separator: string) =>
    fields
      .flatMap((_, index) => {
        const next = used | (1 << index)
        return used & (1 << index) ? [] : [`${separator}ff_pair_${index}${next === all ? "" : ` ff_rest_${next}`}`]
      })
      .join(" | ")
  return [
    `ff_object: ${choices(0, "")}`,
    ...Array.from({ length: all - 1 }, (_, index) => index + 1).map((used) => {
      const next = choices(used, '"," " "* ')
      return `ff_rest_${used}: ${(used & needed) === needed ? `(${next})?` : next}`
    }),
  ]
}

// Keys in schema order, each optional one skippable.
const inOrder = (fields: ReadonlyArray<OptionField>) => {
  const rest = (index: number) => (index === fields.length ? "" : ` ff_rest_${index}`)
  return [
    "ff_object: ff_first_0",
    ...fields.map((item, index) => {
      const pair = `ff_pair_${index}${rest(index + 1)}`
      return `ff_first_${index}: ${item.required || index === fields.length - 1 ? pair : `${pair} | ff_first_${index + 1}`}`
    }),
    ...fields.slice(1).map((item, offset) => {
      const pair = `"," " "* ff_pair_${offset + 1}`
      return `ff_rest_${offset + 1}: ${item.required ? pair : `(${pair})?`}${rest(offset + 2)}`
    }),
  ]
}

// The tool's grammar becomes the body: every name it defines gets a prefix, so none collides with the line's rules,
// and its `start` becomes `fb_start`. Strings, regexes and comments are left alone.
const renamed = (grammar: string) => {
  const defined = new Set([...grammar.matchAll(/^[ \t]*[?!]?(\w+)(?:\.-?\d+)?[ \t]*:/gm)].map((match) => match[1]))
  return grammar.replace(/"(?:[^"\\\n]|\\.)*"i?|\/\/[^\n]*|\/(?:[^/\\\n]|\\.)+\/[imslux]*|\w+/g, (token) =>
    defined.has(token)
      ? token.replace(/^(_?)([A-Z]?)/, (_, under: string, upper: string) => `${under}${upper ? "FB_" : "fb_"}${upper}`)
      : token,
  )
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

const typeName = (schema: JsonSchema) => {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((item) => encodeJson(item)).join(", ")}`
  if (schema.type === "integer" && minimum(schema) >= 1) return "positive integer"
  return String(schema.type)
}

const signature = (item: OptionField) =>
  `\`${item.name}\` (${typeName(item.schema)}${item.required ? ", required" : ""})`

const describe = (field: string, fields: ReadonlyArray<OptionField>, ordered: boolean) => {
  const required = fields.filter((item) => item.required)
  const example = required.length > 0 ? required : [fields.find((item) => item.schema.type === "boolean") ?? fields[0]]
  const names = fields.map((item) => `\`${item.name}\``)
  return [
    required.length === 0
      ? `To set ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`}, start with a \`${PREFIX}\` line holding a JSON object of them, then write \`${field}\` from the next line. Leave the line out to use the defaults.`
      : `Start with a \`${PREFIX}\` line holding a JSON object of the parameters below, then write \`${field}\` from the next line.`,
    ...(ordered ? ["Write the keys in the order listed."] : []),
    ...fields.map(
      (item) =>
        `- ${signature(item)}${typeof item.schema.description === "string" ? `: ${item.schema.description}` : ""}`,
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
  const options = pick(fields, input)
  if (Object.keys(options).length === 0) return value
  const canonical = encodeJson(options)
  const saved = typeof header === "string" ? header : undefined
  const read = saved === undefined || !custom.options ? undefined : readOptions(custom.options, saved)
  const same = saved !== undefined && typeof read === "object" && encodeJson(pick(fields, read)) === canonical
  return `${same ? saved : `${PREFIX} ${canonical}`}\n${value}`
}

const pick = (fields: ReadonlyArray<OptionField>, input: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(fields.flatMap((item) => (input[item.name] === undefined ? [] : [[item.name, input[item.name]]])))

/**
 * JSON arguments for a raw call, with its line as `header`. A call to an undeclared custom tool fills `input`. A bad
 * line gives an `error` saying what is wrong instead.
 */
export const parse = (custom: Custom | undefined, raw: string) => {
  if (!custom?.options) return { input: encodeJson({ [field(custom)]: raw }) }
  const options = custom.options
  if (!raw.startsWith(PREFIX))
    return options.fields.some((item) => item.required)
      ? { error: invalid(custom, options, "the line is missing") }
      : { input: encodeJson({ [custom.field]: raw }) }
  const end = raw.indexOf("\n")
  const header = end === -1 ? raw : raw.slice(0, end)
  const read = readOptions(options, header)
  if (typeof read === "string") return { error: invalid(custom, options, read) }
  if (end === -1) return { error: invalid(custom, options, `\`${custom.field}\` must start on the next line`) }
  return { input: encodeJson({ ...read, [custom.field]: raw.slice(end + 1) }), header }
}

/** The line's parameters, or what is wrong with them. */
const readOptions = (options: NonNullable<Custom["options"]>, header: string) => {
  const value = Option.getOrUndefined(decodeArguments(header.slice(PREFIX.length)))
  if (value === undefined) return "it does not hold a JSON object"
  const unknown = Object.keys(value).find((name) => !options.fields.some((item) => item.name === name))
  if (unknown !== undefined) return `\`${unknown}\` is not one of its parameters`
  const missing = options.fields.find((item) => item.required && value[item.name] === undefined)
  if (missing) return `\`${missing.name}\` is missing`
  const wrong = options.fields.find((item) => value[item.name] !== undefined && !accepts(item.schema, value[item.name]))
  if (wrong) return `\`${wrong.name}\` has the wrong type (${typeName(wrong.schema)})`
  return value
}

const accepts = (schema: JsonSchema, value: unknown) => {
  if (Array.isArray(schema.enum)) return schema.enum.some((item) => encodeJson(item) === encodeJson(value))
  return schema.type === "integer" ? Number.isInteger(value) : typeof value === schema.type
}

const invalid = (custom: Custom, options: NonNullable<Custom["options"]>, problem: string) =>
  `Invalid \`${PREFIX}\` line: ${problem}. Start the raw text with \`${PREFIX}\` and a JSON object of ${options.fields.map(signature).join(", ")}, then write \`${custom.field}\` from the next line.`

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
  if ("error" in parsed) return { ...tool, input: raw, error: parsed.error }
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
