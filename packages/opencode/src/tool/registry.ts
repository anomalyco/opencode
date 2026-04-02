import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type State = {
    custom: Tool.Info[]
  }

  export interface Interface {
    readonly register: (tool: Tool.Info) => Effect.Effect<void>
    readonly ids: () => Effect.Effect<string[]>
    readonly tools: (
      model: { providerID: ProviderID; modelID: ModelID },
      agent?: Agent.Info,
    ) => Effect.Effect<(Tool.Def & { id: string })[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer: Layer.Layer<Service, never, Config.Service | Plugin.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* (ctx) {
          const custom: Tool.Info[] = []

          function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
            return {
              id,
              init: async (initCtx) => ({
                parameters: z.object(def.args),
                description: def.description,
                execute: async (args, toolCtx) => {
                  const pluginCtx = {
                    ...toolCtx,
                    directory: ctx.directory,
                    worktree: ctx.worktree,
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

          const dirs = yield* config.directories()
          const matches = dirs.flatMap((dir) =>
            Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
          )
          if (matches.length) yield* config.waitForDependencies()
          for (const match of matches) {
            const namespace = path.basename(match, path.extname(match))
            const mod = yield* Effect.promise(
              () => import(process.platform === "win32" ? match : pathToFileURL(match).href),
            )
            for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
              custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
            }
          }

          const plugins = yield* plugin.list()
          for (const p of plugins) {
            for (const [id, def] of Object.entries(p.tool ?? {})) {
              custom.push(fromPlugin(id, def))
            }
          }

          return { custom }
        }),
      )

      const all = Effect.fn("ToolRegistry.all")(function* (custom: Tool.Info[]) {
        const cfg = yield* config.get()
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
          WebSearchTool,
          CodeSearchTool,
          SkillTool,
          ApplyPatchTool,
          ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
          ...(cfg.experimental?.batch_tool === true ? [BatchTool] : []),
          ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [PlanExitTool] : []),
          ...custom,
        ]
      })

      const register = Effect.fn("ToolRegistry.register")(function* (tool: Tool.Info) {
        const s = yield* InstanceState.get(state)
        const idx = s.custom.findIndex((t) => t.id === tool.id)
        if (idx >= 0) {
          s.custom.splice(idx, 1, tool)
          return
        }
        s.custom.push(tool)
      })

      const ids = Effect.fn("ToolRegistry.ids")(function* () {
        const s = yield* InstanceState.get(state)
        const tools = yield* all(s.custom)
        return tools.map((t) => t.id)
      })

      const tools = Effect.fn("ToolRegistry.tools")(function* (
        model: { providerID: ProviderID; modelID: ModelID },
        agent?: Agent.Info,
      ) {
        const s = yield* InstanceState.get(state)
        const allTools = yield* all(s.custom)
        const filtered = allTools.filter((tool) => {
          if (tool.id === "codesearch" || tool.id === "websearch") {
            return model.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
          }

          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (tool.id === "apply_patch") return usePatch
          if (tool.id === "edit" || tool.id === "write") return !usePatch

          return true
        })
        return yield* Effect.forEach(
          filtered,
          Effect.fnUntraced(function* (tool: Tool.Info) {
            using _ = log.time(tool.id)
            const next = yield* Effect.promise(() => tool.init({ agent }))
            const output = {
              description: next.description,
              parameters: next.parameters,
            }
            yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
            return {
              id: tool.id,
              description: output.description,
              parameters: output.parameters,
              execute: next.execute,
              formatValidationError: next.formatValidationError,
            }
          }),
          { concurrency: "unbounded" },
        )
      })

      return Service.of({ register, ids, tools })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() => layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Plugin.defaultLayer))),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function register(tool: Tool.Info) {
    return runPromise((svc) => svc.register(tool))
  }

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ): Promise<(Tool.Def & { id: string })[]> {
    return runPromise((svc) => svc.tools(model, agent))
  }
}
