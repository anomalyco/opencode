import z from "zod/v4"
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

  export async function tools(_providerID: string, _modelID: string) {
    const result = await Promise.all(
      allTools().map(async (t) => ({
        id: t.id,
        ...(await t.init()),
      })),
    )
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
}
