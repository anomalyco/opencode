import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { TaskPlugin } from "@opencode/core/plugin/task"
import { TaskDiligence } from "@opencode/core/plugin/task-diligence"
import { Session } from "@opencode/core/session"
import type { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Task } from "@opencode/schema/task"
import { testEffect } from "../lib/effect"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity, toolNodeReplacements } from "../lib/tool"

const sessionID = Session.ID.make("ses_task_plugin_test")
const it = testEffect(AppNodeBuilder.build(Tool.node, toolNodeReplacements()))

const on = new ConfigExperimental.Info({ tasks: true, diligence: true })

type Hook = (event: unknown) => Effect.Effect<void, unknown>
interface Synthetic {
  readonly text: string
  readonly description?: string
  readonly metadata?: Record<string, unknown>
}

const document = (experimental: ConfigExperimental.Info | undefined): Entry =>
  new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })

/** Runs the task plugin against the real tool registry, with plugin storage in memory and every hook captured. */
const run = (
  experimental: ConfigExperimental.Info | undefined,
  options: { readonly messages?: () => ReadonlyArray<unknown>; readonly parentID?: Session.ID } = {},
) =>
  Effect.gen(function* () {
    const stored = new Map<string, Schema.Json>()
    const changed: unknown[] = []
    const rpc: { current?: RpcHandlers<typeof Task.Definition> } = {}
    const commands: CommandDefinition[] = []
    const sessionHooks = new Map<string, Hook>()
    const toolHooks = new Map<string, Hook>()
    const synthetics: Synthetic[] = []

    yield* registerToolPlugin(
      TaskPlugin.Plugin,
      {
        storage: {
          get: (key) => Effect.sync(() => stored.get(key)),
          set: (key, value) => Effect.sync(() => void stored.set(key, value)),
          remove: (key) => Effect.sync(() => void stored.delete(key)),
          scan: () => Effect.die("unused storage.scan"),
        },
        rpc: Object.assign(
          () => {
            throw new Error("unused rpc.client")
          },
          {
            // SAFETY: the task plugin registers one RPC, whose handlers and `changed` events these tests observe.
            register: ((_definition: unknown, handlers: RpcHandlers<typeof Task.Definition>) =>
              Effect.sync(() => {
                rpc.current = handlers
                return {
                  dispose: Effect.void,
                  events: { emit: (_name: string, data: unknown) => Effect.sync(() => void changed.push(data)) },
                }
              })) as never,
          },
        ),
        command: {
          list: () => Effect.die("unused command.list"),
          transform: (callback) =>
            Effect.sync(() => callback({ add: (definition) => void commands.push(definition) })) as never,
          reload: () => Effect.die("unused command.reload"),
        },
        session: {
          // SAFETY: the plugin only registers handlers; these tests call them with the events the runtime sends.
          hook: ((name: string, handler: Hook) =>
            Effect.sync(() => {
              sessionHooks.set(name, handler)
              return { dispose: Effect.void }
            })) as never,
          // SAFETY: the monitor reads only the parent of a Session.
          get: () => Effect.succeed({ id: sessionID, parentID: options.parentID } as never),
          context: () => Effect.succeed((options.messages?.() ?? []) as ReadonlyArray<SessionMessage.Info>),
          synthetic: ((input: Synthetic) => Effect.sync(() => void synthetics.push(input))) as never,
        },
        event: { subscribe: () => Stream.never },
      },
      // SAFETY: the plugin only registers handlers; these tests call them with the events the runtime sends.
      ((name: string, handler: Hook) =>
        Effect.sync(() => {
          toolHooks.set(name, handler)
          return { dispose: Effect.void }
        })) as never,
    ).pipe(Effect.provide(Flag.testLayer([document(experimental)])))

    const registry = yield* Tool.Service
    const command = (text: string) =>
      Effect.forEach(commands, (definition) =>
        definition.execute({ sessionID, prompt: { text }, delivery: "steer" }).pipe(Effect.result),
      ).pipe(Effect.map((results) => results[0]))
    return {
      registry,
      changed,
      synthetics,
      sessionHooks,
      toolHooks,
      handlers: () => rpc.current,
      command,
    }
  })

