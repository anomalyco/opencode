import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"

import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { PermissionNext } from "@/permission/next"
import { Global } from "@/global"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    return {
      custom: [] as Tool.Info[],
      loaded: false,
      loading: undefined as Promise<void> | undefined,
    }
  })

  function project(dir: string) {
    const root = path.resolve(Instance.worktree)
    const cur = path.resolve(dir)
    if (!dir.endsWith(".opencode")) return false
    if (!cur.startsWith(root + path.sep)) return false
    if (dir === Flag.OPENCODE_CONFIG_DIR) return false
    if (dir === Global.Path.config) return false
    return cur !== path.join(Global.Path.home, ".opencode")
  }

  async function load(sessionID?: string) {
    const s = await state()
    if (s.loaded) return
    if (s.loading) return s.loading

    s.loading = Config.directories()
      .then((dirs) =>
        dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }).map(
            (file) => ({
              dir,
              file,
            }),
          ),
        ),
      )
      .then(async (entries) => {
        if (entries.length) await Config.waitForDependencies()
        const gate = new Map<string, boolean>()

        for (const item of entries) {
          if (project(item.dir)) {
            const ok = gate.get(item.dir)
            if (ok === false) continue
            if (ok !== true) {
              if (!sessionID) {
                log.warn("skipping project custom tools", {
                  path: item.dir,
                  reason: "no active session for permission prompt",
                })
                gate.set(item.dir, false)
                continue
              }
              const err = await PermissionNext.ask({
                permission: ".opencode",
                patterns: [item.dir],
                always: [item.dir],
                sessionID,
                metadata: {
                  path: item.dir,
                  file: item.file,
                },
                ruleset: [],
              }).catch((x) => x)
              if (err instanceof Error) {
                log.warn("project custom tools denied", { path: item.dir })
                gate.set(item.dir, false)
                continue
              }
              gate.set(item.dir, true)
            }
          }

          const namespace = path.basename(item.file, path.extname(item.file))
          const mod = await import(pathToFileURL(item.file).href)
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            s.custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = await Plugin.list()
        for (const plugin of plugins) {
          for (const [id, def] of Object.entries(plugin.tool ?? {})) {
            s.custom.push(fromPlugin(id, def))
          }
        }
        s.loaded = true
      })
      .finally(() => {
        s.loading = undefined
      })

    return s.loading
  }

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          const result = await def.execute(args as any, pluginCtx)
          const out = await Truncate.output(result, {}, initCtx?.agent)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    await load()
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(sessionID?: string): Promise<Tool.Info[]> {
    await load(sessionID)
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()
    const question = ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

    return [
      InvalidTool,
      ...(question ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      // TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool] : []),
      ...custom,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
    sessionID?: string,
  ) {
    const tools = await all(sessionID)
    const result = await Promise.all(
      tools
        .filter((t) => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA
          }

          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          const tool = await t.init({ agent })
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          await Plugin.trigger("tool.definition", { toolID: t.id }, output)
          return {
            id: t.id,
            ...tool,
            description: output.description,
            parameters: output.parameters,
          }
        }),
    )
    return result
  }
}
