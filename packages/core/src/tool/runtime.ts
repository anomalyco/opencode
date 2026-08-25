import type { ToolDefinition } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec"
import { Cache, Effect, JsonSchema, Schema, SchemaIssue, SchemaRepresentation } from "effect"

type InputIssue = {
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

type InputResult = { readonly value: unknown } | { readonly issues: ReadonlyArray<InputIssue> }

const formatEffectIssue = SchemaIssue.makeFormatterStandardSchemaV1()
const inputIssueLimit = 5

const jsonSchemas = Effect.runSync(
  Cache.make<JsonSchema.JsonSchema, Schema.Codec<unknown> | undefined>({
    capacity: 100,
    lookup: (schema) =>
      Effect.try({
        try: () => jsonSchema(schema),
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined)),
  }),
)

export const definition = (tool: Tool.Info<any, any>): ToolDefinition => ({
  name: effectiveName(tool),
  description: tool.description,
  inputSchema: inputJsonSchema(tool.input),
  ...(tool.output === undefined ? {} : { outputSchema: outputJsonSchema(tool.output) }),
})

export const execute = (tool: Tool.Info<any, any>, input: unknown, context: Tool.Context) =>
  Effect.gen(function* () {
    const decoded = yield* decodeInput(tool, input)
    // Tool implementations declare `Tool.Error` but plugins can fail with anything at
    // runtime. A foreign typed failure would slip past every `catchTag("Tool.Error")`
    // downstream and leave its call permanently unsettled, so the declared contract is
    // enforced here at the untrusted boundary. Declines tunnel through as defects and
    // interrupts are not errors; neither is touched.
    const result = yield* tool.execute(decoded, context).pipe(
      Effect.mapError((error: unknown) =>
        error instanceof Tool.Error
          ? error
          : new Tool.Error({
              message: error instanceof globalThis.Error ? error.message : String(error),
            }),
      ),
    )
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

const decodeInput = (tool: Tool.Info<any, any>, value: unknown) =>
  decodeInputResult(tool.input, value).pipe(
    Effect.flatMap((result) =>
      "issues" in result
        ? Effect.fail(new Tool.Error({ message: formatInputIssues(effectiveName(tool), result.issues) }))
        : Effect.succeed(result.value),
    ),
  )

const decodeInputResult = (schema: Tool.ValueSchema<any>, value: unknown): Effect.Effect<InputResult> => {
  if (Schema.isSchema(schema)) return decodeEffectInput(schema, value)
  if (isStandardSchema(schema)) return validateStandardResult(schema, value)
  return Cache.get(jsonSchemas, schema).pipe(
    Effect.flatMap((schema) => (schema === undefined ? Effect.succeed({ value }) : decodeEffectInput(schema, value))),
  )
}

const decodeEffectInput = (schema: Schema.Codec<unknown>, value: unknown): Effect.Effect<InputResult> =>
  Schema.decodeUnknownEffect(schema)(value, { errors: "all" }).pipe(
    Effect.map((value) => ({ value })),
    Effect.catch((error) => Effect.succeed({ issues: normalizeEffectIssues(error.issue) })),
  )

const normalizeEffectIssues = (issue: SchemaIssue.Issue): ReadonlyArray<InputIssue> =>
  formatEffectIssue(issue).issues.map(normalizeStandardIssue)

const normalizeStandardIssue = (issue: StandardSchemaV1.Issue): InputIssue => ({
  path: issue.path?.map((segment) => (typeof segment === "object" ? segment.key : segment)) ?? [],
  message: issue.message,
})

const validateStandardResult = (
  schema: StandardSchemaV1<any, any> & StandardJSONSchemaV1<any, any>,
  value: unknown,
): Effect.Effect<InputResult> =>
  Effect.gen(function* () {
    const pending = yield* Effect.try({
      try: () => schema["~standard"].validate(value),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({ issues: [{ message: error instanceof Error ? error.message : String(error) }] }),
      ),
    )
    const result =
      pending instanceof Promise
        ? yield* Effect.tryPromise({
            try: () => pending,
            catch: (error) => error,
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({ issues: [{ message: error instanceof Error ? error.message : String(error) }] }),
            ),
          )
        : pending
    if (result.issues) return { issues: result.issues.map(normalizeStandardIssue) }
    return { value: result.value }
  })

const formatInputIssues = (tool: string, issues: ReadonlyArray<InputIssue>) => {
  const visible = issues.slice(0, inputIssueLimit)
  const remaining = issues.length - visible.length
  const details = visible.map((issue) => `- ${formatInputPath(issue.path)}: ${issue.message}`)
  if (remaining > 0) details.push(`- ...and ${remaining} more ${remaining === 1 ? "issue" : "issues"}`)
  return `Invalid arguments for tool "${tool}":\n${details.join("\n")}\nCorrect the arguments and retry the tool.`
}

const formatInputPath = (path: ReadonlyArray<PropertyKey>) =>
  path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : result === ""
          ? String(segment)
          : `${result}.${String(segment)}`,
    "",
  ) || "root"

const jsonSchema = (schema: JsonSchema.JsonSchema) => {
  const draft =
    (typeof schema.$schema === "string" && schema.$schema.includes("draft-07")) || "definitions" in schema
      ? JsonSchema.fromSchemaDraft07(schema)
      : JsonSchema.fromSchemaDraft2020_12(schema)
  return Schema.make<Schema.Codec<unknown>>(SchemaRepresentation.fromJsonSchemaDocument(draft).ast)
}

const encodeOutput = (schema: Tool.ValueSchema<any>, value: unknown) => {
  if (Schema.isSchema(schema))
    return Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new Tool.Error({ message: `Tool returned an invalid value for its output schema: ${error.message}` }),
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
  validateStandardResult(schema, value).pipe(
    Effect.flatMap((result) =>
      "issues" in result
        ? Effect.fail(
            new Tool.Error({ message: `${prefix}: ${result.issues.map((issue) => issue.message).join(", ")}` }),
          )
        : Effect.succeed(result.value),
    ),
  )

const inputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (schema === undefined || schema === null) return {}
  if (isStandardSchema(schema)) return schema["~standard"].jsonSchema.input({ target: "draft-2020-12" })
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const outputJsonSchema = (schema: Tool.ValueSchema<any>): JsonSchema.JsonSchema => {
  if (isStandardSchema(schema)) return schema["~standard"].jsonSchema.output({ target: "draft-2020-12" })
  return Schema.isSchema(schema) ? toJsonSchema(schema) : schema
}

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  // Effect emits valid JSON Schema that some inference providers handle poorly. Simplify it
  // without changing validation: `{ type: "integer", allOf: [{ minimum: 0 }] }` becomes
  // `{ type: "integer", minimum: 0 }` only when no keyword would be overwritten. Named schemas
  // emit `$ref` plus root `$defs`; inline acyclic local references so providers receive the full
  // nested schema directly, then remove unused `$defs`. Recursive references stay intact because
  // expanding them would never terminate.
  const normalized = flattenAllOf(
    Object.keys(document.definitions).length === 0
      ? document.schema
      : { ...document.schema, $defs: document.definitions },
  )
  return dropDefinitionsIfResolved(inlineLocalReferences(normalized)) as JsonSchema.JsonSchema
}

const flattenAllOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(flattenAllOf)
  if (typeof value !== "object" || value === null) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, flattenAllOf(item)]))
  if (!Array.isArray(schema.allOf) || !schema.allOf.every(isRecord) || !canFlattenAllOf(schema.allOf, schema))
    return schema
  const { allOf, ...rest } = schema
  return flattenAllOf({ ...Object.assign({}, ...allOf), ...rest })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const canFlattenAllOf = (allOf: ReadonlyArray<Record<string, unknown>>, parent: Record<string, unknown>) => {
  const keys = new Set(Object.keys(parent).filter((key) => key !== "allOf"))
  return allOf.every((item) =>
    Object.keys(item).every((key) => {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }),
  )
}

