import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Plugin } from "@opencode-ai/plugin/v2/effect"
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect"
import type { Scope } from "effect/Scope"
import { SimulatedProvider } from "../src/backend/simulated-provider"
import { availableEndpoint, connect } from "./fixture/websocket"

test("streams a Drive-controlled provider response and removes the finished invocation", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "simulation.handshake",
          params: {
            client: { name: "test", version: "test" },
            expectedRole: "backend",
            offeredVersions: [1],
            requiredCapabilities: ["llm.attach", "llm.request"],
            optionalCapabilities: [],
          },
        }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({
        id: 0,
        result: {
          protocolVersion: 1,
          role: "backend",
          server: { name: "opencode", version: expect.any(String) },
          capabilities: expect.arrayContaining(["llm.attach", "llm.request"]),
        },
      })

      socket.send("{")
      expect(yield* Queue.take(messages)).toMatchObject({ id: null, error: { code: -32000 } })
      yield* attach(socket, messages)

      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)

      const opened = yield* takeInvocation(messages)
      expect(opened).toMatchObject({
        method: "llm.request",
        params: {
          url: "https://api.openai.com/v1/chat/completions",
          body: { model: "gpt-5" },
        },
      })
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")
      expect(response.pollUnsafe()).toBeUndefined()

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: { id: params.id, items: [{ type: "textDelta", text: "Hello from Drive" }] },
        }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "llm.finish",
          params: { id: params.id, reason: "stop" },
        }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 3, result: { ok: true } })

      expect(Array.from(yield* Fiber.join(response))).toEqual([
        { type: "textDelta", text: "Hello from Drive" },
        { type: "finish", reason: "stop" },
      ])

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "llm.pending" }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 4, result: { invocations: [] } })
    }),
  )
})

test("replays an invocation to a controller that attaches after it opens", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "llm.attach" }))
      const received = [requireRecord(yield* Queue.take(messages)), requireRecord(yield* Queue.take(messages))]
      expect(received).toContainEqual(expect.objectContaining({ id: 1, result: { attached: true } }))
      const opened = received.find((message) => message.method === "llm.request")
      if (!opened) throw new Error("The pending invocation was not replayed")
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.finish", params: { id: params.id, reason: "stop" } }),
      )
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(Array.from(yield* Fiber.join(response))).toEqual([{ type: "finish", reason: "stop" }])
    }),
  )
})

test("replaces the previous attached controller", async () => {
  const endpoint = availableEndpoint()
  await Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* SimulatedProvider.Service
      const first = yield* connect(endpoint)
      const second = yield* connect(endpoint)
      const firstMessages = yield* messagesFrom(first)
      const secondMessages = yield* messagesFrom(second)

      yield* attach(first, firstMessages)
      yield* attach(second, secondMessages)
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.forkScoped)
      const opened = yield* takeInvocation(secondMessages)
      expect(yield* Queue.size(firstMessages)).toBe(0)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      second.send(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.finish", params: { id: params.id, reason: "stop" } }),
      )
      expect(yield* Queue.take(secondMessages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(Array.from(yield* Fiber.join(response))).toEqual([{ type: "finish", reason: "stop" }])
    }).pipe(Effect.provide(providerLayer(endpoint)), Effect.scoped),
  )
})

test("removes an invocation when its response stream is interrupted", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const response = yield* provider.stream(request).pipe(Stream.runDrain, Effect.forkScoped)
      yield* takeInvocation(messages)

      yield* Fiber.interrupt(response)

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.pending" }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { invocations: [] } })
    }),
  )
})

test("releases a backpressured response when its consumer is interrupted", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const started = yield* Deferred.make<void>()
      const response = yield* provider.stream(request).pipe(
        Stream.runForEach(() => Deferred.succeed(started, void 0).pipe(Effect.andThen(Effect.never))),
        Effect.forkScoped,
      )
      const opened = yield* takeInvocation(messages)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "llm.chunk",
          params: {
            id: params.id,
            items: Array.from({ length: 300 }, (_, index) => ({ type: "textDelta", text: String(index) })),
          },
        }),
      )
      const result = yield* Queue.take(messages).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(result.pollUnsafe()).toBeUndefined()

      yield* Fiber.interrupt(response)
      expect(yield* Fiber.join(result)).toMatchObject({ id: 2 })
    }),
  )
})

