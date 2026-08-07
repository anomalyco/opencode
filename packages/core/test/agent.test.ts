import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/util/global"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const testLocation = location({ directory: AbsolutePath.make("/project") })
const locationLayer = Layer.succeed(Location.Service, Location.Service.of(testLocation))
const global = Global.make({ data: "/data", config: "/config", tmp: "/tmp/opencode" })
const globalLayer = Layer.succeed(Global.Service, Global.Service.of(global))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node]), [
    [Global.node, globalLayer],
    [Location.node, locationLayer],
  ]) as unknown as Layer.Layer<unknown, never>,
)

describe("Agent", () => {
  it.effect("publishes an updated event after agent changes", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const bus = yield* Bus.Service
      const updated = yield* bus
        .subscribe(Agent.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* agent.transform((editor) => editor.update(Agent.ID.make("reviewer"), () => {}))

      expect(yield* Fiber.join(updated)).toMatchObject([{ location: { directory: testLocation.directory } }])
    }),
  )

  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service

      expect(yield* agent.list()).toEqual([])
      expect(yield* agent.get(Agent.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("reviewer")
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = "Reviews code"
          info.mode = "subagent"
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, description: "Reviews code", mode: "subagent" })
      expect((yield* agent.list()).map((info) => info.id)).toEqual([id])
    }),
  )

  it.effect("rebuilds state when a transform is replaced", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("reviewer")
      let description = "Old description"
      let hidden = true
      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.description = description
          info.hidden = hidden
        }),
      )
      description = "New description"
      hidden = false
      const reload = yield* agent.reload().pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("500 millis")
      yield* Fiber.join(reload)

      expect(yield* agent.get(id)).toMatchObject({ description: "New description", hidden: false })
    }),
  )

  it.effect("removes a transform when its scope closes", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("build")

      yield* agent.transform((editor) =>
        editor.update(id, (info) => {
          info.mode = "primary"
          info.hidden = true
        }),
      )

      expect(yield* agent.get(id)).toMatchObject({ id, mode: "primary", hidden: true })
    }),
  )

  it.effect("creates agents with runtime defaults and supports direct removal", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      const id = Agent.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      const info = yield* agent.get(id)
      expect(info?.mode).toBe("primary")
      expect(info?.permissions.slice(0, Agent.Info.default(id).permissions.length)).toEqual(
        Agent.Info.default(id).permissions,
      )
      expect(Permission.evaluate("external_directory", path.join(global.data, "shell", "*", "*"), info?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(Permission.evaluate("external_directory", path.join(global.data, "tool-output", "*"), info?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(Permission.evaluate("external_directory", path.join(global.config, "*"), info?.permissions ?? []).effect).toBe(
        "allow",
      )
      expect(Permission.evaluate("external_directory", path.join(global.tmp, "*"), info?.permissions ?? []).effect).toBe(
        "allow",
      )

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies managed external directories without opting built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      const agents = yield* agent.list()
      expect(agents.map((item) => String(item.id)).sort()).toEqual([
        "build",
        "compaction",
        "explore",
        "general",
        "plan",
        "summary",
        "title",
      ])
      expect((yield* agent.get(Agent.defaultID))?.system).toBeUndefined()
      const permissions = (yield* agent.get(Agent.defaultID))?.permissions ?? []
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "shell", "*", "*"), permissions).effect,
      ).toBe("allow")
      expect(
        Permission.evaluate("external_directory", path.join(global.data, "tool-output", "*"), permissions).effect,
      ).toBe("allow")
      expect(Permission.evaluate("external_directory", path.join(global.config, "*"), permissions).effect).toBe("allow")
      expect(Permission.evaluate("external_directory", path.join(global.tmp, "*"), permissions).effect).toBe("allow")
      const explore = yield* agent.get(Agent.ID.make("explore"))
      expect(Permission.evaluate("read", ".env", explore?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.local", explore?.permissions ?? []).effect).toBe("ask")
      expect(Permission.evaluate("read", ".env.example", explore?.permissions ?? []).effect).toBe("allow")
      expect(Permission.evaluate("read", "src/index.ts", explore?.permissions ?? []).effect).toBe("allow")
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  it.effect("denies the subagent tool for built-in subagents", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      )

      yield* Effect.forEach(["general", "explore"], (id) =>
        Effect.gen(function* () {
          const info = yield* agent.get(Agent.ID.make(id))
          if (!info) throw new Error(`expected built-in agent: ${id}`)
          expect(info.mode).toBe("subagent")
          expect(info.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
          expect(Permission.evaluate("subagent", "*", info.permissions).effect).toBe("deny")
        }),
      )
    }),
  )
})