const inlineLocalReferences = (
  value: unknown,
  definitions?: Record<string, unknown>,
  seen = new Set<string>(),
): unknown => {
  if (Array.isArray(value)) return value.map((item) => inlineLocalReferences(item, definitions, seen))
  if (!isRecord(value)) return value

  const localDefinitions = definitions ?? (isRecord(value.$defs) ? value.$defs : undefined)
  if (typeof value.$ref === "string" && localDefinitions) {
    const segment = value.$ref.match(/^#\/\$defs\/([^/]+)$/)?.[1]
    const name = segment?.replaceAll("~1", "/").replaceAll("~0", "~")
    if (name && !seen.has(name)) {
      const target = localDefinitions[name]
      if (target) {
        const { $ref: _, ...rest } = value
        const resolvedTarget = inlineLocalReferences(target, localDefinitions, new Set(seen).add(name))
        const resolvedSiblings = inlineLocalReferences(rest, localDefinitions, seen)
        if (!isRecord(resolvedTarget) || !isRecord(resolvedSiblings)) return resolvedTarget
        if (canMergeRecords(resolvedTarget, resolvedSiblings)) return { ...resolvedTarget, ...resolvedSiblings }
        return { allOf: [resolvedTarget, resolvedSiblings] }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, inlineLocalReferences(item, localDefinitions, seen)]),
  )
}

const canMergeRecords = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  Object.keys(left).every((key) => !(key in right))

const dropDefinitionsIfResolved = (value: unknown): unknown => {
  if (!isRecord(value) || hasLocalReference(value)) return value
  const { $defs: _, ...rest } = value
  return rest
}

const hasLocalReference = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasLocalReference)
  if (!isRecord(value)) return false
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) return true
  return Object.values(value).some(hasLocalReference)
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
