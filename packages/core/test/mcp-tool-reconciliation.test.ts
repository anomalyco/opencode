import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Image } from "@opencode-ai/core/image"
import { MCP } from "@opencode-ai/core/mcp/index"
import { Permission } from "@opencode-ai/core/permission"
import { McpTool } from "@opencode-ai/core/tool/mcp"
import { Tool } from "@opencode-ai/core/tool"
import { Event } from "@opencode-ai/schema/event"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { DateTime, Deferred, Effect, Fiber, Layer, PubSub, Ref, Stream } from "effect"
import { imagePassthrough } from "./lib/image"

test("fences asynchronous MCP tool additions and removals", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const initialRead = yield* Deferred.make<void>()
        const addStarted = yield* Deferred.make<void>()
        const releaseAdd = yield* Deferred.make<void>()
        const removeStarted = yield* Deferred.make<void>()
        const releaseRemove = yield* Deferred.make<void>()
        const gates = [
          { started: addStarted, release: releaseAdd },
          { started: removeStarted, release: releaseRemove },
        ]
        const updates = yield* PubSub.unbounded<Event.Payload>()
        const reads = yield* Ref.make(0)
        const catalog = yield* Ref.make<Array<MCP.Tool>>([])

        function subscribe(): Stream.Stream<Event.Payload>
        function subscribe<D extends Event.Definition>(definition: D): Stream.Stream<Event.Payload<D>>
        function subscribe<const D extends readonly [Event.Definition, ...Event.Definition[]]>(
          definitions: D,
        ): Stream.Stream<Bus.SubscribePayload<D>>
        function subscribe(): Stream.Stream<Event.Payload> {
          return Stream.fromPubSub(updates)
        }

        const layer = AppNodeBuilder.build(LayerNode.group([Tool.node, McpTool.node]), [
          [
            MCP.node,
            Layer.mock(MCP.Service, {
              tools: () =>
                Effect.gen(function* () {
                  const read = yield* Ref.updateAndGet(reads, (count) => count + 1)
                  if (read === 1) {
                    const current = yield* Ref.get(catalog)
                    yield* Deferred.succeed(initialRead, undefined)
                    return current
                  }
                  if (read % 2 === 0) {
                    const gate = gates[read / 2 - 1]
                    if (gate) {
                      yield* Deferred.succeed(gate.started, undefined)
                      yield* Deferred.await(gate.release)
                    }
                  }
                  return yield* Ref.get(catalog)
                }),
            }),
          ],
          [Bus.node, Layer.mock(Bus.Service, { subscribe })],
          [Permission.node, Layer.mock(Permission.Service, {})],
          [Image.node, imagePassthrough],
        ])

        yield* Effect.gen(function* () {
          const registry = yield* Tool.Service
          const adapter = yield* McpTool.Service
          yield* Deferred.await(initialRead)
          yield* Ref.set(catalog, [
            new MCP.Tool({
              server: MCP.ServerName.make("voice"),
              name: "list_open_tabs",
              inputSchema: { type: "object", properties: {} },
            }),
          ])

          yield* PubSub.publish(updates, {
            id: Event.ID.create(),
            created: yield* DateTime.now,
            type: McpEvent.ToolsChanged.type,
            data: { server: "voice" },
          })
          yield* Deferred.await(addStarted)

          const staleAddition = yield* registry.snapshot()
          expect(staleAddition.codeModeCatalog?.some((entry) => entry.path === "voice.list_open_tabs")).toBe(false)

          const addFence = yield* Effect.forkChild(adapter.reconcile, { startImmediately: true })
          expect(addFence.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(releaseAdd, undefined)
          yield* Fiber.join(addFence)

          const added = yield* registry.snapshot()
          expect(added.codeModeCatalog?.some((entry) => entry.path === "voice.list_open_tabs")).toBe(true)

          yield* Ref.set(catalog, [])
          yield* PubSub.publish(updates, {
            id: Event.ID.create(),
            created: yield* DateTime.now,
            type: McpEvent.ToolsChanged.type,
            data: { server: "voice" },
          })
          yield* Deferred.await(removeStarted)

          const staleRemoval = yield* registry.snapshot()
          expect(staleRemoval.codeModeCatalog?.some((entry) => entry.path === "voice.list_open_tabs")).toBe(true)

          const removeFence = yield* Effect.forkChild(adapter.reconcile, { startImmediately: true })
          expect(removeFence.pollUnsafe()).toBeUndefined()
          yield* Deferred.succeed(releaseRemove, undefined)
          yield* Fiber.join(removeFence)

          const removed = yield* registry.snapshot()
          expect(removed.codeModeCatalog?.some((entry) => entry.path === "voice.list_open_tabs")).toBe(false)
        }).pipe(Effect.provide(layer))
      }),
    ),
  )
})