describe("TaskDiligence detection", () => {
  it.effect("finds work handed back to the user", () =>
    Effect.sync(() => {
      expect(TaskDiligence.deferral("I've added the route. You can now implement the validation yourself.")).toBeDefined()
      expect(TaskDiligence.deferral("I'll leave the tests to you.")).toBeDefined()
      expect(TaskDiligence.deferral("The migration is written. The rest is left as an exercise.")).toBeDefined()
      expect(TaskDiligence.deferral("The remaining parts are up to you.")).toBeDefined()
      expect(TaskDiligence.deferral("For brevity, I omitted the other handlers.")).toBeDefined()
      expect(TaskDiligence.deferral("I'll stop here.")).toBeDefined()
    }),
  )

  it.effect("ignores finished work, explanations, and questions", () =>
    Effect.sync(() => {
      expect(TaskDiligence.deferral("All three endpoints are done and the tests pass.")).toBeUndefined()
      expect(TaskDiligence.deferral("The loop is not exhaustive, so a user can leave the form early.")).toBeUndefined()
      expect(TaskDiligence.deferral("You can implement the validation yourself, or should I?")).toBeUndefined()
      expect(TaskDiligence.deferral("")).toBeUndefined()
    }),
  )

  it.effect("finds placeholder comments but not real code or a bare ellipsis", () =>
    Effect.sync(() => {
      expect(TaskDiligence.placeholder("function a() {\n  // ... rest of the code\n}")).toBeDefined()
      expect(TaskDiligence.placeholder("class A:\n    # ... existing code ...\n")).toBeDefined()
      expect(TaskDiligence.placeholder("/* rest of the implementation */")).toBeDefined()
      expect(TaskDiligence.placeholder("  // rest of the implementation here\n")).toBeDefined()
      expect(TaskDiligence.placeholder("def run() -> None:\n    ...\n")).toBeUndefined()
      expect(TaskDiligence.placeholder("// Fetches the rest of the page, then returns it")).toBeUndefined()
    }),
  )

  it.effect("counts only the placeholder an edit adds", () =>
    Effect.sync(() => {
      const placeholder = "// ... rest of the code"
      expect(TaskDiligence.introduced("edit", { oldString: "a()", newString: `a()\n${placeholder}` })._tag).toBe("Some")
      expect(
        TaskDiligence.introduced("edit", { oldString: `${placeholder}\nb()`, newString: `${placeholder}\nc()` })._tag,
      ).toBe("None")
      expect(TaskDiligence.introduced("write", { content: `x\n${placeholder}\n` })._tag).toBe("Some")
      expect(TaskDiligence.introduced("read", { content: placeholder })._tag).toBe("None")
      expect(TaskDiligence.introduced("write", { path: "a" })._tag).toBe("None")
    }),
  )
})

