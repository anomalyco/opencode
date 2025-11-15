import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ListTool } from "./ls"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { AddTaskTool } from "./add-task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { AddDirTool } from "./add-dir"
import { RunCompactTool } from "./run-compact"
import { LspDiagnosticTool } from "./lsp-diagnostics"
import { LspHoverTool } from "./lsp-hover"
import { SwitchModeTool } from "./switch-mode"
import { CompleteTaskTool } from "./complete-task"
import { ClaudeCodeBashTool } from "./cc-bash"
import { ClaudeCodeEditTool } from "./cc-edit"
import { ClaudeCodeReadTool } from "./cc-read"
import { ClaudeCodeWriteTool } from "./cc-write"
import { ClaudeCodeListTool } from "./cc-list"
import { ClaudeCodeGlobTool } from "./cc-glob"
import { ClaudeCodeGrepTool } from "./cc-grep"
import { ClaudeCodeWebFetchTool } from "./cc-webfetch"
import { ClaudeCodeComputerUseTool } from "./cc-computer-use"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { Log } from "../util/log"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool-registry" })

  function isAnthropicProvider(providerID?: string, modelID?: string) {
    const provider = providerID?.toLowerCase() ?? ""
    const model = modelID?.toLowerCase() ?? ""
    if (provider.includes("anthropic")) return true
    if (model.includes("anthropic")) return true
    if (model.includes("claude")) return true
    return false
  }

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("tool/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
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
        if (!validateToolDefinition(id, def)) {
          log.warn("skipping invalid plugin tool", { id })
          continue
        }
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function validateToolDefinition(id: string, def: ToolDefinition): boolean {
    if (!def) {
      log.warn("tool definition is null or undefined", { id })
      return false
    }
    if (!def.description || typeof def.description !== "string") {
      log.warn("tool missing or invalid description", { id })
      return false
    }
    if (!def.args || typeof def.args !== "object") {
      log.warn("tool missing or invalid args", { id })
      return false
    }
    if (typeof def.execute !== "function") {
      log.warn("tool missing or invalid execute function", { id })
      return false
    }
    return true
  }

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async () => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          try {
            const result = await def.execute(args as any, ctx)
            return {
              title: def.description.split(".")[0] || id,
              output: result,
              metadata: {},
            }
          } catch (error) {
            log.error("tool execution failed", {
              tool: id,
              error: error instanceof Error ? error.message : String(error),
            })
            return {
              title: `Error in ${id}`,
              output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              metadata: { error: true },
            }
          }
        },
      }),
    }
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

  export type RendererInfo = {
    name: string
    container?: "block" | "inline"
    render: (props: Tool.RenderProps<any>) => JSX.Element
  }

  async function all(providerID: string, modelID: string): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()
    const anthropicConfig = config.anthropic ?? {}

    // Build list of Claude Code tools based on config
    const ccTools: Tool.Info[] = []
    if (isAnthropicProvider(providerID, modelID)) {
      if (anthropicConfig.codeExecutionTool !== false) ccTools.push(ClaudeCodeBashTool)
      if (anthropicConfig.textEditorTool !== false) {
        ccTools.push(ClaudeCodeEditTool)
        ccTools.push(ClaudeCodeReadTool)
        ccTools.push(ClaudeCodeWriteTool)
        ccTools.push(ClaudeCodeListTool)
      }
      if (anthropicConfig.webFetchTool !== false) ccTools.push(ClaudeCodeWebFetchTool)
      if (anthropicConfig.computerUseTool === true) ccTools.push(ClaudeCodeComputerUseTool)
      // Add glob and grep as they're useful for file discovery
      ccTools.push(ClaudeCodeGlobTool)
      ccTools.push(ClaudeCodeGrepTool)
    }

    return [
      InvalidTool,
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      ListTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      AddTaskTool,
      SwitchModeTool,
      CompleteTaskTool,
      AddDirTool,
      RunCompactTool,
      LspDiagnosticTool,
      LspHoverTool,
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...ccTools,
      ...(Flag.OPENCODE_EXPERIMENTAL_EXA ? [WebSearchTool, CodeSearchTool] : []),
      ...custom,
    ]
  }

  export async function ids(providerID: string, modelID: string) {
    return all(providerID, modelID).then((x) => x.map((t) => t.id))
  }

  export async function tools(providerID: string, modelID: string) {
    const tools = await all(providerID, modelID)
    const result = await Promise.all(
      tools.map(async (t) => ({
        id: t.id,
        ...(await t.init()),
      })),
    )
    return result
  }

  export async function enabled(
    providerID: string,
    modelID: string,
    agent: Agent.Info,
  ): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {}

    if (!isAnthropicProvider(providerID, modelID)) {
      result["cc_bash"] = false
      result["cc_edit"] = false
      result["cc_read"] = false
      result["cc_write"] = false
      result["cc_list"] = false
      result["cc_glob"] = false
      result["cc_grep"] = false
      result["cc_webfetch"] = false
      result["cc_computer_use"] = false
    }

    if (agent.permission.edit === "deny") {
      result["edit"] = false
      result["write"] = false
      result["cc_edit"] = false
      result["cc_write"] = false
    }
    if (agent.permission.bash["*"] === "deny" && Object.keys(agent.permission.bash).length === 1) {
      result["bash"] = false
      result["cc_bash"] = false
    }
    if (agent.permission.webfetch === "deny") {
      result["webfetch"] = false
      result["cc_webfetch"] = false
    }

    return result
  }
}
