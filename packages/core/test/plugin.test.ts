import { describe, expect } from "bun:test"
import { Context, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { Plugin } from "@opencode-ai/schema/plugin"
import { AgentV2 } from "@opencode-ai/core/agent"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { testModel } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

class Secret extends Context.Service<Secret, string>()("@opencode/test/PluginSecret") {}

describe("PluginV2", () => {
  it.live("exposes public events through the plugin context", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const events = yield* EventV2.Service
      const host = yield* PluginHost.make(plugins)
      const received = yield* host.event.subscribe().pipe(
        Stream.filter((event) => event.type === "config.updated"),
        Stream.runHead,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 millis")

      yield* events.publish(ConfigSchema.Event.Updated, {})

      expect((yield* Fiber.join(received)).valueOrUndefined?.type).toBe("config.updated")
    }),
  )

  it.effect("skips identical generations and replaces changed plugin versions", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const events = yield* EventV2.Service
      let description = "first"
      const updated = yield* events
        .subscribe(Plugin.Event.Updated)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))

      const managed = () =>
        define({
          id: "managed",
          effect: (ctx) =>
            ctx.agent
              .transform((agents) =>
                agents.update("configured", (agent) => {
                  agent.description = description
                }),
              )
              .pipe(Effect.asVoid),
        })

      yield* plugins.activate([{ plugin: managed() }])

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      description = "second"
      yield* plugins.activate([{ plugin: managed() }])
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      yield* plugins.activate([{ plugin: managed(), version: "next" }])
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")
      expect(yield* Fiber.join(updated)).toHaveLength(2)

      yield* plugins.activate([])
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
    }),
  )

  it.effect("rejects duplicate IDs before replacing the active generation", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const active = Plugin.ID.make("active")
      const duplicate = "duplicate"
      yield* plugins.activate([{ plugin: { id: active, effect: () => Effect.void } }])

      const result = yield* plugins
        .activate([
          { plugin: { id: duplicate, effect: () => Effect.void } },
          { plugin: { id: duplicate, effect: () => Effect.void } },
        ])
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* plugins.list()).toEqual([{ id: active }])
    }),
  )

  it.effect("retries the same generation after materialization fails", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      let fail = true
      const plugin = define({
        id: "retry",
        effect: (ctx) =>
          ctx.agent
            .transform(() => {
              if (fail) throw new Error("materialization failed")
            })
            .pipe(Effect.asVoid),
      })

      expect(Exit.isFailure(yield* plugins.activate([{ plugin }]).pipe(Effect.exit))).toBe(true)
      fail = false
      yield* plugins.activate([{ plugin }])

      expect(yield* plugins.list()).toEqual([{ id: Plugin.ID.make("retry") }])
    }),
  )

  it.effect("closes the previous generation in reverse order", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const closed: string[] = []
      yield* plugins.activate(
        ["first", "second"].map((id) => ({
          plugin: {
            id,
            effect: () => Effect.addFinalizer(() => Effect.sync(() => closed.push(id))),
          },
        })),
      )

      yield* plugins.activate([])

      expect(closed).toEqual(["second", "first"])
    }),
  )

  it.effect("isolates plugins from ambient services", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      let visible = true
      const plugin = define({
        id: "isolated",
        effect: () =>
          Effect.serviceOption(Secret).pipe(
            Effect.tap((secret) => Effect.sync(() => (visible = secret._tag === "Some"))),
            Effect.asVoid,
          ),
      })

      yield* plugins.activate([{ plugin }]).pipe(Effect.provideService(Secret, "secret"))

      expect(visible).toBe(false)
    }),
  )

  it.effect("registers location tools through the plugin context", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const registry = yield* ToolRegistry.Service
      const plugin = define({
        id: "tool-plugin",
        effect: (ctx) =>
          ctx.tool
            .register({
              plugin_tool: Tool.make({
                description: "Plugin tool",
                input: Schema.Struct({}),
                output: Schema.Struct({ ok: Schema.Boolean }),
                execute: () => Effect.succeed({ ok: true }),
              }),
            })
            .pipe(Effect.orDie),
      })

      yield* plugins.activate([{ plugin }])
      expect((yield* registry.materialize({ model: testModel })).definitions.map((tool) => tool.name)).toContain(
        "plugin_tool",
      )

      yield* plugins.activate([])
      expect((yield* registry.materialize({ model: testModel })).definitions.map((tool) => tool.name)).not.toContain(
        "plugin_tool",
      )
    }),
  )

  it.effect("groups tool names and defers registrations from direct exposure", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const registry = yield* ToolRegistry.Service
      const tool = (description: string) =>
        Tool.make({
          description,
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.succeed({ ok: true }),
        })
      const plugin = define({
        id: "grouped-tools",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.tool.register({ plain: tool("Plain") }).pipe(Effect.orDie)
            yield* ctx.tool.register({ "look/up": tool("Lookup") }, { group: "context 7" }).pipe(Effect.orDie)
            yield* ctx.tool
              .register({ search: tool("Search") }, { group: "context 7", deferred: true })
              .pipe(Effect.orDie)
          }),
      })

      yield* plugins.activate([{ plugin }])

      expect((yield* registry.materialize({ model: testModel })).definitions.map((tool) => tool.name)).toEqual([
        "plain",
        "context_7_look_up",
        "execute",
      ])
    }),
  )

  it.effect("fires before/after tool hooks with mutable events around settlement", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const registry = yield* ToolRegistry.Service
      const executed: unknown[] = []
      const seen: {
        before?: unknown
        after?: { input: unknown; result: unknown; output: unknown }
      } = {}

      const plugin = define({
        id: "tool-hooks",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.tool
              .register({
                echo: Tool.make({
                  description: "Echo",
                  input: Schema.Struct({ text: Schema.String }),
                  output: Schema.Struct({ text: Schema.String }),
                  execute: ({ text }) => Effect.sync(() => executed.push({ text })).pipe(Effect.as({ text })),
                }),
              })
              .pipe(Effect.orDie)

            yield* ctx.tool.execute
              .before((event) => {
                seen.before = event.input
                event.input = { text: "before-mutated" }
              })
              .pipe(Effect.asVoid)

            yield* ctx.tool.execute
              .after((event) => {
                seen.after = { input: event.input, result: event.result, output: event.output }
                event.result = { type: "text", value: "after-mutated" }
                event.output = { structured: { rewritten: true }, content: [] }
              })
              .pipe(Effect.asVoid)
          }),
      })

      yield* plugins.activate([{ plugin }])

      const materialized = yield* registry.materialize({ model: testModel })
      const settlement = yield* materialized.settle({
        sessionID: SessionV2.ID.make("ses_hooks"),
        agent: AgentV2.ID.make("build"),
        assistantMessageID: SessionMessage.ID.make("msg_hooks"),
        call: { type: "tool-call", id: "call-hooks", name: "echo", input: { text: "original" } },
      })

      expect(seen.before).toEqual({ text: "original" })
      expect(executed).toEqual([{ text: "before-mutated" }])
      expect(seen.after).toEqual({
        input: { text: "before-mutated" },
        result: { type: "json", value: { text: "before-mutated" } },
        output: { structured: { text: "before-mutated" }, content: [] },
      })
      expect(settlement.result).toEqual({ type: "text", value: "after-mutated" })
      expect(settlement.output).toEqual({ structured: { rewritten: true }, content: [] })
    }),
  )
})
