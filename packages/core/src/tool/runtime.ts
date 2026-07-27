import type { ToolDefinition } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Effect, JsonSchema, Schema } from "effect"

export const definition = (tool: Tool.Info<any, any>): ToolDefinition => ({
  name: effectiveName(tool),
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
})

export const execute = (tool: Tool.Info<any, any>, input: unknown, context: Tool.Context) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool.input, input)
    const result = yield* tool.execute(decoded, context)
    if (tool.output === undefined) {
      if ("output" in result) return yield* Effect.die("Tool result declared output without an output schema")
      return {
        output: undefined,
        content: normalizeContent(result.content),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
      }
    }
    if (!("output" in result)) return yield* new Tool.Error({ message: "Tool did not return its declared output" })
    const output = yield* encodeOutput(tool.output, result.output)
    return {
      output,
      content: normalizeContent(result.content, output),
      ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    }
  })

const decodeInput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((error) => new Tool.Error({ message: `Invalid tool input: ${error.message}` })),
    )
  if (isStandardSchema(schema)) return validateStandard(schema, value, "Invalid tool input")
  return Effect.succeed(value)
}

const encodeOutput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) => new Tool.Error({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
      ),
    )
  if (isStandardSchema(schema))
    return validateStandard(schema, value, "Tool returned an invalid value for its output schema")
  return Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      (error) => new Tool.Error({ message: `Tool returned a non-JSON value for its output schema: ${error.message}` }),
    ),
  )
}

const isStandardSchema = (
  schema: Tool.ValueSchema<any>,
): schema is StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any> =>
  typeof schema === "object" && schema !== null && "~standard" in schema

const validateStandard = (
  schema: StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any>,
  value: unknown,
  prefix: string,
) =>
  Effect.gen(function* () {
    const pending = yield* Effect.try({
      try: () => schema["~standard"].validate(value),
      catch: (error) => standardFailure(prefix, error),
    })
    const result =
      pending instanceof Promise
        ? yield* Effect.tryPromise({ try: () => pending, catch: (error) => standardFailure(prefix, error) })
        : pending
    if (result.issues)
      return yield* new Tool.Error({
        message: `${prefix}: ${result.issues.map((issue) => issue.message).join(", ")}`,
      })
    return result.value
  })

const standardFailure = (prefix: string, error: unknown) =>
  new Tool.Error({ message: `${prefix}: ${error instanceof Error ? error.message : String(error)}` })

const inputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (schema === undefined || schema === null) return {}
  if (isStandardSchema(schema))
    return schema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return Schema.isSchema(schema) ? toJsonSchema(schema) : (schema as JsonSchema.JsonSchema)
}

const outputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (isStandardSchema(schema))
    return schema["~standard"].jsonSchema.output({ target: "draft-2020-12" }) as JsonSchema.JsonSchema
  return Schema.isSchema(schema) ? toJsonSchema(schema) : (schema as JsonSchema.JsonSchema)
}

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

export const normalizeContent = (value: string | ReadonlyArray<Tool.Content> | undefined, output?: unknown) => {
  if (typeof value === "string") return [{ type: "text" as const, text: value }]
  if (value !== undefined && value.length > 0) return [...value]
  return [{ type: "text" as const, text: stringify(output) }]
}

const stringify = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`
