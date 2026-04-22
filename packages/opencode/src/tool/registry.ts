import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Glob } from "@opencode-ai/shared/util/glob"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Agent } from "../agent/agent"
import { Bus } from "../bus"
import { Config } from "../config"
import { FileTime } from "../file/time"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { LSP } from "../lsp"
import { Plugin } from "../plugin"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { Question } from "../question"
import { Session } from "../session"
import { Instruction } from "../session/instruction"
import { Todo } from "../session/todo"
import { Skill } from "../skill"
import { Storage } from "../storage/storage"
import { Flag } from "@/flag/flag"
import { InstanceState } from "@/effect"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { Permission } from "@/permission"
import { Log } from "@/util"
import { BashTool } from "./bash"
import { CompressTool } from "./compress"
import { InvalidTool } from "./invalid"
import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { DiscoverBatchTool } from "./read/discover-batch"
import { InspectTool } from "./read/inspect"
import { LspTool } from "./read/lsp"
import { SearchTool } from "./read/search"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TaskAsyncDescription, TaskAsyncTool } from "./task/task_async"
import { AtlasPlanFollowTool } from "./team-tools/atlas_plan_follow"
import { BugReportTool } from "./team-tools/bug_report"
import { BugReportManagementTool } from "./team-tools/bug_report_management"
import { GitCommitTool, LocalGitAnnotateTool, LocalGitLogTool, LocalGitStateTool } from "./team-tools/localgit"
import { MainPlanTool } from "./team-tools/main_plan"
import { MemoryDescription, MemoryTool } from "./team-tools/memory"
import { TodoWriteTool } from "./todo"
import * as Tool from "./tool"
import { Tool as SourceTool } from "./shared/tool"
import * as Truncate from "./truncate"
import { CodeSearchTool } from "./web/codesearch"
import { EditBatchTool } from "./edit/batch"
import { EditTool as SourceEditTool } from "./edit/index"
import { ApplyPatchTool as SourceApplyPatchTool } from "./edit/apply_patch"
import { PathEditTool } from "./edit/path_edit"
import { disabledToolIDs } from "./edit/runtime"
import { WorkspaceReplaceTool } from "./edit/workspace_replace"
import { WriteTool as SourceWriteTool } from "./edit/write"
import { LibBatchTool } from "./web/lib-batch"
import { WebFetchTool } from "./web/webfetch"
import { WebSearchTool } from "./web/websearch"

const log = Log.create({ service: "tool.registry" })

type TaskDef = Tool.InferDef<typeof TaskTool>
type InspectDef = Tool.Def

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  inspect: InspectDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; inspect: InspectDef }>
  readonly tools: (model: {
    providerID: ProviderID
    modelID: ModelID
    agent: Agent.Info
    includeDisabled?: boolean
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

function adaptSource<P extends z.ZodType, M extends Record<string, unknown>>(
  info: SourceTool.Info<P, M>,
): Effect.Effect<Tool.Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* Effect.promise(() => info.init())
    return {
      id: info.id,
      description: init.description,
      parameters: init.parameters,
      formatValidationError: init.formatValidationError,
      execute: (args, ctx) =>
        Effect.promise(() =>
          init.execute(args, {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            agent: ctx.agent,
            abort: ctx.abort,
            callID: ctx.callID,
            extra: ctx.extra,
            messages: ctx.messages,
            metadata: (input) => {
              void Effect.runPromise(ctx.metadata(input))
            },
            ask: (input) => Effect.runPromise(ctx.ask(input)),
          }),
        ),
    }
  })
}

function teamToolVisible(input: { id: string; agent: Agent.Info }) {
  if (input.id === AtlasPlanFollowTool.id) return input.agent.name === "atlas" || input.agent.name === "hades"
  if (input.id === MainPlanTool.id) return input.agent.name === "niggli" || input.agent.name === "hades"
  return true
}

function teamToolDescription(input: { id: string; agent: Agent.Info }) {
  if (input.id === TaskAsyncTool.id) return TaskAsyncDescription(input.agent)
  if (input.id === MemoryTool.id) return MemoryDescription(input.agent)
  return Effect.succeed(undefined)
}

// Keep legacy fork-local tool implementations on disk so the fork can still carry
// them, but never register or expose those legacy IDs again.
const hiddenLegacyToolIDs = new Set([
  // AI AGENT POLICY: Legacy `read` is permanently hidden.
  // Do not re-enable it, re-register it, rename this block away, move it, or delete it.
  // The legacy file may stay on disk for fork safety, but it must never become visible again.
  "read",
  // AI AGENT POLICY: Legacy `glob` is permanently hidden.
  // Do not re-enable it, re-register it, rename this block away, move it, or delete it.
  // The legacy file may stay on disk for fork safety, but it must never become visible again.
  "glob",
  // AI AGENT POLICY: Legacy `grep` is permanently hidden.
  // Do not re-enable it, re-register it, rename this block away, move it, or delete it.
  // The legacy file may stay on disk for fork safety, but it must never become visible again.
  "grep",
])

