export * as SavedToolsPlugin from "./saved-tools.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { CodeMode } from "@opencode/codemode"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Context as EffectContext, Effect, Result, Stream } from "effect"
import { Agent } from "../../agent.js"
import { CodeModeSavedTools } from "../../codemode/saved-tools.js"
import { CodeModeTool } from "../../codemode/tool.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { Tool } from "../../tool.js"

/** How many saved tools are running inside each other here; see `CodeModeSavedTools.MAX_DEPTH`. */
const Depth = EffectContext.Reference<number>("@opencode/SavedToolsPlugin/Depth", { defaultValue: () => 0 })

export const Plugin = {
  id: "opencode.tool.saved-tools",
  effect: Effect.fn("SavedToolsPlugin")(function* (ctx: Context) {
    if (!(yield* Flag.enabled("codemode_tools"))) return
    const store = yield* CodeModeSavedTools.Store
    const registry = yield* CodeModeSavedTools.Service
    const tools = yield* Tool.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const services = yield* CodeModeTool.services
    const projectID = ctx.location.project.id
    const state = { saved: yield* store.list(projectID) }

    yield* store.changes.pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          state.saved = yield* store.list(projectID)
          yield* ctx.tool.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    const run = (saved: CodeModeSavedTools.Saved, input: unknown, context: Tool.Context) =>
      Effect.gen(function* () {
        const depth = yield* Depth
        if (depth >= CodeModeSavedTools.MAX_DEPTH)
          return yield* new ToolFailure({
            message: `Saved tools can call saved tools at most ${CodeModeSavedTools.MAX_DEPTH} deep.`,
          })
        const program = CodeModeSavedTools.program(saved.code)
        if (Result.isFailure(program)) return yield* new ToolFailure({ message: program.failure })
        const session = yield* sessions.get(context.sessionID).pipe(Effect.orDie)
        const agent = yield* agents.select(context.agent)
        // The caller's permissions: a saved tool can do no more than the script that calls it.
        const policy = Permission.Policy.fromRules(agent.info?.permissions ?? [], session.permissions ?? [])
        const result = yield* tools
          .check({
            code: program.success.code,
            tools: program.success.tools,
            // Tool inputs arrive as parsed JSON.
            bindings: { input: input as CodeMode.DataValue },
            policy,
            limits: {},
            services,
            context: {
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              progress: () => Effect.void,
            },
          })
          .pipe(Effect.provideService(Depth, depth + 1))
        if (!result.ok)
          return yield* new ToolFailure({
            message: [result.error.message, ...(result.logs ?? [])].join("\n"),
          })
        return { output: result.value }
      })

    const builtIn = (name: string) => {
      const path = `${CodeModeSavedTools.NAMESPACE}.${name}`
      return Effect.map(tools.list(), (list) =>
        list.some((tool) => {
          if (
            state.saved.some(
              (saved) => saved.name === tool.name && tool.options?.namespace === CodeModeSavedTools.NAMESPACE,
            )
          )
            return false
          const qualified = CodeModeTool.qualifiedName(tool)
          return qualified === path || qualified.startsWith(`${path}.`)
        }),
      )
    }

    yield* registry.register({
      define: (input) =>
        Effect.gen(function* () {
          if (yield* builtIn(input.name))
            return yield* Effect.fail(
              new Error(`tools.${CodeModeSavedTools.NAMESPACE}.${input.name} is a built-in tool; pick another name.`),
            )
          yield* store.save({
            scope: input.global ? CodeModeSavedTools.GLOBAL : projectID,
            name: input.name,
            description: input.description,
            input: input.input,
            ...(input.output === undefined ? {} : { output: input.output }),
            code: input.code,
          })
          return `${CodeModeSavedTools.NAMESPACE}.${input.name}`
        }),
      remove: (name) => store.remove([projectID, CodeModeSavedTools.GLOBAL], name),
    })

    yield* ctx.tool
      .transform((editor) => {
        const taken = new Set(editor.list().map((tool) => CodeModeTool.qualifiedName(tool)))
        for (const saved of state.saved) {
          const path = `${CodeModeSavedTools.NAMESPACE}.${saved.name}`
          if (taken.has(path) || [...taken].some((item) => item.startsWith(`${path}.`))) continue
          editor.add({
            name: saved.name,
            description: saved.description,
            input: saved.input,
            // Without a schema the tool may return any value, which the script gets as it is.
            output: saved.output ?? {},
            options: { namespace: CodeModeSavedTools.NAMESPACE, codemode: true },
            execute: (input: unknown, context) => run(saved, input, context),
          })
        }
      })
      .pipe(Effect.orDie)
  }),
}