test("fails the provider stream when Drive disconnects the invocation", async () => {
  await runProvider((provider, socket, messages) =>
    Effect.gen(function* () {
      yield* attach(socket, messages)
      const response = yield* provider.stream(request).pipe(Stream.runCollect, Effect.flip, Effect.forkScoped)
      const opened = yield* takeInvocation(messages)
      const params = requireRecord(opened.params)
      if (typeof params.id !== "string") throw new Error("llm.request did not contain an invocation id")

      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "llm.disconnect", params: { id: params.id } }))
      expect(yield* Queue.take(messages)).toMatchObject({ id: 2, result: { ok: true } })
      expect(yield* Fiber.join(response)).toBeInstanceOf(SimulatedProvider.ProviderDisconnectedError)
    }),
  )
})

test("controls arbitrary tools through scoped SDK overlays", async () => {
  const endpoint = availableEndpoint()
  const directory = await mkdtemp(join(tmpdir(), "opencode-simulated-tools-"))
  const secondDirectory = join(directory, "second")
  await mkdir(secondDirectory)
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const socket = yield* connect(endpoint)
        const messages = yield* messagesFrom(socket)
        const plugins = yield* SdkPlugins.Service
        let activations = 0
        yield* plugins.register(
          Plugin.define({
            id: "opencode.simulation.test.activation-count",
            effect: () => Effect.sync(() => void activations++),
          }),
        )
        const registration = {
          name: "lookup",
          description: "Look up a value",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
          outputSchema: { type: "object" },
          options: { codemode: false },
        }
        const locations = yield* LocationServiceMap.Service
        const [primary, secondary] = yield* Effect.all([
          Layer.build(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
          Layer.build(locations.get(Location.Ref.make({ directory: AbsolutePath.make(secondDirectory) }))),
        ])
        yield* Effect.forEach([primary, secondary], (context) =>
          PluginSupervisor.Service.use((supervisor) => supervisor.flush).pipe(Effect.provide(context)),
        )
        expect(activations).toBe(2)

        yield* Effect.gen(function* () {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tool.attach",
              params: { tools: [registration] },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 1, result: { attached: true } })
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(materialized.definitions).toContainEqual(
            expect.objectContaining({ name: "lookup", description: "Look up a value" }),
          )
          const secondaryMaterialized = yield* ToolRegistry.Service.use((secondaryRegistry) =>
            secondaryRegistry.materialize(),
          ).pipe(Effect.provide(secondary))
          expect(secondaryMaterialized.definitions).toContainEqual(
            expect.objectContaining({ name: "lookup", description: "Look up a value" }),
          )
          const progress: ToolRegistry.Progress[] = []
          const settle = (callID: string, query: string) =>
            materialized.settle({
              sessionID: SessionV2.ID.make("ses_simulated_tools"),
              agent: AgentV2.ID.make("build"),
              messageID: SessionMessage.ID.make("msg_simulated_tools"),
              progress: (update) => Effect.sync(() => progress.push(update)),
              call: {
                type: "tool-call",
                id: callID,
                name: "lookup",
                input: { query },
              },
            })

          const successful = yield* settle("call_success", "answer").pipe(Effect.forkScoped)
          const successInvocation = yield* takeToolInvocation(messages)
          expect(successInvocation.params).toMatchObject({
            name: "lookup",
            input: { query: "answer" },
            context: {
              sessionID: "ses_simulated_tools",
              agent: "build",
              messageID: "msg_simulated_tools",
              callID: "call_success",
            },
          })
          const successID = requireString(requireRecord(successInvocation.params).id)
          const update = JSON.stringify({
            jsonrpc: "2.0",
            id: 20,
            method: "tool.update",
            params: {
              id: successID,
              sequence: 0,
              update: {
                structured: { phase: "searching" },
                content: [{ type: "text", text: "Searching" }],
              },
            },
          })
          socket.send(update)
          expect(yield* Queue.take(messages)).toMatchObject({ id: 20, result: { ok: true } })
          socket.send(update)
          expect(yield* Queue.take(messages)).toMatchObject({ id: 20, result: { ok: true } })
          socket.send(
            JSON.stringify({
              ...JSON.parse(update),
              id: 21,
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 21, result: { ok: true } })
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 20,
              method: "tool.update",
              params: {
                id: successID,
                sequence: 0,
                update: { structured: { phase: "different" } },
              },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({
            id: 20,
            error: { message: expect.stringContaining("reused with different progress") },
          })
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 22,
              method: "tool.update",
              params: {
                id: successID,
                sequence: 2,
                update: { structured: { phase: "skipped" } },
              },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({
            id: 22,
            error: { message: expect.stringContaining("Expected simulated tool update sequence 1") },
          })
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tool.finish",
              params: {
                id: successID,
                output: {
                  structured: { answer: 42 },
                  content: [{ type: "text", text: "42" }],
                },
              },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 3, result: { ok: true } })
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 23,
              method: "tool.finish",
              params: {
                id: successID,
                output: {
                  structured: { answer: 42 },
                  content: [{ type: "text", text: "42" }],
                },
              },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 23, result: { ok: true } })
          expect(yield* Fiber.join(successful)).toMatchObject({
            result: { type: "text", value: "42" },
            output: {
              structured: { answer: 42 },
              content: [{ type: "text", text: "42" }],
            },
          })
          expect(progress).toEqual([
            {
              structured: { phase: "searching" },
              content: [{ type: "text", text: "Searching" }],
            },
          ])

          const failed = yield* settle("call_failure", "missing").pipe(Effect.forkScoped)
          const failedInvocation = yield* takeToolInvocation(messages)
          const failedID = requireString(requireRecord(failedInvocation.params).id)
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 4,
              method: "tool.fail",
              params: { id: failedID, message: "lookup failed" },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 4, result: { ok: true } })
          expect(yield* Fiber.join(failed)).toMatchObject({
            result: { type: "error", value: "lookup failed" },
          })

          const concurrent = [
            yield* settle("call_first", "first").pipe(Effect.forkScoped),
            yield* settle("call_second", "second").pipe(Effect.forkScoped),
          ]
          const invocations = [yield* takeToolInvocation(messages), yield* takeToolInvocation(messages)]
          const byCall = new Map(
            invocations.map((invocation) => {
              const params = requireRecord(invocation.params)
              const context = requireRecord(params.context)
              return [requireString(context.callID), requireString(params.id)]
            }),
          )
          for (const [id, callID, value] of [
            [5, "call_second", "second result"],
            [6, "call_first", "first result"],
          ] as const) {
            socket.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                method: "tool.finish",
                params: {
                  id: byCall.get(callID),
                  output: { structured: value, content: [{ type: "text", text: value }] },
                },
              }),
            )
            expect(yield* Queue.take(messages)).toMatchObject({ id, result: { ok: true } })
          }
          expect((yield* Fiber.join(concurrent[0])).result).toEqual({ type: "text", value: "first result" })
          expect((yield* Fiber.join(concurrent[1])).result).toEqual({ type: "text", value: "second result" })

          const cancelled = yield* settle("call_cancelled", "slow").pipe(Effect.forkScoped)
          const cancelledInvocation = yield* takeToolInvocation(messages)
          const cancelledID = requireString(requireRecord(cancelledInvocation.params).id)
          yield* Fiber.interrupt(cancelled)
          expect(yield* Queue.take(messages)).toMatchObject({
            method: "tool.cancel",
            params: { id: cancelledID, reason: "interrupted" },
          })
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 7,
              method: "tool.finish",
              params: {
                id: cancelledID,
                output: { structured: null, content: [] },
              },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({
            id: 7,
            error: { message: expect.stringContaining("not found or already finished") },
          })

          const replayed = yield* settle("call_replayed", "reconnect").pipe(Effect.forkScoped)
          const original = yield* takeToolInvocation(messages)
          const originalID = requireString(requireRecord(original.params).id)
          const replayedProgress = {
            structured: { phase: "before-reconnect" },
            content: [{ type: "text", text: "Still running" }],
          }
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 25,
              method: "tool.update",
              params: { id: originalID, sequence: 0, update: replayedProgress },
            }),
          )
          expect(yield* Queue.take(messages)).toMatchObject({ id: 25, result: { ok: true } })
          const replacement = yield* connect(endpoint)
          const replacementMessages = yield* messagesFrom(replacement)
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 8,
              method: "tool.attach",
              params: { tools: [registration] },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({
            id: 8,
            error: { message: expect.stringContaining("already attached") },
          })
          yield* closeSocket(socket)
          const disconnected = yield* registry.materialize()
          expect(disconnected.definitions).toContainEqual(expect.objectContaining({ name: "lookup" }))
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 90,
              method: "tool.attach",
              params: { tools: [{ ...registration, name: "replacement" }] },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({
            id: 90,
            error: { message: expect.stringContaining("must settle pending invocations") },
          })
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 9,
              method: "tool.attach",
              params: { tools: [registration] },
            }),
          )
          const attached = [
            requireRecord(yield* Queue.take(replacementMessages)),
            requireRecord(yield* Queue.take(replacementMessages)),
          ]
          expect(attached).toContainEqual(expect.objectContaining({ id: 9, result: { attached: true } }))
          expect(attached).toContainEqual(
            expect.objectContaining({
              method: "tool.invocation",
              params: expect.objectContaining({ id: originalID }),
            }),
          )
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 26,
              method: "tool.update",
              params: { id: originalID, sequence: 0, update: replayedProgress },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({ id: 26, result: { ok: true } })
          expect(progress.filter((update) => update.structured.phase === "before-reconnect")).toHaveLength(1)
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 10,
              method: "tool.finish",
              params: {
                id: originalID,
                output: {
                  structured: "replayed result",
                  content: [{ type: "text", text: "replayed result" }],
                },
              },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({ id: 10, result: { ok: true } })
          expect((yield* Fiber.join(replayed)).result).toEqual({
            type: "text",
            value: "replayed result",
          })

          const preserved = yield* settle("call_preserved", "same generation").pipe(Effect.forkScoped)
          const preservedInvocation = yield* takeToolInvocation(replacementMessages)
          const preservedID = requireString(requireRecord(preservedInvocation.params).id)
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 27,
              method: "tool.finish",
              params: {
                id: preservedID,
                output: { structured: "preserved", content: [{ type: "text", text: "preserved" }] },
              },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({ id: 27, result: { ok: true } })
          expect((yield* Fiber.join(preserved)).result).toEqual({ type: "text", value: "preserved" })

          const namespaced = [
            { ...registration, name: "search", options: { namespace: "github", codemode: false } },
            { ...registration, name: "search", options: { namespace: "web", codemode: false } },
          ]
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 11,
              method: "tool.attach",
              params: { tools: namespaced },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({ id: 11, result: { attached: true } })
          const replaced = yield* registry.materialize()
          const replacedNames = replaced.definitions.map((definition) => definition.name)
          expect(replacedNames).toEqual(expect.arrayContaining(["github_search", "web_search"]))
          expect(replacedNames).not.toContain("lookup")
          const secondaryReplaced = yield* ToolRegistry.Service.use((secondaryRegistry) =>
            secondaryRegistry.materialize(),
          ).pipe(Effect.provide(secondary))
          const secondaryNames = secondaryReplaced.definitions.map((definition) => definition.name)
          expect(secondaryNames).toEqual(expect.arrayContaining(["github_search", "web_search"]))
          expect(secondaryNames).not.toContain("lookup")
          const routed = yield* replaced
            .settle({
              sessionID: SessionV2.ID.make("ses_simulated_tools"),
              agent: AgentV2.ID.make("build"),
              messageID: SessionMessage.ID.make("msg_simulated_tools"),
              call: {
                type: "tool-call",
                id: "call_namespaced",
                name: "github_search",
                input: { query: "routing" },
              },
            })
            .pipe(Effect.forkScoped)
          const routedInvocation = yield* takeToolInvocation(replacementMessages)
          expect(routedInvocation.params).toMatchObject({ name: "github_search" })
          const routedID = requireString(requireRecord(routedInvocation.params).id)
          replacement.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 12,
              method: "tool.finish",
              params: {
                id: routedID,
                output: { structured: "routed", content: [{ type: "text", text: "routed" }] },
              },
            }),
          )
          expect(yield* Queue.take(replacementMessages)).toMatchObject({ id: 12, result: { ok: true } })
          expect((yield* Fiber.join(routed)).result).toEqual({ type: "text", value: "routed" })
          expect(
            yield* materialized.settle({
              sessionID: SessionV2.ID.make("ses_simulated_tools"),
              agent: AgentV2.ID.make("build"),
              messageID: SessionMessage.ID.make("msg_simulated_tools"),
              call: {
                type: "tool-call",
                id: "call_stale",
                name: "lookup",
                input: { query: "stale" },
              },
            }),
          ).toMatchObject({
            result: { type: "error", value: expect.stringContaining("no longer active") },
          })
          expect(activations).toBe(2)
        }).pipe(Effect.provide(primary))
      }).pipe(Effect.provide(toolLifecycleLayer(endpoint)), Effect.scoped),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15_000)

