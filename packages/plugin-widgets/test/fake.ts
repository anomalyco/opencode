import type { Plugin } from "@opencode/plugin/effect"
import type { AgentEditor } from "@opencode/plugin/effect/agent"
import type { SkillEditor } from "@opencode/plugin/effect/skill"
import type { ToolEditor } from "@opencode/plugin/effect/tool"
import type { Skill } from "@opencode/schema/skill"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Queue, Schema, Stream } from "effect"

type Handler = (
  input: unknown,
  call: { error: (type: string, message: string, data?: unknown) => unknown },
) => Effect.Effect<unknown, unknown>

export type RpcFailure = { readonly type: string; readonly message: string; readonly data?: unknown }

/**
 * The parts of the public plugin Context the widgets plugin uses, recorded in memory. Any other domain throws, so a
 * test fails loudly if the plugin starts depending on more.
 */
export const make = Effect.gen(function* () {
  const storage = new Map<string, Schema.Json>()
  const tools = new Map<string, Tool.Info>()
  const skills: Skill.Info[] = []
  const permissions = new Map<string, Array<{ action: string; resource: string; effect: string }>>([
    ["build", []],
    ["plan", []],
    ["general", []],
  ])
  const handlers: Record<string, Handler> = {}
  const events: Array<{ name: string; data: unknown }> = []
  const synthetic: Array<{
    sessionID: string
    text: string
    description?: string | null
    metadata?: Record<string, unknown>
    resume?: boolean | null
  }> = []
  const asserted: Array<{ action: string; resources: ReadonlyArray<string> }> = []
  const published = yield* Queue.unbounded<{ type: "session.deleted"; data: { sessionID: string } }>()
  const disposed = { dispose: Effect.void }

  const partial = {
    storage: {
      get: (key: string) => Effect.sync(() => storage.get(key)),
      set: (key: string, value: Schema.Json) => Effect.sync(() => void storage.set(key, value)),
      remove: (key: string) => Effect.sync(() => void storage.delete(key)),
      scan: (options: { prefix: string; after?: string; limit?: number }) =>
        Effect.sync(() => {
          const keys = [...storage.keys()]
            .filter((key) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
            .toSorted()
          const page = keys.slice(0, options.limit ?? 100)
          return {
            entries: page.map((key) => ({ key, value: storage.get(key)! })),
            next: keys.length > page.length ? page.at(-1) : undefined,
          }
        }),
    },
    rpc: {
      register: (_: unknown, registered: Record<string, Handler>) =>
        Effect.sync(() => {
          Object.assign(handlers, registered)
          return {
            dispose: Effect.void,
            events: { emit: (name: string, data: unknown) => Effect.sync(() => void events.push({ name, data })) },
          }
        }),
    },
    tool: {
      transform: (callback: (editor: ToolEditor) => void) =>
        Effect.sync(() => {
          callback({ add: (tool: Tool.Info) => void tools.set(tool.name, tool) } as unknown as ToolEditor)
          return disposed
        }),
    },
    skill: {
      transform: (callback: (editor: SkillEditor) => void) =>
        Effect.sync(() => {
          callback({ add: (info: Skill.Info) => void skills.push(info) } as unknown as SkillEditor)
          return disposed
        }),
    },
    agent: {
      transform: (callback: (editor: AgentEditor) => void) =>
        Effect.sync(() => {
          callback({
            update: (id: string, update: (agent: { permissions: unknown[] }) => void) => {
              const rules = permissions.get(id)
              if (rules) update({ permissions: rules })
            },
          } as unknown as AgentEditor)
          return disposed
        }),
    },
    permission: {
      assert: (input: { action: string; resources: ReadonlyArray<string> }) =>
        Effect.sync(() => void asserted.push({ action: input.action, resources: input.resources })),
    },
    session: {
      synthetic: (input: (typeof synthetic)[number]) => Effect.sync(() => void synthetic.push(input)),
    },
    event: { subscribe: () => Stream.fromQueue(published) },
  }

  // The plugin type-checks against the full Context; the fake implements only what it calls.
  const context = new Proxy(partial, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof target]
      throw new Error(`The widgets plugin used ctx.${String(key)}, which the fake does not provide`)
    },
  }) as unknown as Plugin.Context

  const call = <A = unknown>(method: string, input: unknown) =>
    handlers[method]!(input, { error: (type, message, data) => ({ type, message, data }) }) as Effect.Effect<
      A,
      RpcFailure
    >

  return { context, storage, tools, skills, permissions, events, synthetic, asserted, published, call }
})
