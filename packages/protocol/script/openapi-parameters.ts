type Schema = { description?: string; allOf?: Array<Record<string, unknown>>; [key: string]: unknown }
type Parameter = { description?: string; schema?: Schema; [key: string]: unknown }
type Document = { paths?: Record<string, Record<string, { parameters?: Array<Parameter> }>> }

// Effect writes a parameter's description into its schema: `.annotate` sets `schema.description`, and `.annotateKey`
// (used where annotating would rename a shared component) adds a `{ description }` member to `schema.allOf`. OpenAPI
// documents parameters by `parameters[].description`, so move it there.
export function liftParameterDescriptions<T extends object>(document: T): T {
  for (const operations of Object.values((document as Document).paths ?? {}))
    for (const operation of Object.values(operations))
      operation.parameters = operation.parameters?.map((parameter) => {
        if (parameter.schema === undefined || parameter.description !== undefined) return parameter
        const description = parameter.schema.allOf?.find(isDescription)?.description ?? parameter.schema.description
        if (description === undefined) return parameter
        return { ...parameter, description, schema: withoutDescription(parameter.schema) }
      })
  return document
}

function isDescription(member: Record<string, unknown>): member is { description: string } {
  return Object.keys(member).length === 1 && typeof member.description === "string"
}

function withoutDescription(schema: Schema): Schema {
  const rest = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "description" && key !== "allOf"))
  const allOf = schema.allOf?.filter((member) => !isDescription(member)) ?? []
  if (allOf.length === 0) return rest
  if (allOf.length === 1 && Object.keys(rest).length === 0) return allOf[0]
  return { ...rest, allOf }
}
