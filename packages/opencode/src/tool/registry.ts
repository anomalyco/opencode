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
    ) => Effect.Effect<(Awaited<ReturnType<Tool.Info["init"]>> & { id: string })[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
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

          yield* Effect.promise(async () => {
            const matches = await Config.directories().then((dirs) =>
              dirs.flatMap((dir) =>
                Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
              ),
            )
            if (matches.length) await Config.waitForDependencies()
            for (const match of matches) {
              const namespace = path.basename(match, path.extname(match))
              const mod = await import(process.platform === "win32" ? match : pathToFileURL(match).href)
              for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
                custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
              }
            }

            const plugins = await Plugin.list()
            for (const plugin of plugins) {
              for (const [id, def] of Object.entries(plugin.tool ?? {})) {
                custom.push(fromPlugin(id, def))
              }
            }
          })

          return { custom }
        }),
      )

      async function all(custom: Tool.Info[]): Promise<Tool.Info[]> {
        const cfg = await Config.get()
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
      }

      const register = Effect.fn("ToolRegistry.register")(function* (tool: Tool.Info) {
        const state = yield* InstanceState.get(cache)
        const idx = state.custom.findIndex((t) => t.id === tool.id)
        if (idx >= 0) {
          state.custom.splice(idx, 1, tool)
          return
        }
        state.custom.push(tool)
      })

      const ids = Effect.fn("ToolRegistry.ids")(function* () {
        const state = yield* InstanceState.get(cache)
        const tools = yield* Effect.promise(() => all(state.custom))
        return tools.map((t) => t.id)
      })

      const tools = Effect.fn("ToolRegistry.tools")(function* (
        model: { providerID: ProviderID; modelID: ModelID },
        agent?: Agent.Info,
      ) {
        const state = yield* InstanceState.get(cache)
        const allTools = yield* Effect.promise(() => all(state.custom))
        return yield* Effect.promise(() =>
          Promise.all(
            allTools
              .filter((tool) => {
                // Enable websearch/codesearch for zen users OR via enable flag
                if (tool.id === "codesearch" || tool.id === "websearch") {
                  return model.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
                }

                // use apply tool in same format as codex
                const usePatch =
                  model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
                if (tool.id === "apply_patch") return usePatch
                if (tool.id === "edit" || tool.id === "write") return !usePatch

                return true
              })
              .map(async (tool) => {
                using _ = log.time(tool.id)
                const next = await tool.init({ agent })
                const output = {
                  description: next.description,
                  parameters: next.parameters,
                }
                await Plugin.trigger("tool.definition", { toolID: tool.id }, output)
                return {
                  id: tool.id,
                  ...next,
                  description: output.description,
                  parameters: output.parameters,
                }
              }),
          ),
        )
      })

      return Service.of({ register, ids, tools })
    }),
  )

  const { runPromise } = makeRuntime(Service, layer)

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
  ) {
    return runPromise((svc) => svc.tools(model, agent))
  }
}