const request: SimulatedProvider.ProviderRequest = {
  url: "https://api.openai.com/v1/chat/completions",
  body: { model: "gpt-5", messages: [{ role: "user", content: "Hello" }] },
}

function runProvider<E>(
  body: (
    provider: SimulatedProvider.Interface,
    socket: WebSocket,
    messages: Queue.Queue<unknown>,
  ) => Effect.Effect<void, E, Scope>,
) {
  const endpoint = availableEndpoint()
  return Effect.runPromise(
    Effect.gen(function* () {
      const provider = yield* SimulatedProvider.Service
      const socket = yield* connect(endpoint)
      const messages = yield* messagesFrom(socket)
      yield* body(provider, socket, messages)
    }).pipe(Effect.provide(providerLayer(endpoint)), Effect.scoped),
  )
}

const providerLayer = (endpoint: string) =>
  SimulatedProvider.layerDrive({ endpoint }).pipe(
    Layer.provide(
      Layer.succeed(SdkPlugins.Service, SdkPlugins.Service.of({ register: () => Effect.void, all: () => [] })),
    ),
  )

const toolLifecycleLayer = (endpoint: string) => {
  const provider = makeGlobalNode({
    service: SimulatedProvider.Service,
    layer: SimulatedProvider.layerDrive({ endpoint }),
    deps: [SdkPlugins.node],
  })
  return AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SdkPlugins.node, LocationServiceMap.node, provider]),
    [[Config.node, Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))]],
  )
}

