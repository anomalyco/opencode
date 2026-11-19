export type OpenApiSchema = {
  $ref?: string
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  deprecated?: boolean
  enum?: unknown[]
  const?: unknown
  default?: unknown
  anyOf?: OpenApiSchema[]
  oneOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
  items?: OpenApiSchema
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  additionalProperties?: boolean | OpenApiSchema
  pattern?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export type OpenApiContent = Record<string, { schema?: OpenApiSchema }>

export type OpenApiParameter = {
  name: string
  in: string
  description?: string
  required?: boolean
  schema?: OpenApiSchema
}

export type OpenApiOperation = {
  tags?: string[]
  operationId?: string
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    description?: string
    required?: boolean
    content?: OpenApiContent
  }
  responses?: Record<string, { description?: string; content?: OpenApiContent }>
}

export function openApiSchemaLabel(schema?: OpenApiSchema): string {
  if (!schema) return "empty"
  if (schema.$ref) return schema.$ref.split("/").at(-1) ?? schema.$ref
  if (schema.enum) return schema.enum.map(formatOpenApiValue).join(" | ")
  if (schema.anyOf) return schema.anyOf.map(openApiSchemaLabel).join(" | ")
  if (schema.oneOf) return schema.oneOf.map(openApiSchemaLabel).join(" | ")
  if (schema.allOf) return schema.allOf.map(openApiSchemaLabel).join(" & ")
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type ?? "object")
  if (type === "array") return `${openApiSchemaLabel(schema.items)}[]`
  return schema.format ? `${type}<${schema.format}>` : type
}

export function formatOpenApiValue(value: unknown) {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? String(value)
}
