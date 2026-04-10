import { PlanExitTool } from "./plan"
import { Session } from "../session"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import { Tool } from "./tool"
import { Config } from "../config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "../provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "../util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Env } from "../env"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "../filesystem"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type TaskDef = Tool.InferDef<typeof TaskTool>
  type ReadDef = Tool.InferDef<typeof ReadTool>

  type State = {
    custom: Tool.Def[]
    builtin: Tool.Def[]
    task: TaskDef
    read: ReadDef
  }

  export interface Interface {
    readonly ids: () => Effect.Effect<string[]>
    readonly all: () => Effect.Effect<Tool.Def[]>
    readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
    readonly tools: (model: {
      providerID: ProviderID
      modelID: ModelID
      agent: Agent.Info
    }) => Effect.Effect<Tool.Def[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Config.Service
    | Plugin.Service
    | Question.Service
    | Todo.Service
    | Agent.Service
    | Skill.Service
    | Session.Service
    | Provider.Service
    | LSP.Service
    | FileTime.Service
    | Instruction.Service
    | AppFileSystem.Service
    | HttpClient.HttpClient
    | ChildProcessSpawner
    | Ripgrep.Service
    | Format.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service
      const agents = yield* Agent.Service
      const skill = yield* Skill.Service

      const task = yield* TaskTool
      const read = yield* ReadTool
      const question = yield* QuestionTool
      const todo = yield* TodoWriteTool
      const lsptool = yield* LspTool
      const plan = yield* PlanExitTool
      const webfetch = yield* WebFetchTool
      const websearch = yield* WebSearchTool
      const bash = yield* BashTool
      const codesearch = yield* CodeSearchTool
      const globtool = yield* GlobTool
      const writetool = yield* WriteTool
      const edit = yield* EditTool
      const greptool = yield* GrepTool
      const patchtool = yield* ApplyPatchTool
      const skilltool = yield* SkillTool

      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* (ctx) {
          const custom: Tool.Def[] = []

          function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
            return {
              id,
              parameters: z.object(def.args),
              description: def.description,
              execute: async (args, toolCtx) => {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = await def.execute(args as any, pluginCtx)
                const out = await Truncate.output(result, {}, await Agent.get(toolCtx.agent))
                return {
                  title: "",
                  output: out.truncated ? out.content : result,
                  metadata: {
                    truncated: out.truncated,
                    outputPath: out.truncated ? out.outputPath : undefined,
                  },
                }
              },
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

          const cfg = yield* config.get()
          const questionEnabled =
            ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

          const tool = yield* Effect.all({
            invalid: Tool.init(InvalidTool),
            bash: Tool.init(bash),
            read: Tool.init(read),
            glob: Tool.init(globtool),
            grep: Tool.init(greptool),
            edit: Tool.init(edit),
            write: Tool.init(writetool),
            task: Tool.init(task),
            fetch: Tool.init(webfetch),
            todo: Tool.init(todo),
            search: Tool.init(websearch),
            code: Tool.init(codesearch),
            skill: Tool.init(skilltool),
            patch: Tool.init(patchtool),
            question: Tool.init(question),
            lsp: Tool.init(lsptool),
            plan: Tool.init(plan),
          })

          return {
            custom,
            builtin: [
              tool.invalid,
              ...(questionEnabled ? [tool.question] : []),
              tool.bash,
              tool.read,
              tool.glob,
              tool.grep,
              tool.edit,
              tool.write,
              tool.task,
              tool.fetch,
              tool.todo,
              tool.search,
              tool.code,
              tool.skill,
              tool.patch,
              ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
              ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),
            ],
            task: tool.task,
            read: tool.read,
          }
        }),
      )

      const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
        const s = yield* InstanceState.get(state)
        return [...s.builtin, ...s.custom] as Tool.Def[]
      })

      const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
        return (yield* all()).map((tool) => tool.id)
      })

      const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
        const list = yield* skill.available(agent)
        if (list.length === 0) return "No skills are currently available."
        return [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          Skill.fmt(list, { verbose: false }),
        ].join("\n")
      })

      const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
        const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
        const filtered = items.filter(
          (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
        )
        const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
        const description = list
          .map(
            (item) =>
              `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
          )
          .join("\n")
        return ["Available agent types and the tools they have access to:", description].join("\n")
      })

      const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
        const filtered = (yield* all()).filter((tool) => {
          if (tool.id === CodeSearchTool.id || tool.id === WebSearchTool.id) {
            return input.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
          }

          const usePatch =
            !!Env.get("OPENCODE_E2E_LLM_URL") ||
            (input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4"))
          if (tool.id === ApplyPatchTool.id) return usePatch
          if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

          return true
        })

        return yield* Effect.forEach(
          filtered,
          Effect.fnUntraced(function* (tool: Tool.Def) {
            using _ = log.time(tool.id)
            const output = {
              description: tool.description,
              parameters: tool.parameters,
            }
            yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
            return {
              id: tool.id,
              description: [
                output.description,
                tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
                tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
              ]
                .filter(Boolean)
                .join("\n"),
              parameters: output.parameters,
              execute: tool.execute,
              formatValidationError: tool.formatValidationError,
            }
          }),
          { concurrency: "unbounded" },
        )
      })

      const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
        const s = yield* InstanceState.get(state)
        return { task: s.task, read: s.read }
      })

      return Service.of({ ids, all, named, tools })
    }),
  )

  export const defaultLayer = Layer.suspend(() =>
    layer.pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(FileTime.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(Ripgrep.defaultLayer),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function tools(input: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
  }): Promise<(Tool.Def & { id: string })[]> {
    return runPromise((svc) => svc.tools(input))
  }
}
