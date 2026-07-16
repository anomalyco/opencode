import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { AgentV2 } from "@opencode-ai/core/agent"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const testLocation = location({ directory: AbsolutePath.make("/project") })
const locationLayer = Layer.succeed(Location.Service, Location.Service.of(testLocation))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([AgentV2.node, EventV2.node, Location.node]), [
    [Location.node, locationLayer],
  ]) as unknown as Layer.Layer<unknown, never>,
)

describe("AgentV2", () => {
  it.effect("publishes an updated event after agent changes", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const events = yield* EventV2.Service
      const updated = yield* events
        .subscribe(AgentV2.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* agent.transform((editor) => editor.update(AgentV2.ID.make("reviewer"), () => {}))

      expect(yield* Fiber.join(updated)).toMatchObject([{ location: { directory: testLocation.directory } }])
    }),
  )

  it.effect("starts without agents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service

      expect(yield* agent.list()).toEqual([])
      expect(yield* agent.get(AgentV2.ID.make("build"))).toBeUndefined()
    }),
  )

  it.effect("materializes replayable agent transforms", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
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
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("reviewer")
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
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("scoped")
      const scope = yield* Scope.make()
      yield* agent.transform((editor) => editor.update(id, () => {})).pipe(Scope.provide(scope))
      expect(yield* agent.get(id)).toBeDefined()

      yield* Scope.close(scope, Exit.void)
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("applies direct agent updates", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("build")

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
      const agent = yield* AgentV2.Service
      const id = AgentV2.ID.make("custom")

      yield* agent.transform((editor) => editor.update(id, () => {}))
      expect(yield* agent.get(id)).toEqual(AgentV2.Info.empty(id))

      yield* agent.transform((editor) => editor.remove(id))
      expect(yield* agent.get(id)).toBeUndefined()
    }),
  )

  it.effect("does not ambiently opt built-in agents into bash", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
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
      expect((yield* agent.get(AgentV2.defaultID))?.system).toBeUndefined()
      for (const item of agents) {
        expect(item.permissions.some((rule) => rule.action === "bash" && rule.effect !== "deny")).toBe(false)
      }
    }),
  )

  it.effect("denies the subagent tool for built-in subagents", () =>
    Effect.gen(function* () {
      const agent = yield* AgentV2.Service
      yield* AgentPlugin.Plugin.effect(
        host({
          agent: agentHost(agent),
        }),
      ).pipe(
        Effect.provideService(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
        ),
      )

      yield* Effect.forEach(["general", "explore"], (id) =>
        Effect.gen(function* () {
          const info = yield* agent.get(AgentV2.ID.make(id))
          if (!info) throw new Error(`expected built-in agent: ${id}`)
          expect(info.mode).toBe("subagent")
          expect(info.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
          expect(PermissionV2.evaluate("subagent", "*", info.permissions).effect).toBe("deny")
        }),
      )
    }),
  )
})
