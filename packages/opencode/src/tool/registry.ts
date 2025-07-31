import z from "zod"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ListTool } from "./ls"
import { PatchTool } from "./patch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"

export namespace ToolRegistry {
  const ALL = [
    BashTool,
    EditTool,
    WebFetchTool,
    GlobTool,
    GrepTool,
    ListTool,
    PatchTool,
    ReadTool,
    WriteTool,
    TodoWriteTool,
    TodoReadTool,
    TaskTool,
  ]

  export function ids() {
    return ALL.map((t) => t.id)
  }

  export async function tools(providerID: string, _modelID: string) {
    const result = await Promise.all(
      ALL.map(async (t) => ({
        id: t.id,
        ...(await t.init()),
      })),
    )

    if (providerID === "openai") {
      return result.map((t) => ({
        ...t,
        parameters: optionalToNullable(t.parameters),
      }))
    }

    if (providerID === "azure") {
      return result.map((t) => ({
        ...t,
        parameters: optionalToNullable(t.parameters),
      }))
    }

    if (providerID === "google") {
      return result.map((t) => ({
        ...t,
        parameters: sanitizeGeminiParameters(t.parameters),
      }))
    }

    return result
  }

  export function enabled(_providerID: string, modelID: string): Record<string, boolean> {
    if (modelID.toLowerCase().includes("claude")) {
      return {
        patch: false,
      }
    }

    if (
      modelID.toLowerCase().includes("qwen") ||
      modelID.includes("gpt-") ||
      modelID.includes("o1") ||
      modelID.includes("o3") ||
      modelID.includes("codex")
    ) {
      return {
        patch: false,
        todowrite: false,
        todoread: false,
      }
    }
    return {}
  }

  function sanitizeGeminiParameters(schema: z.ZodTypeAny, visited = new Set()): z.ZodTypeAny {
    if (!schema || visited.has(schema)) {
      return schema
    }
    visited.add(schema)

    if (schema instanceof z.ZodDefault) {
      const innerSchema = schema.removeDefault()
      // Handle Gemini's incompatibility with `default` on `anyOf` (unions).
      if (innerSchema instanceof z.ZodUnion) {
        // The schema was `z.union(...).default(...)`, which is not allowed.
        // We strip the default and return the sanitized union.
        return sanitizeGeminiParameters(innerSchema, visited)
      }
      // Otherwise, the default is on a regular type, which is allowed.
      // We recurse on the inner type and then re-apply the default.
      return sanitizeGeminiParameters(innerSchema, visited).default(schema._def.defaultValue())
    }

    if (schema instanceof z.ZodOptional) {
      return z.optional(sanitizeGeminiParameters(schema.unwrap(), visited))
    }

    if (schema instanceof z.ZodObject) {
      const newShape: Record<string, z.ZodTypeAny> = {}
      for (const [key, value] of Object.entries(schema.shape)) {
        newShape[key] = sanitizeGeminiParameters(value as z.ZodTypeAny, visited)
      }
      return z.object(newShape)
    }

    if (schema instanceof z.ZodArray) {
      return z.array(sanitizeGeminiParameters(schema.element, visited))
    }

    if (schema instanceof z.ZodUnion) {
      // This schema corresponds to `anyOf` in JSON Schema.
      // We recursively sanitize each option in the union.
      const sanitizedOptions = schema.options.map((option: z.ZodTypeAny) => sanitizeGeminiParameters(option, visited))
      return z.union(sanitizedOptions as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    }

    if (schema instanceof z.ZodString) {
      const newSchema = z.string({ description: schema.description })
      const safeChecks = ["min", "max", "length", "regex", "startsWith", "endsWith", "includes", "trim"]
      // rome-ignore lint/suspicious/noExplicitAny: <explanation>
      ;(newSchema._def as any).checks = (schema._def as z.ZodStringDef).checks.filter((check) =>
        safeChecks.includes(check.kind),
      )
      return newSchema
    }

    return schema
  }

  function optionalToNullable(schema: z.ZodTypeAny): z.ZodTypeAny {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape
      const newShape: Record<string, z.ZodTypeAny> = {}

      for (const [key, value] of Object.entries(shape)) {
        const zodValue = value as z.ZodTypeAny
        if (zodValue instanceof z.ZodOptional) {
          newShape[key] = zodValue.unwrap().nullable()
        } else {
          newShape[key] = optionalToNullable(zodValue)
        }
      }

      return z.object(newShape)
    }

    if (schema instanceof z.ZodArray) {
      return z.array(optionalToNullable(schema.element))
    }

    if (schema instanceof z.ZodUnion) {
      return z.union(
        schema.options.map((option: z.ZodTypeAny) => optionalToNullable(option)) as [
          z.ZodTypeAny,
          z.ZodTypeAny,
          ...z.ZodTypeAny[],
        ],
      )
    }

    return schema
  }
}