// These source-native IDs are reserved for the ported tool surface.
// Custom/plugin tools and legacy re-registrations must not shadow them.
const reservedCanonicalToolIDs = new Set([
  // AI AGENT POLICY: `inspect` belongs to the source-native read family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "inspect",
  // AI AGENT POLICY: `search` belongs to the source-native read family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "search",
  // AI AGENT POLICY: `discover_batch` belongs to the source-native read family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "discover_batch",
  // AI AGENT POLICY: `lsp` belongs to the source-native read family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "lsp",
  // AI AGENT POLICY: `edit` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "edit",
  // AI AGENT POLICY: `write` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "write",
  // AI AGENT POLICY: `apply_patch` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "apply_patch",
  // AI AGENT POLICY: `path_edit` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "path_edit",
  // AI AGENT POLICY: `edit_batch` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "edit_batch",
  // AI AGENT POLICY: `workspace_replace` belongs to the source-native edit family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "workspace_replace",
  // AI AGENT POLICY: `webfetch` belongs to the source-native web family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "webfetch",
  // AI AGENT POLICY: `websearch` belongs to the source-native web family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "websearch",
  // AI AGENT POLICY: `codesearch` belongs to the source-native web family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "codesearch",
  // AI AGENT POLICY: `lib_batch` belongs to the source-native web family only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "lib_batch",
  // AI AGENT POLICY: `task_async` belongs to the source-native async orchestration surface only.
  // Do not let another implementation override, re-enable, move, or shadow this ID.
  "task_async",
])

function isVisibleToolID(id: string) {
  return !hiddenLegacyToolIDs.has(id)
}

function filterCustomTools(custom: Tool.Def[], builtin: Tool.Def[]) {
  const builtinIDs = new Set(builtin.map((tool) => tool.id))
  return custom.filter(
    (tool) => isVisibleToolID(tool.id) && !builtinIDs.has(tool.id) && !reservedCanonicalToolIDs.has(tool.id),
  )
}

export const layer: Layer.Layer<
  Service,
  never,
  | Bus.Service
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Skill.Service
  | Session.Service
  | Agent.Service
  | LSP.Service
  | FileTime.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Storage.Service
  | Provider.Service
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const plan = yield* PlanExitTool
    const bash = yield* BashTool
    const skilltool = yield* SkillTool
    const agent = yield* Agent.Service
    const inspectInfo = yield* InspectTool
    const discoverBatchInfo = yield* DiscoverBatchTool
    const taskAsyncInfo = yield* TaskAsyncTool

    const source = yield* Effect.all({
      compress: adaptSource(CompressTool),
      inspect: adaptSource(inspectInfo),
      search: adaptSource(SearchTool),
      discover_batch: adaptSource(discoverBatchInfo),
      lsp: adaptSource(LspTool),
      edit: adaptSource(SourceEditTool),
      write: adaptSource(SourceWriteTool),
      apply_patch: adaptSource(SourceApplyPatchTool),
      path_edit: adaptSource(PathEditTool),
      edit_batch: adaptSource(EditBatchTool),
      workspace_replace: adaptSource(WorkspaceReplaceTool),
      webfetch: adaptSource(WebFetchTool),
      websearch: adaptSource(WebSearchTool),
      codesearch: adaptSource(CodeSearchTool),
      lib_batch: adaptSource(LibBatchTool),
      task_async: adaptSource(taskAsyncInfo),
      "atlas-plan-follow": adaptSource(AtlasPlanFollowTool),
      "main-plan": adaptSource(MainPlanTool),
      memory: adaptSource(MemoryTool),
      bug_report: adaptSource(BugReportTool),
      bug_report_management: adaptSource(BugReportManagementTool),
      localgit_state: adaptSource(LocalGitStateTool),
      localgit_log: adaptSource(LocalGitLogTool),
      localgit_annotate: adaptSource(LocalGitAnnotateTool),
      git_commit: adaptSource(GitCommitTool),
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          return {
            id,
            parameters: z.object(def.args),
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  metadata: (input) => {
                    void Effect.runPromise(toolCtx.metadata(input))
                  },
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated ? { outputPath: out.outputPath } : {}),
                  },
                }
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
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
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

        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL
        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          bash: Tool.init(bash),
          question: Tool.init(question),
          todo: Tool.init(todo),
          task: Tool.init(task),
          skill: Tool.init(skilltool),
          plan: Tool.init(plan),
        })

        const builtin = [
          tool.invalid,
          ...(questionEnabled ? [tool.question] : []),
          tool.bash,
          source.compress,
          source.inspect,
          source.search,
          source.discover_batch,
          source.lsp,
          source.edit,
          source.write,
          source.path_edit,
          source.apply_patch,
          source.edit_batch,
          source.workspace_replace,
          source.webfetch,
          source.websearch,
          source.codesearch,
          source.lib_batch,
          tool.task,
          source.task_async,
          tool.todo,
          tool.skill,
          source["atlas-plan-follow"],
          source["main-plan"],
          source.memory,
          source.bug_report,
          source.bug_report_management,
          source.localgit_state,
          source.localgit_log,
          source.localgit_annotate,
          source.git_commit,
          ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []),
        ]

        return {
          custom: filterCustomTools(custom, builtin),
          builtin,
          task: tool.task,
          inspect: source.inspect,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom].filter((tool) => isVisibleToolID(tool.id))
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
      return list.length
        ? [
            "Use this tool to delegate work to another agent.",
            "",
            "Available subagents:",
            ...list.map((item) => `- \`${item.name}\`: ${item.description ?? "No description provided."}`),
          ].join("\n")
        : "No subagents are currently available."
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const list = (yield* all()).filter((tool) => {
        if (!teamToolVisible({ id: tool.id, agent: input.agent })) return false
        if ([CodeSearchTool.id, WebSearchTool.id].includes(tool.id)) {
          return input.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
        }
        return true
      })
      const off = disabledToolIDs(
        list.map((tool) => tool.id),
        input.agent.permission,
      )
      const filtered = input.includeDisabled ? list : list.filter((tool) => !off.has(tool.id))

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const dynamic = yield* teamToolDescription({ id: tool.id, agent: input.agent })
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
              dynamic,
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
      return { task: s.task, inspect: s.inspect }
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
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
  ),
)
