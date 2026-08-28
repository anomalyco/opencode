import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Instance } from "@opencode-ai/core/instance"
import { Location } from "@opencode-ai/core/location"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Plugin } from "@opencode-ai/core/plugin"
import { InstancePlugins } from "@opencode-ai/core/plugin/instance"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Credential } from "@opencode-ai/schema/credential"
import { Event } from "@opencode-ai/schema/event"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"

describe("Instance Bus capture", () => {
  it.live("isolates real plugin and MCP notifications across same-directory instances", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const globals = yield* Layer.build(
        LayerNode.compile(Instance.globalsGraph, [
          [Global.node, tempGlobalLayer],
          [ModelsDev.node, ModelsDev.configured({ fetch: false })],
          [Watcher.node, Watcher.configured({ enabled: false })],
        ]),
      )
      const root = Context.get(globals, Bus.Service)
      const doneID = Event.ID.create()
      const ids = ["capture-first", "capture-second"]
      const received: EventManifest.ServerEvent[][] = [[], []]
      const completed = yield* Effect.forEach(ids, () => Deferred.make<void>())
      const selected = (event: EventManifest.ServerEvent) =>
        (event.type === "plugin.added" && event.data.id.startsWith("capture-")) ||
        event.type === "mcp.status.changed" ||
        event.type === "credential.updated"
      const shared = yield* root.subscribe().pipe(
        Stream.filter(EventManifest.isServer),
        Stream.filter(selected),
        Stream.takeUntil((event) => event.id === doneID),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      )
      const ref = Location.Ref.make({ directory: AbsolutePath.make(directory.path) })
      const instances = yield* Effect.forEach(ids, (id, index) => {
        const probe: InstancePlugins.List[number] = {
          id,
          effect: (ctx) =>
            ctx.event.subscribe().pipe(
              Stream.filter(EventManifest.isServer),
              Stream.filter(selected),
              Stream.takeUntil((event) => event.id === doneID),
              Stream.runForEach((event) => Effect.sync(() => received[index].push(event))),
              Effect.andThen(Deferred.succeed(completed[index], undefined)),
              Effect.forkScoped({ startImmediately: true }),
              Effect.asVoid,
            ),
        }
        return Layer.build(
          Instance.compose(ref, { discovery: false, plugins: [probe] }).pipe(
            Layer.provide(Layer.succeedContext(globals)),
          ),
        )
      })
      yield* Effect.forEach(instances, (instance, index) =>
        Effect.gen(function* () {
          yield* Context.get(instance, PluginSupervisor.Service).flush
          expect(
            (yield* Context.get(instance, Plugin.Service).list()).find((plugin) => plugin.id === ids[index])?.status,
          ).toBe("active")
        }),
      )
      yield* Effect.forEach(instances, (instance, index) =>
        Context.get(instance, Mcp.Service).transform((draft) =>
          draft.set(ids[index], { type: "local", command: ["unused"], disabled: true }),
        ),
      )
      const done = yield* root.publish(Credential.Event.Updated, {}, { id: doneID, global: true })
      yield* Effect.forEach(completed, Deferred.await)

      expect(Array.from(yield* Fiber.join(shared))).toEqual([done])
      received.forEach((events, index) =>
        expect(
          events.map((event) => {
            if (event.type === "plugin.added") return [event.type, event.data.id]
            if (event.type === "mcp.status.changed") return [event.type, event.data.server]
            return [event.type]
          }),
        ).toEqual([["plugin.added", ids[index]], ["mcp.status.changed", ids[index]], ["credential.updated"]]),
      )
    }),
  )
})