function messagesFrom(socket: WebSocket) {
  return Effect.gen(function* () {
    const messages = yield* Queue.unbounded<unknown>()
    socket.addEventListener("message", (event) => {
      Queue.offerUnsafe(messages, JSON.parse(String(event.data)))
    })
    return messages
  })
}

function closeSocket(socket: WebSocket) {
  return Effect.callback<void>((resume) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resume(Effect.void)
      return Effect.void
    }
    const closed = () => resume(Effect.void)
    socket.addEventListener("close", closed, { once: true })
    socket.close()
    return Effect.sync(() => socket.removeEventListener("close", closed))
  })
}

function attach(socket: WebSocket, messages: Queue.Queue<unknown>) {
  return Effect.gen(function* () {
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "llm.attach" }))
    expect(yield* Queue.take(messages)).toMatchObject({ id: 1, result: { attached: true } })
  })
}

function takeInvocation(messages: Queue.Queue<unknown>) {
  return Queue.take(messages).pipe(
    Effect.map((message) => {
      const opened = requireRecord(message)
      if (opened.method !== "llm.request") throw new Error("Expected an llm.request notification")
      return opened
    }),
  )
}

function takeToolInvocation(messages: Queue.Queue<unknown>) {
  return Queue.take(messages).pipe(
    Effect.map((message) => {
      const opened = requireRecord(message)
      if (opened.method !== "tool.invocation") throw new Error("Expected a tool.invocation notification")
      return opened
    }),
  )
}

function requireString(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected a string")
  return value
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected an object")
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
