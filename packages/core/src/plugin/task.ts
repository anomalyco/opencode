export * as TaskPlugin from "./task.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Task } from "@opencode/schema/task"
import { Clock, Effect, Option, Schema, Semaphore } from "effect"
import { Config } from "../config.js"
import { ConfigEntryObserver } from "../config/plugin/entry-observer.js"
import { Flag } from "../flag.js"
import { TaskDiligence } from "./task-diligence.js"

const Items = Schema.Array(Task.Item)
const decodeItems = Schema.decodeUnknownOption(Items)

const USAGE = "Usage: /task [list] | add <text> | start <n> | done <n> | cancel <n> | rm <n> | clear"

const GUIDE = `Use the task tools to keep a persistent task list for this project. The user sees the list and can edit it.

- task_list: read the current tasks, with their ids. Do this before adding, so you do not duplicate.
- task_add: add concrete, verifiable tasks when work has several steps. Do not add vague tasks.
- task_update: set status to in_progress when you start a task and completed only once it is done and verified. Use cancelled, with a reason in the content, for a task that no longer applies.
- task_remove: delete a task that was added by mistake.

Keep at most one task in_progress. Never mark a task completed that is partly done or untested.`

const StatusField = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])

export const Plugin = {
  id: "opencode.task",
  effect: Effect.fn("TaskPlugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service

    // One list per project, shared by its Sessions. Storage has no compare-and-set, so writes in this process take turns.
    const key = `project:${ctx.location.project.id}`
    const lock = Semaphore.makeUnsafe(1)

    const read = ctx.storage.get(key).pipe(Effect.map((value) => Option.getOrElse(decodeItems(value), () => [])))

    const rpc = yield* ctx.rpc
      .register(Task.Definition, {
        list: () => read,
        add: (input) => add(input.content),
        update: (input) => update(input.id, { content: input.content, status: input.status }),
        remove: (input) => remove(input.id),
        clear: () => clear(),
      })
      .pipe(Effect.orDie)

    // Applies `change` to the stored list and publishes the result, unless the change leaves it as it was.
    const mutate = <A>(
      change: (
        items: ReadonlyArray<Task.Item>,
        now: number,
      ) => readonly [result: A, next: ReadonlyArray<Task.Item> | undefined],
    ): Effect.Effect<A> =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const items = yield* read
          const [result, next] = change(items, yield* Clock.currentTimeMillis)
          if (next === undefined) return result
          yield* ctx.storage.set(key, Schema.encodeSync(Items)(next))
          yield* rpc.events
            .emit("changed", { tasks: next })
            .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish a task change", { cause })))
          return result
        }),
      )

    const add = Effect.fn("TaskPlugin.add")(function* (content: string): Effect.fn.Return<Task.Item | null> {
      const text = content.trim().replace(/\s+/g, " ").slice(0, Task.MAX_CONTENT)
      if (text === "") return null
      const id = yield* Effect.sync(() => crypto.randomUUID().slice(0, 8))
      return yield* mutate((items, now): [Task.Item | null, ReadonlyArray<Task.Item> | undefined] => {
        if (items.length >= Task.MAX_TASKS) return [null, undefined]
        const created: Task.Item = { id, content: text, status: "pending", createdAt: now, updatedAt: now }
        return [created, [...items, created]]
      })
    })

    const update = Effect.fn("TaskPlugin.update")(function* (
      id: string,
      patch: { readonly content?: string; readonly status?: Task.Status },
    ): Effect.fn.Return<Task.Item | null> {
      return yield* mutate((items, now): [Task.Item | null, ReadonlyArray<Task.Item> | undefined] => {
        const current = items.find((item) => item.id === id)
        if (!current) return [null, undefined]
        const content = patch.content?.trim().replace(/\s+/g, " ").slice(0, Task.MAX_CONTENT)
        const next: Task.Item = {
          ...current,
          content: content ? content : current.content,
          status: patch.status ?? current.status,
          updatedAt: now,
        }
        return [next, items.map((item) => (item.id === id ? next : item))]
      })
    })

    const remove = Effect.fn("TaskPlugin.remove")(function* (id: string): Effect.fn.Return<boolean> {
      return yield* mutate((items): [boolean, ReadonlyArray<Task.Item> | undefined] => {
        if (!items.some((item) => item.id === id)) return [false, undefined]
        return [true, items.filter((item) => item.id !== id)]
      })
    })

    const clear = Effect.fn("TaskPlugin.clear")(function* (): Effect.fn.Return<number> {
      return yield* mutate((items): [number, ReadonlyArray<Task.Item> | undefined] => {
        const kept = items.filter((item) => item.status === "pending" || item.status === "in_progress")
        return kept.length === items.length ? [0, undefined] : [items.length - kept.length, kept]
      })
    })

    yield* ctx.command.transform((editor) => {
      editor.add({
        name: "task",
        description: "manage the project's task list [add|start|done|cancel|rm|clear]",
        execute: (input) =>
          Effect.gen(function* () {
            const text = input.prompt.text.trim()
            const [verb = "", ...rest] = text.split(/\s+/)
            const argument = rest.join(" ")
            const items = yield* read
            const fail = (message: string) => Effect.fail(new Error(message))

            if (verb === "" || verb.toLowerCase() === "list") {
              return yield* fail(items.length === 0 ? `No tasks yet.\n${USAGE}` : `${describe(items)}\n${USAGE}`)
            }
            if (verb.toLowerCase() === "add") {
              if (argument === "") return yield* fail("Say what the task is: /task add <text>")
              if (items.length >= Task.MAX_TASKS) return yield* fail(`A project holds at most ${Task.MAX_TASKS} tasks.`)
              return yield* add(argument)
            }
            if (verb.toLowerCase() === "clear") {
              const removed = yield* clear()
              return removed === 0 ? yield* fail("No completed or cancelled tasks to clear.") : undefined
            }

            const status = statusFor(verb.toLowerCase())
            if (status === undefined && verb.toLowerCase() !== "rm") return yield* fail(USAGE)
            const target = resolve(items, argument)
            if (!target) return yield* fail(argument === "" ? "Say which task: a number from /task." : `No task "${argument}".`)
            if (status === undefined) return yield* remove(target.id)
            return yield* update(target.id, { status })
          }).pipe(Effect.asVoid),
      })
    })

    yield* TaskDiligence.install(ctx, { enabled: () => flags.resolve(loaded.entries).diligence.enabled, read })

    yield* ctx.tool
      .transform((editor) => {
        if (!flags.resolve(loaded.entries).tasks.enabled) return
        editor.add({
          name: "task_list",
          options: { codemode: false },
          description: `List the project's persistent tasks with their ids and statuses.\n\n${GUIDE}`,
          input: Schema.Struct({}),
          output: Schema.Struct({ tasks: Items }),
          execute: () =>
            read.pipe(
              Effect.map((tasks) => ({ output: { tasks }, content: describe(tasks), metadata: { tasks } })),
            ),
        })
        editor.add({
          name: "task_add",
          options: { codemode: false },
          description: "Add one or more concrete, verifiable tasks to the project's task list. Call task_list first.",
          input: Schema.Struct({
            tasks: Schema.Array(
              Schema.String.annotate({ description: "One concrete task, in a short imperative sentence" }),
            ).annotate({ description: "The tasks to add, in order" }),
          }),
          output: Schema.Struct({ added: Schema.Array(Task.Item) }),
          execute: (input) =>
            Effect.gen(function* () {
              const added = yield* Effect.forEach(input.tasks, (content) => add(content))
              const created = added.filter((item) => item !== null)
              if (created.length === 0) return yield* new ToolFailure({ message: "No task was added: empty text, or the list is full" })
              return {
                output: { added: created },
                content: `Added ${created.length} task(s):\n${describe(created)}`,
                metadata: { added: created },
              }
            }),
        })
        editor.add({
          name: "task_update",
          options: { codemode: false },
          description:
            "Change a task's status or wording by id. Mark it in_progress when you start it and completed only when it is done and verified.",
          input: Schema.Struct({
            id: Schema.String.annotate({ description: "The task id from task_list" }),
            status: Schema.optional(StatusField).annotate({ description: "The new status" }),
            content: Schema.optional(Schema.String).annotate({ description: "New wording for the task" }),
          }),
          output: Schema.Struct({ task: Task.Item }),
          execute: (input) =>
            update(input.id, { content: input.content, status: input.status }).pipe(
              Effect.flatMap((task) =>
                task
                  ? Effect.succeed({ output: { task }, content: describe([task]), metadata: { task } })
                  : Effect.fail(new ToolFailure({ message: `No task with id ${input.id}. Call task_list for the ids.` })),
              ),
            ),
        })
        editor.add({
          name: "task_remove",
          options: { codemode: false },
          description: "Delete a task by id. Prefer cancelled over deleting a task the user may have wanted.",
          input: Schema.Struct({ id: Schema.String.annotate({ description: "The task id from task_list" }) }),
          output: Schema.Struct({ removed: Schema.Boolean }),
          execute: (input) =>
            remove(input.id).pipe(
              Effect.flatMap((removed) =>
                removed
                  ? Effect.succeed({ output: { removed }, content: `Removed task ${input.id}.`, metadata: { removed } })
                  : Effect.fail(new ToolFailure({ message: `No task with id ${input.id}. Call task_list for the ids.` })),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

/** The tasks that still need work: what a stopped agent has left undone. */
export const unfinished = (items: ReadonlyArray<Task.Item>) =>
  items.filter((item) => item.status === "pending" || item.status === "in_progress")

export function describe(items: ReadonlyArray<Task.Item>) {
  if (items.length === 0) return "No tasks."
  return items.map((item, index) => `${index + 1}. [${mark(item.status)}] ${item.content} (${item.id})`).join("\n")
}

function mark(status: Task.Status) {
  if (status === "completed") return "x"
  if (status === "in_progress") return "~"
  if (status === "cancelled") return "-"
  return " "
}

function statusFor(verb: string): Task.Status | undefined {
  if (verb === "start") return "in_progress"
  if (verb === "done") return "completed"
  if (verb === "cancel") return "cancelled"
  return undefined
}

// A task is named by its list number, as /task prints them, or by id.
function resolve(items: ReadonlyArray<Task.Item>, reference: string) {
  const text = reference.trim()
  if (text === "") return undefined
  if (/^\d+$/.test(text)) return items[Number(text) - 1]
  return items.find((item) => item.id === text)
}
