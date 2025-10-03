import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { ExitSpecModeTool } from "./exitspecmode"
import { FetchUrlTool } from "./fetchurl"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ListTool } from "./ls"
import { LspDiagnosticTool } from "./lsp-diagnostics"
import { LspHoverTool } from "./lsp-hover"
import { MultiEditTool } from "./multiedit"
import { PatchTool } from "./patch"
import { ReadTool } from "./read"
import { SpecModeTool } from "./specmode"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolDefinition, type ToolContext as PluginToolContext } from "@opencode-ai/plugin"
import z from "zod/v4"
import { Plugin } from "../plugin"

export namespace ToolRegistry {
  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("tool/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({ cwd: dir, absolute: true, followSymlinks: true, dot: true })) {
        const namespace = path.basename(match, path.extname(match))
        const mod = await import(match)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    const parameters = z.object(def.args)
    return {
      id,
      init: async () => ({
        parameters,
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx: PluginToolContext = {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            agent: ctx.agent,
            abort: ctx.abort,
          }
          const result = await def.execute(args as z.infer<typeof parameters>, pluginCtx)
          const normalized = pluginResult(result)
          return {
            title: normalized.title ?? "",
            output: normalized.output,
            metadata: normalized.metadata ?? {},
          }
        },
      }),
    }
  }

  function pluginResult(value: unknown): {
    output: string
    title?: string
    metadata?: Record<string, unknown>
  } {
    if (typeof value === "string") {
      return { output: value }
    }
    if (!value || typeof value !== "object") {
      return { output: String(value ?? "") }
    }
    const record = value as {
      output?: unknown
      title?: unknown
      metadata?: unknown
    }
    if (typeof record.output === "string") {
      const metadata = isRecord(record.metadata) ? record.metadata : undefined
      const title = typeof record.title === "string" ? record.title : undefined
      return {
        output: record.output,
        title,
        metadata,
      }
    }
    return { output: JSON.stringify(value) }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    if (!value) return false
    if (typeof value !== "object") return false
    if (Array.isArray(value)) return false
    return true
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    return [
      InvalidTool,
      BashTool,
      EditTool,
      MultiEditTool,
      SpecModeTool,
      ExitSpecModeTool,
      FetchUrlTool,
      WebSearchTool,
      GlobTool,
      GrepTool,
      ListTool,
      LspDiagnosticTool,
      LspHoverTool,
      PatchTool,
      ReadTool,
      WriteTool,
      TodoWriteTool,
      TodoReadTool,
      TaskTool,
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(_providerID: string, _modelID: string) {
    const tools = await all()
    const result = await Promise.all(
      tools.map(async (t) => ({
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
    if (agent.permission.fetchurl === "deny") {
      result["fetchurl"] = false
    }
    if (agent.permission.websearch === "deny") {
      result["websearch"] = false
    }

    return result
  }
}