describe("TaskPlugin", () => {
  it.effect("adds, updates, removes and clears tasks through the RPC, publishing every change", () =>
    Effect.gen(function* () {
      const plugin = yield* run(undefined)
      const rpc = plugin.handlers()
      if (!rpc) return expect.unreachable("the task RPC was not registered")

      const added = yield* rpc.add({ content: "  Write   the   migration  " }, { error: (() => undefined) as never })
      expect(added).toMatchObject({ content: "Write the migration", status: "pending" })
      if (!added) return expect.unreachable("the task was not added")

      expect(yield* rpc.add({ content: "   " }, { error: (() => undefined) as never })).toBeNull()
      expect(yield* rpc.update({ id: "missing", status: "completed" }, { error: (() => undefined) as never })).toBeNull()

      const started = yield* rpc.update({ id: added.id, status: "in_progress" }, { error: (() => undefined) as never })
      expect(started).toMatchObject({ id: added.id, status: "in_progress", content: "Write the migration" })
      yield* rpc.update({ id: added.id, status: "completed" }, { error: (() => undefined) as never })

      expect(yield* rpc.list({}, { error: (() => undefined) as never })).toHaveLength(1)
      expect(yield* rpc.clear({}, { error: (() => undefined) as never })).toBe(1)
      expect(yield* rpc.list({}, { error: (() => undefined) as never })).toHaveLength(0)
      expect(yield* rpc.remove({ id: added.id }, { error: (() => undefined) as never })).toBe(false)
      // add, start, complete, clear: the failed calls changed nothing, so they published nothing.
      expect(plugin.changed).toHaveLength(4)
    }),
  )

  it.effect("keeps simultaneous additions from overwriting each other", () =>
    Effect.gen(function* () {
      const plugin = yield* run(undefined)
      const rpc = plugin.handlers()
      if (!rpc) return expect.unreachable("the task RPC was not registered")
      const context = { error: (() => undefined) as never }

      yield* Effect.all(
        ["one", "two", "three", "four", "five"].map((content) => rpc.add({ content }, context)),
        { concurrency: "unbounded" },
      )

      expect(yield* rpc.list({}, context)).toHaveLength(5)
    }),
  )

  it.effect("drives the list from /task by number or id", () =>
    Effect.gen(function* () {
      const plugin = yield* run(undefined)
      const rpc = plugin.handlers()
      if (!rpc) return expect.unreachable("the task RPC was not registered")
      const context = { error: (() => undefined) as never }

      expect((yield* plugin.command("add Write the migration"))._tag).toBe("Success")
      expect((yield* plugin.command("add Run the tests"))._tag).toBe("Success")
      expect((yield* plugin.command("start 1"))._tag).toBe("Success")
      expect((yield* plugin.command("done 2"))._tag).toBe("Success")
      expect((yield* rpc.list({}, context)).map((task) => task.status)).toEqual(["in_progress", "completed"])

      // Unknown tasks, missing text and unknown verbs explain themselves instead of silently doing nothing.
      expect((yield* plugin.command("done 9"))._tag).toBe("Failure")
      expect((yield* plugin.command("add"))._tag).toBe("Failure")
      expect((yield* plugin.command("frobnicate"))._tag).toBe("Failure")

      expect((yield* plugin.command("clear"))._tag).toBe("Success")
      expect((yield* plugin.command("clear"))._tag).toBe("Failure")
      expect((yield* plugin.command("rm 1"))._tag).toBe("Success")
      expect(yield* rpc.list({}, context)).toHaveLength(0)
    }),
  )

  it.effect("gives the agent no task tools unless experimental.tasks is on", () =>
    Effect.gen(function* () {
      const names = (plugin: { readonly registry: Tool.Interface }) =>
        toolDefinitions(plugin.registry).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

      expect(yield* names(yield* run(undefined))).not.toContain("task_list")
      expect(yield* names(yield* run(new ConfigExperimental.Info({ tasks: false })))).not.toContain("task_add")
      expect(yield* names(yield* run(on))).toEqual(
        expect.arrayContaining(["task_list", "task_add", "task_update", "task_remove"]),
      )
    }),
  )

  it.effect("lets the agent add, update and remove tasks, and tells it when an id is wrong", () =>
    Effect.gen(function* () {
      const plugin = yield* run(on)
      const call = (name: string, input: unknown) =>
        executeTool(plugin.registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: `call-${name}`, name, input },
        })

      const added = yield* call("task_add", { tasks: ["Write the migration", "Run the tests"] })
      expect(added.status).toBe("completed")
      const listed = yield* call("task_list", {})
      const tasks = Schema.decodeUnknownSync(Schema.Struct({ tasks: Schema.Array(Task.Item) }))(listed.output).tasks
      expect(tasks.map((task) => task.content)).toEqual(["Write the migration", "Run the tests"])

      const updated = yield* call("task_update", { id: tasks[0]?.id, status: "completed" })
      expect(updated.status).toBe("completed")
      expect((yield* call("task_update", { id: "nope", status: "completed" })).status).toBe("error")
      expect((yield* call("task_remove", { id: tasks[1]?.id })).status).toBe("completed")
      expect((yield* call("task_remove", { id: tasks[1]?.id })).status).toBe("error")
      expect((yield* call("task_add", { tasks: ["   "] })).status).toBe("error")
    }),
  )
})

