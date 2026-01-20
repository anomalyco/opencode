import type { Elicitation } from "@/mcp/elicitation"

// Field type derived from schema
export type FieldType = "string" | "number" | "boolean" | "enum" | "multiselect"

export interface FormField {
  key: string
  type: FieldType
  title: string
  description?: string
  required: boolean
  default?: string | number | boolean | string[]
  // For enum/multiselect
  options?: Array<{ value: string; label: string }>
  // For validation
  format?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}

export function schemaToFields(schema: Elicitation.RequestedSchema): FormField[] {
  const required = new Set(schema.required ?? [])

  return Object.entries(schema.properties).map(([key, prop]) => {
    const field: FormField = {
      key,
      type: "string",
      title: prop.title ?? key,
      description: prop.description,
      required: required.has(key),
      default: prop.default as string | number | boolean | string[] | undefined,
    }

    if (prop.type === "string") {
      // Check for enum types
      if (prop.oneOf) {
        field.type = "enum"
        field.options = prop.oneOf.map((o) => ({ value: o.const, label: o.title }))
      } else if (prop.enum) {
        field.type = "enum"
        field.options = prop.enum.map((v, i) => ({
          value: v,
          label: prop.enumNames?.[i] ?? v,
        }))
      } else {
        field.type = "string"
        field.format = prop.format
        field.minLength = prop.minLength
        field.maxLength = prop.maxLength
      }
    } else if (prop.type === "number" || prop.type === "integer") {
      field.type = "number"
      field.minimum = prop.minimum
      field.maximum = prop.maximum
    } else if (prop.type === "boolean") {
      field.type = "boolean"
    } else if (prop.type === "array") {
      field.type = "multiselect"
      if (prop.items.anyOf) {
        field.options = prop.items.anyOf.map((o) => ({ value: o.const, label: o.title }))
      } else if (prop.items.enum) {
        field.options = prop.items.enum.map((v) => ({ value: v, label: v }))
      }
    }

    return field
  })
}
