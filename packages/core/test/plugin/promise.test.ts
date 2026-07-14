import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Plugin } from "@opencode-ai/plugin/v2"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("forwards standard client reads", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const seen: string[] = []
      const promisePlugin = Plugin.define({
        id: "promise-client-reads",
        setup: async (ctx) => {
          const results = await Promise.all([
            ctx.agent.list(),
            ctx.catalog.provider.list(),
            ctx.catalog.model.list(),
            ctx.command.list(),
            ctx.integration.list(),
            ctx.plugin.list(),
            ctx.reference.list(),
            ctx.skill.list(),
          ])
          seen.push(...results.map((result) => result.location.directory))
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      expect(seen).toHaveLength(8)
      expect(new Set(seen).size).toBe(1)
    }),
  )

  it.effect("loads a promise plugin and registers a transform hook", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = Plugin.define({
        id: "promise-example",
        setup: async (ctx) => {
          expect(ctx.options.mode).toBe("strict")
          await ctx.agent.transform((draft) => {
            draft.update("reviewer", (item) => {
              item.description = "Reviews code"
              item.mode = "subagent"
            })
          })
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect({ ...host, options: { mode: "strict" } })

      expect(yield* agents.get(AgentV2.ID.make("reviewer"))).toMatchObject({
        description: "Reviews code",
        mode: "subagent",
      })
    }),
  )

  it.effect("disposes a hook registration on request", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = Plugin.define({
        id: "promise-dispose",
        setup: async (ctx) => {
          const registration = await ctx.agent.transform((draft) => {
            draft.update("temp", (item) => {
              item.description = "temporary"
            })
          })
          await registration.dispose()
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect(host)

      expect(yield* agents.get(AgentV2.ID.make("temp"))).toBeUndefined()
    }),
  )

  it.effect("runs the setup cleanup when the plugin scope closes", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const events: string[] = []
      const promisePlugin = Plugin.define({
        id: "promise-cleanup",
        setup: async () => {
          events.push("setup")
          return async () => {
            await Promise.resolve()
            events.push("cleanup")
          }
        },
      })

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* PluginPromise.fromPromise(promisePlugin).effect(host)
          expect(events).toEqual(["setup"])
        }),
      )

      expect(events).toEqual(["setup", "cleanup"])
    }),
  )

  it.effect("constructs plain Promise tool declarations in the host", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const registry = yield* ToolRegistry.Service
      const host = yield* PluginHost.make(plugins)
      const progress: ToolRegistry.Progress[] = []
      const promisePlugin = Plugin.define({
        id: "promise-tool",
        setup: async (ctx) => {
          await ctx.tool.transform((tools) => {
            tools.add({
              name: "hello",
              options: { codemode: false },
              description: "Hello",
              input: Schema.Struct({ name: Schema.String }),
              output: Schema.String,
              execute: async ({ name }, context) => {
                await context.progress({ structured: { phase: "greeting" } })
                return `Hello, ${name}!`
              },
            })
          })
        },
      })

      yield* PluginPromise.fromPromise(promisePlugin).effect(host)

      const materialized = yield* registry.materialize()
      expect(materialized.definitions).toContainEqual(expect.objectContaining({ name: "hello", description: "Hello" }))
      expect(
        yield* materialized.settle({
          sessionID: SessionV2.ID.make("ses_promise_tool"),
          agent: AgentV2.ID.make("build"),
          messageID: SessionMessage.ID.make("msg_promise_tool"),
          progress: (update) => Effect.sync(() => progress.push(update)),
          call: { type: "tool-call", id: "call_promise_tool", name: "hello", input: { name: "world" } },
        }),
      ).toMatchObject({ result: { type: "text", value: "Hello, world!" } })
      expect(progress).toEqual([{ structured: { phase: "greeting" }, content: [] }])
    }),
  )
})