describe("TaskPlugin diligence monitor", () => {
  const assistant = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] })
  const user = (text: string, metadata?: Record<string, unknown>) => ({ type: "user", text, metadata })
  const idle = (plugin: { readonly sessionHooks: Map<string, Hook> }, background: unknown[] = []) =>
    plugin.sessionHooks.get("experimental.idle")?.({ sessionID, background }) ?? Effect.die("no idle hook")
  const addTask = (plugin: { readonly handlers: () => RpcHandlers<typeof Task.Definition> | undefined }, content: string) =>
    plugin.handlers()?.add({ content }, { error: (() => undefined) as never }) ?? Effect.die("no RPC")

  it.effect("adds the system prompt only when experimental.diligence is on", () =>
    Effect.gen(function* () {
      const request = () => ({ sessionID, system: [] as Array<{ type: "text"; text: string }>, messages: [] })
      const withFlag = yield* run(on)
      const enabled = request()
      yield* withFlag.sessionHooks.get("context")?.(enabled) ?? Effect.die("no context hook")
      expect(enabled.system.map((part) => part.text)).toEqual([TaskDiligence.PROMPT])

      const without = yield* run(undefined)
      const disabled = request()
      yield* without.sessionHooks.get("context")?.(disabled) ?? Effect.die("no context hook")
      expect(disabled.system).toEqual([])
    }),
  )

  it.effect("pushes a session that stops with unfinished tasks back to work, a bounded number of times", () =>
    Effect.gen(function* () {
      const plugin = yield* run(on, { messages: () => [user("Build it"), assistant("Done for now.")] })
      yield* addTask(plugin, "Write the migration")

      yield* idle(plugin)
      yield* idle(plugin)
      yield* idle(plugin)
      expect(plugin.synthetics).toHaveLength(TaskDiligence.MAX_NUDGES)
      expect(plugin.synthetics[0]?.text).toContain("Write the migration")
      expect(plugin.synthetics[0]?.metadata).toEqual({ source: "diligence" })

      // The user's next prompt starts the count again.
      yield* plugin.sessionHooks.get("prompt")?.({ sessionID }) ?? Effect.die("no prompt hook")
      yield* idle(plugin)
      expect(plugin.synthetics).toHaveLength(TaskDiligence.MAX_NUDGES + 1)
    }),
  )

  it.effect("pushes back on a message that hands work to the user, even with no tasks", () =>
    Effect.gen(function* () {
      const plugin = yield* run(on, {
        messages: () => [user("Add validation"), assistant("I added the schema. You can now implement the checks yourself.")],
      })
      yield* idle(plugin)
      expect(plugin.synthetics).toHaveLength(1)
      expect(plugin.synthetics[0]?.text).toContain('("You can now implement")')
    }),
  )

  it.effect("leaves finished work, questions, background work, subagents and goal rounds alone", () =>
    Effect.gen(function* () {
      const quiet = (plugin: { readonly synthetics: Synthetic[] }) => expect(plugin.synthetics).toHaveLength(0)

      const finished = yield* run(on, { messages: () => [user("Add it"), assistant("Added it and the tests pass.")] })
      yield* idle(finished)
      quiet(finished)

      const asking = yield* run(on, { messages: () => [user("Add it"), assistant("Which database should I use?")] })
      yield* addTask(asking, "Pick a database")
      yield* idle(asking)
      quiet(asking)

      const waiting = yield* run(on, { messages: () => [user("Add it"), assistant("Started the build.")] })
      yield* addTask(waiting, "Wait for the build")
      yield* idle(waiting, [{ kind: "shell", sessionID, shellID: "sh_1", command: "bun run build" }])
      quiet(waiting)

      const subagent = yield* run(on, {
        parentID: Session.ID.make("ses_parent"),
        messages: () => [user("Look it up"), assistant("Found it.")],
      })
      yield* addTask(subagent, "Parent task")
      yield* idle(subagent)
      quiet(subagent)

      const goal = yield* run(on, {
        messages: () => [user("Continue toward the goal", { source: "goal" }), assistant("Working on it.")],
      })
      yield* addTask(goal, "Goal task")
      yield* idle(goal)
      quiet(goal)

      const disabled = yield* run(undefined, { messages: () => [user("Add it"), assistant("You can now do the rest.")] })
      yield* idle(disabled)
      quiet(disabled)
    }),
  )

  it.effect("rejects a write or edit that leaves placeholder code, and lets real code through", () =>
    Effect.gen(function* () {
      const plugin = yield* run(on)
      const before = (tool: string, input: unknown) =>
        (plugin.toolHooks.get("execute.before")?.({ tool, input }) ?? Effect.die("no tool hook")).pipe(Effect.result)

      const lazy = yield* before("write", { filePath: "/a.ts", content: "export function a() {\n  // ... rest of the code\n}" })
      expect(lazy._tag).toBe("Failure")
      const edit = yield* before("edit", { filePath: "/a.ts", oldString: "a()", newString: "a()\n// ... existing code ..." })
      expect(edit._tag).toBe("Failure")
      expect((yield* before("write", { filePath: "/a.ts", content: "export const a = 1\n" }))._tag).toBe("Success")
      expect((yield* before("read", { filePath: "/a.ts" }))._tag).toBe("Success")

      const off = yield* run(undefined)
      const ignored = yield* (off.toolHooks.get("execute.before")?.({
        tool: "write",
        input: { filePath: "/a.ts", content: "// ... rest of the code" },
      }) ?? Effect.die("no tool hook")).pipe(Effect.result)
      expect(ignored._tag).toBe("Success")
    }),
  )
})
