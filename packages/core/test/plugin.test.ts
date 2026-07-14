import { describe, expect } from "bun:test"
import { Context, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { Plugin as EffectPlugin } from "@opencode-ai/plugin/v2/effect"
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
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

class Secret extends Context.Service<Secret, string>()("@opencode/test/PluginSecret") {}

const versioned = <R>(plugin: EffectPlugin.Plugin<R>, version = "1") => ({ ...plugin, version })

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

  it.effect("replaces plugins by ID and version", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const events = yield* EventV2.Service
      let description = "first"
      let updates = 0
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === Plugin.Event.Updated.type) updates++
        }),
      )

      const managed = () =>
        EffectPlugin.define({
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

      yield* plugins.activate([versioned(managed(), "1")])

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      description = "second"
      yield* plugins.activate([versioned(managed(), "2")])
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      description = "third"
      yield* plugins.activate([versioned(managed(), "2")])
      expect(updates).toBe(2)
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      yield* plugins.activate([])
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
      expect(updates).toBe(3)
      yield* unsubscribe
    }),
  )

  it.effect("rejects duplicate IDs before replacing active plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const active = Plugin.ID.make("active")
      const duplicate = "duplicate"
      yield* plugins.activate([{ id: active, version: "1", effect: () => Effect.void }])

      const result = yield* plugins
        .activate([
          { id: duplicate, version: "1", effect: () => Effect.void },
          { id: duplicate, version: "1", effect: () => Effect.void },
        ])
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(yield* plugins.list()).toEqual([{ id: active }])
    }),
  )

  it.effect("skips failed plugins and loads the rest", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let fail = true
      const good = EffectPlugin.define({
        id: "good",
        effect: (ctx) =>
          ctx.agent
            .transform((agents) =>
              agents.update("configured", (agent) => {
                agent.description = "loaded"
              }),
            )
            .pipe(Effect.asVoid),
      })
      const bad = EffectPlugin.define({
        id: "bad",
        effect: () => {
          if (fail) return Effect.die(new Error("materialization failed"))
          return Effect.void
        },
      })

      yield* plugins.activate([versioned(good), versioned(bad)])
      expect(yield* plugins.list()).toEqual([{ id: Plugin.ID.make("good") }])
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("loaded")

      fail = false
      yield* plugins.activate([versioned(good), versioned(bad, "2")])
      expect(yield* plugins.list()).toEqual([{ id: Plugin.ID.make("good") }, { id: Plugin.ID.make("bad") }])
    }),
  )

  it.effect("restores the previous plugin when its replacement fails", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const previous = EffectPlugin.define({
        id: "managed",
        effect: (ctx) =>
          ctx.agent
            .transform((agents) =>
              agents.update("configured", (agent) => {
                agent.description = "previous"
              }),
            )
            .pipe(Effect.asVoid),
      })
      const replacement = EffectPlugin.define({
        id: "managed",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.agent.transform((agents) =>
              agents.update("configured", (agent) => {
                agent.description = "replacement"
              }),
            )
            return yield* Effect.die(new Error("replacement failed"))
          }),
      })

      yield* plugins.activate([versioned(previous)])
      yield* plugins.activate([versioned(replacement, "2")])

      expect(yield* plugins.list()).toEqual([{ id: Plugin.ID.make("managed") }])
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("previous")
    }),
  )

  it.effect("deactivates a plugin when replacement and restoration fail", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let loads = 0
      const previous = EffectPlugin.define({
        id: "managed",
        effect: (ctx) => {
          loads++
          if (loads > 1) return Effect.die(new Error("restoration failed"))
          return ctx.agent
            .transform((agents) =>
              agents.update("configured", (agent) => {
                agent.description = "previous"
              }),
            )
            .pipe(Effect.asVoid)
        },
      })
      const replacement = EffectPlugin.define({
        id: "managed",
        effect: () => Effect.die(new Error("replacement failed")),
      })

      yield* plugins.activate([versioned(previous)])
      yield* plugins.activate([versioned(replacement, "2")])

      expect(yield* plugins.list()).toEqual([])
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
    }),
  )

  it.effect("closes the previous generation in reverse order", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const closed: string[] = []
      yield* plugins.activate(
        ["first", "second"].map((id) => ({
          id,
          version: "1",
          effect: () => Effect.addFinalizer(() => Effect.sync(() => closed.push(id))),
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
      const plugin = EffectPlugin.define({
        id: "isolated",
        effect: () =>
          Effect.serviceOption(Secret).pipe(
            Effect.tap((secret) => Effect.sync(() => (visible = secret._tag === "Some"))),
            Effect.asVoid,
          ),
      })

      yield* plugins.activate([versioned(plugin)]).pipe(Effect.provideService(Secret, "secret"))

      expect(visible).toBe(false)
    }),
  )

  it.effect("registers location tools through the plugin context", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const registry = yield* ToolRegistry.Service
      const plugin = EffectPlugin.define({
        id: "tool-plugin",
        effect: (ctx) =>
          ctx.tool
            .transform((draft) =>
              draft.add(
                "plugin_tool",
                Tool.make({
                  description: "Plugin tool",
                  input: Schema.Struct({}),
                  output: Schema.Struct({ ok: Schema.Boolean }),
                  execute: () => Effect.succeed({ ok: true }),
                }),
                { codemode: false },
              ),
            )
            .pipe(Effect.orDie),
      })

      yield* plugins.activate([versioned(plugin)])
      expect((yield* registry.materialize()).definitions.map((tool) => tool.name)).toContain("plugin_tool")

      yield* plugins.activate([])
      expect((yield* registry.materialize()).definitions.map((tool) => tool.name)).not.toContain("plugin_tool")
    }),
  )

  it.effect("groups tool names and routes codemode registrations through execute", () =>
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
      const plugin = EffectPlugin.define({
        id: "grouped-tools",
        effect: (ctx) =>
          ctx.tool
            .transform((draft) => {
              draft.add("plain", tool("Plain"), { codemode: false })
              draft.add("look/up", tool("Lookup"), { group: "context 7", codemode: false })
              draft.add("search", tool("Search"), { group: "context 7" })
            })
            .pipe(Effect.orDie),
      })

      yield* plugins.activate([versioned(plugin)])

      expect((yield* registry.materialize()).definitions.map((tool) => tool.name)).toEqual([
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

      const plugin = EffectPlugin.define({
        id: "tool-hooks",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.tool
              .transform((draft) =>
                draft.add(
                  "echo",
                  Tool.make({
                    description: "Echo",
                    input: Schema.Struct({ text: Schema.String }),
                    output: Schema.Struct({ text: Schema.String }),
                    execute: ({ text }) => Effect.sync(() => executed.push({ text })).pipe(Effect.as({ text })),
                  }),
                  { codemode: false },
                ),
              )
              .pipe(Effect.orDie)

            yield* ctx.tool
              .hook("execute.before", (event) =>
                Effect.sync(() => {
                  seen.before = event.input
                  event.input = { text: "before-mutated" }
                }),
              )
              .pipe(Effect.asVoid)

            yield* ctx.tool
              .hook("execute.after", (event) =>
                Effect.sync(() => {
                  seen.after = { input: event.input, result: event.result, output: event.output }
                  event.result = { type: "text", value: "after-mutated" }
                  event.output = { structured: { rewritten: true }, content: [] }
                }),
              )
              .pipe(Effect.asVoid)
          }),
      })

      yield* plugins.activate([versioned(plugin)])

      const materialized = yield* registry.materialize()
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
