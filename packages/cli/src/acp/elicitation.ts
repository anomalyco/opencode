import type {
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  EnumOption,
} from "@agentclientprotocol/sdk"
import type { EventSubscribeOutput, SessionFormReplyInput } from "@opencode/client/promise"
import { Form as FormSchema } from "@opencode/schema/form"
import { Option, Schema } from "effect"

export type Form = Extract<EventSubscribeOutput, { type: "form.created" }>["data"]["form"]
type Field = Form["fields"][number]
type InputField = Exclude<Field, { type: "external" }>
type SelectField = Extract<InputField, { type: "string" | "multiselect" }>

const Content = Schema.Record(Schema.String, FormSchema.Value)
const ToolSource = Schema.Struct({ tool: Schema.Struct({ id: Schema.String }) })

/**
 * The form-mode schema for a V2 form, or undefined when ACP cannot represent it faithfully. Unrepresentable forms
 * are those with `external` fields, `when` conditions, a default outside a field's options, or a free-text answer
 * alongside options that must also satisfy `required` or item bounds across both inputs. Hidden fields are not
 * asked and answer with their default.
 */
export function requestedSchema(form: Form): ElicitationSchema | undefined {
  const fields = form.fields.filter((field): field is InputField => field.type !== "external")
  if (fields.length !== form.fields.length) return undefined
  const keys = new Set(fields.map((field) => field.key))
  if (!fields.every((field) => representable(field, keys))) return undefined
  const asked = fields.filter((field) => !field.hidden)
  return {
    type: "object",
    properties: Object.fromEntries(asked.flatMap(properties)),
    required: asked.filter((field) => field.required).map((field) => field.key),
  }
}

/** The V2 answer for an accepted response, or undefined when the user declined, cancelled, or sent no valid content. */
export function answer(form: Form, response: CreateElicitationResponse): SessionFormReplyInput["answer"] | undefined {
  if (response.action !== "accept") return undefined
  const content = Schema.decodeUnknownOption(Content)(response.content ?? {})
  if (Option.isNone(content)) return undefined
  return Object.fromEntries(
    form.fields.flatMap((field) => {
      if (field.type === "external") return []
      const value = field.hidden ? field.default : fieldAnswer(field, content.value)
      return value === undefined ? [] : [[field.key, value]]
    }),
  )
}

/** The tool call that asked the form, when its metadata names one. */
export function toolCallID(form: Form) {
  return Schema.decodeUnknownOption(ToolSource)(form.metadata).pipe(
    Option.map((metadata) => metadata.tool.id),
    Option.getOrUndefined,
  )
}

function representable(field: InputField, keys: ReadonlySet<string>) {
  if (field.when?.length) return false
  if (field.type !== "string" && field.type !== "multiselect") return true
  if (!hasOptions(field)) return true
  const values = new Set(field.options?.map((option) => option.value))
  const defaults =
    field.default === undefined ? [] : typeof field.default === "string" ? [field.default] : field.default
  if (defaults.some((value) => !values.has(value))) return false
  if (!field.custom) return true
  if (field.required || keys.has(customKey(field))) return false
  return field.type === "string" || (field.minItems === undefined && field.maxItems === undefined)
}

function properties(field: InputField): Array<[string, ElicitationPropertySchema]> {
  const base = { title: field.title, description: field.description }
  switch (field.type) {
    case "string": {
      if (!hasOptions(field)) return [[field.key, { type: "string", ...base, ...text(field), default: field.default }]]
      const select: ElicitationPropertySchema = {
        type: "string",
        ...base,
        oneOf: options(field),
        default: field.default,
      }
      return field.custom ? [[field.key, select], other(field, "Type your own answer")] : [[field.key, select]]
    }
    case "multiselect": {
      const select: ElicitationPropertySchema = {
        type: "array",
        ...base,
        items: { anyOf: options(field) },
        minItems: field.required ? Math.max(field.minItems ?? 0, 1) : field.minItems,
        maxItems: field.maxItems,
        default: field.default,
      }
      return field.custom ? [[field.key, select], other(field, "Add your own answer")] : [[field.key, select]]
    }
    case "number":
    case "integer":
      return [
        [
          field.key,
          { type: field.type, ...base, minimum: field.minimum, maximum: field.maximum, default: field.default },
        ],
      ]
    case "boolean":
      return [[field.key, { type: "boolean", ...base, default: field.default }]]
  }
}

// A free-text answer next to a field's options is a separate optional property that wins over the selection.
function other(field: SelectField, description: string): [string, ElicitationPropertySchema] {
  return [
    customKey(field),
    {
      type: "string",
      title: `${field.title ?? field.key} (other)`,
      description,
      ...(field.type === "string" ? text(field) : {}),
    },
  ]
}

// Core rejects an empty string for a required field, so the client is told it needs at least one character.
function text(field: Extract<InputField, { type: "string" }>) {
  return {
    format: field.format,
    minLength: field.required ? Math.max(field.minLength ?? 0, 1) : field.minLength,
    maxLength: field.maxLength,
    pattern: field.pattern,
  }
}

function options(field: SelectField): EnumOption[] {
  return (field.options ?? []).map((option) => ({
    const: option.value,
    title: option.label,
    description: option.description,
  }))
}

function fieldAnswer(field: InputField, content: typeof Content.Type) {
  const value = content[field.key]
  if ((field.type !== "string" && field.type !== "multiselect") || !field.custom || !hasOptions(field)) return value
  const custom = content[customKey(field)]
  if (typeof custom !== "string" || custom.trim() === "") return value
  if (field.type === "string") return custom
  return Array.isArray(value) ? [...value, custom] : [custom]
}

function hasOptions(field: SelectField) {
  return field.type === "multiselect" || field.options !== undefined
}

function customKey(field: SelectField) {
  return `${field.key}_custom`
}

export * as ACPElicitation from "./elicitation"
