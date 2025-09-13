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
import { InvalidTool } from "./invalid"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"

export namespace ToolRegistry {
  // Built-in tools that ship with opencode
  const BUILTIN = [
    InvalidTool,
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

  // Extra tools registered at runtime (via plugins)
  const EXTRA: Tool.Info[] = []

  // Tools registered via HTTP callback (via SDK/API)
  const HTTP: Tool.Info[] = []

  export type HttpParamSpec = {
    type: "string" | "number" | "boolean" | "array"
    description?: string
    optional?: boolean
    items?: "string" | "number" | "boolean"
  }
  export type HttpToolRegistration = {
    id: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, HttpParamSpec>
    }
    callbackUrl: string
    headers?: Record<string, string>
  }

  function buildZodFromHttpSpec(spec: HttpToolRegistration["parameters"]) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [key, val] of Object.entries(spec.properties)) {
      let base: z.ZodTypeAny
      switch (val.type) {
        case "string":
          base = z.string()
          break
        case "number":
          base = z.number()
          break
        case "boolean":
          base = z.boolean()
          break
        case "array":
          if (!val.items) throw new Error(`array spec for ${key} requires 'items'`)
          base = z.array(val.items === "string" ? z.string() : val.items === "number" ? z.number() : z.boolean())
          break
        default:
          base = z.any()
      }
      if (val.description) base = base.describe(val.description)
      shape[key] = val.optional ? base.optional() : base
    }
    return z.object(shape)
  }

  export function register(tool: Tool.Info) {
    // Prevent duplicates by id (replace existing)
    const idx = EXTRA.findIndex((t) => t.id === tool.id)
    if (idx >= 0) EXTRA.splice(idx, 1, tool)
    else EXTRA.push(tool)
  }

  export function registerHTTP(input: HttpToolRegistration) {
    const parameters = buildZodFromHttpSpec(input.parameters)
    const info = Tool.define(input.id, {
      description: input.description,
      parameters,
      async execute(args) {
        const res = await fetch(input.callbackUrl, {
          method: "POST",
          headers: { "content-type": "application/json", ...(input.headers ?? {}) },
          body: JSON.stringify({ args }),
        })
        if (!res.ok) {
          throw new Error(`HTTP tool callback failed: ${res.status} ${await res.text()}`)
        }
        const json = (await res.json()) as { title?: string; output: string; metadata?: Record<string, any> }
        return {
          title: json.title ?? input.id,
          output: json.output ?? "",
          metadata: (json.metadata ?? {}) as any,
        }
      },
    })
    const idx = HTTP.findIndex((t) => t.id === info.id)
    if (idx >= 0) HTTP.splice(idx, 1, info)
    else HTTP.push(info)
  }

  function allTools(): Tool.Info[] {
    return [...BUILTIN, ...EXTRA, ...HTTP]
  }

  export function ids() {
    return allTools().map((t) => t.id)
  }

  export async function tools(providerID: string, _modelID: string) {
    const result = await Promise.all(
      allTools().map(async (t) => ({
        id: t.id,
        ...(await t.init()),
      })),
    )

    if (providerID === "openai") {
      return result.map((t) => ({
        ...t,
        parameters: optionalToNullable(t.parameters as unknown as z.ZodTypeAny),
      }))
    }

    if (providerID === "azure") {
      return result.map((t) => ({
        ...t,
        parameters: optionalToNullable(t.parameters as unknown as z.ZodTypeAny),
      }))
    }

    if (providerID === "google") {
      return result.map((t) => ({
        ...t,
        parameters: sanitizeGeminiParameters(t.parameters as unknown as z.ZodTypeAny),
      }))
    }

    return result
  }

  export async function enabled(
    _providerID: string,
    _modelID: string,
    agent: Agent.Info,
  ): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {}
    result["patch"] = false

    if (agent.permission.edit === "deny") {
      result["edit"] = false
      result["patch"] = false
      result["write"] = false
    }
    if (agent.permission.bash["*"] === "deny" && Object.keys(agent.permission.bash).length === 1) {
      result["bash"] = false
    }
    if (agent.permission.webfetch === "deny") {
      result["webfetch"] = false
    }

    return result
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
