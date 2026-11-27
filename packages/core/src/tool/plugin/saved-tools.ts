export * as SavedToolsPlugin from "./saved-tools.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { CodeMode } from "@opencode/codemode"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Result, Semaphore, Stream } from "effect"
import { Agent } from "../../agent.js"
import { CodeModeSavedTools } from "../../codemode/saved-tools.js"
import { CodeModeTool } from "../../codemode/tool.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { Tool } from "../../tool.js"

type Loaded = { readonly saved: CodeModeSavedTools.Saved; readonly program: CodeModeSavedTools.Program }

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
    // `loaded` is what the transform registers; `taken` holds the tool paths registered before it, which saved tools
    // may not use.
    const state = { loaded: [] as ReadonlyArray<Loaded>, taken: new Set<string>() }

    const load = Effect.gen(function* () {
      state.loaded = (yield* store.list(projectID)).flatMap((saved) => {
        const program = CodeModeSavedTools.program(saved.code)
        return Result.isSuccess(program) ? [{ saved, program: program.success }] : []
      })
    })
    // One reload at a time, so a slower list can't replace a newer one.
    const lock = Semaphore.makeUnsafe(1)
    const refresh = lock.withPermit(load.pipe(Effect.andThen(ctx.tool.reload())))
    yield* load

    yield* store.changes.pipe(
      Stream.filter((scope) => scope === CodeModeSavedTools.GLOBAL || scope === projectID),
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )

    const taken = (name: string) => {
      const path = `${CodeModeSavedTools.NAMESPACE}.${name}`
      return Array.from(state.taken).some((item) => item === path || item.startsWith(`${path}.`))
    }

    const run = (loaded: Loaded, input: unknown, context: Tool.Context) =>
      Effect.gen(function* () {
        const depth = yield* CodeModeSavedTools.Depth
        if (depth >= CodeModeSavedTools.MAX_DEPTH)
          return yield* new ToolFailure({
            message: `Saved tools can call saved tools at most ${CodeModeSavedTools.MAX_DEPTH} deep.`,
          })
        const session = yield* sessions.get(context.sessionID).pipe(Effect.orDie)
        const agent = yield* agents.select(context.agent)
        // The caller's permissions: a saved tool can do no more than the script that calls it.
        const policy = Permission.Policy.fromRules(agent.info?.permissions ?? [], session.permissions ?? [])
        const result = yield* tools
          .check({
            code: loaded.program.code,
            tools: loaded.program.tools,
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
          .pipe(Effect.provideService(CodeModeSavedTools.Depth, depth + 1))
        if (!result.ok)
          return yield* new ToolFailure({ message: [result.error.message, ...(result.logs ?? [])].join("\n") })
        // A run that returns nothing gives null, since a tool's output is JSON.
        return { output: result.value ?? null }
      })

    yield* registry.register({
      define: (input) =>
        Effect.gen(function* () {
          if (taken(input.name))
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
          // The next step sees the tool even before the change reaches this Location's subscription.
          yield* refresh
        }),
      remove: (name) =>
        store
          .remove([projectID, CodeModeSavedTools.GLOBAL], name)
          .pipe(Effect.tap((removed) => (removed ? refresh : Effect.void))),
    })

    yield* ctx.tool
      .transform((editor) => {
        state.taken = new Set(editor.list().map(CodeModeTool.qualifiedName))
        for (const loaded of state.loaded) {
          if (taken(loaded.saved.name)) continue
          editor.add({
            name: loaded.saved.name,
            description: loaded.saved.description,
            input: loaded.saved.input,
            // Without a schema the tool may return any value, which the script gets as it is.
            output: loaded.saved.output ?? {},
            options: { namespace: CodeModeSavedTools.NAMESPACE, codemode: true },
            execute: (input: unknown, context) => run(loaded, input, context),
          })
        }
      })
      .pipe(Effect.orDie)
  }),
}
