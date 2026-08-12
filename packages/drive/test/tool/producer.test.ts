import { expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import * as SimulationConnector from "../../src/simulation/connector.js"
import * as ToolProducer from "../../src/tool/producer.js"
import type { Progress } from "../../src/tool/types.js"
import { sendError, sendResult, startTransportPeer } from "../simulation/transport-peer.js"

const registration = {
  name: "lookup",
  description: "Look up a value",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { answer: { type: "number" } },
    required: ["answer"],
  },
  options: { codemode: false },
} as const

const invocation = {
  id: "tool_1",
  name: "lookup",
  input: { query: "meaning" },
  context: {
    sessionID: "ses_tools",
    agent: "build",
    messageID: "msg_tools",
    callID: "call_lookup",
  },
} as const

function notify(socket: Bun.ServerWebSocket<undefined>, method: "tool.invocation" | "tool.cancel", params: unknown) {
  socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
}

it.live("attaches, sequences progress, and settles one dynamic invocation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)

      yield* controller.controls.attach({ tools: [registration] })
      const socket = peer.received[0].socket
      notify(socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")

      expect(call).toMatchObject(invocation)
      yield* call.progress({
        structured: { phase: "searching" },
        content: [{ type: "text", text: "Searching" }],
      })
      yield* call.progress({ structured: { phase: "done" } })
      yield* call.finish({
        structured: { answer: 42 },
        content: [{ type: "text", text: "42" }],
      })

      expect(peer.received.map(({ request }) => request)).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tool.attach",
          params: { tools: [registration] },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tool.update",
          params: {
            id: "tool_1",
            sequence: 0,
            update: {
              structured: { phase: "searching" },
              content: [{ type: "text", text: "Searching" }],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tool.update",
          params: {
            id: "tool_1",
            sequence: 1,
            update: { structured: { phase: "done" } },
          },
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tool.finish",
          params: {
            id: "tool_1",
            output: {
              structured: { answer: 42 },
              content: [{ type: "text", text: "42" }],
            },
          },
        },
      ])
      expect(yield* call.fail("late").pipe(Effect.flip)).toMatchObject({
        _tag: "OpenCodeDrive.ToolLifecycleError",
        operation: "fail",
        reason: "already-settled",
        callID: "call_lookup",
      })
      yield* controller.settle
      expect(yield* controller.controls.attach({ tools: [registration] }).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "controller-closed",
      })
    }),
  ),
)

it.live("fails settlement after a completed invocation ID is reused", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(
          socket,
          request,
          request.method === "tool.attach" ? { attached: true } : { ok: true },
        ),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      const socket = peer.received[0].socket
      notify(socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")
      yield* call.finish({ structured: { answer: 42 }, content: [] })
      notify(socket, "tool.invocation", {
        ...invocation,
        input: { query: "different" },
      })
      const failure = yield* controller.failure.pipe(Effect.flip)

      expect(yield* controller.settle.pipe(Effect.flip)).toEqual(failure)
    }),
  ),
)

it.live("observes cancellation and rejects terminal work after it wins", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      const socket = peer.received[0].socket
      notify(socket, "tool.invocation", invocation)
      notify(socket, "tool.cancel", { id: "tool_1", reason: "interrupted" })
      yield* Effect.sleep(10)
      const call = yield* controller.controls.take("call_lookup")
      const cancelled = yield* call.awaitCancelled().pipe(Effect.forkScoped)

      expect(yield* Fiber.join(cancelled)).toEqual({
        id: "tool_1",
        reason: "interrupted",
      })
      expect(yield* call.finish({ structured: 42, content: [] }).pipe(Effect.flip)).toMatchObject({
        operation: "finish",
        reason: "cancelled",
        callID: "call_lookup",
      })
      yield* controller.settle
    }),
  ),
)

it.live("bounds retained unclaimed cancellations", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, { attached: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      const latest = yield* controller.controls.take("call_257").pipe(Effect.forkScoped)
      const socket = peer.received[0].socket

      for (let index = 0; index < 258; index++) {
        notify(socket, "tool.invocation", {
          ...invocation,
          id: `tool_${index}`,
          context: { ...invocation.context, callID: `call_${index}` },
        })
        notify(socket, "tool.cancel", {
          id: `tool_${index}`,
          reason: "interrupted",
        })
      }

      const latestCall = yield* Fiber.join(latest)
      yield* latestCall.awaitCancelled()
      const retained = yield* controller.controls.take("call_256")
      expect(yield* retained.awaitCancelled()).toMatchObject({ id: "tool_256" })
      const evicted = yield* controller.controls.take("call_0").pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      expect(evicted.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(evicted)
      yield* controller.settle
    }),
  ),
)

it.live("settles concurrent invocations in controlled reverse order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      const socket = peer.received[0].socket
      notify(socket, "tool.invocation", invocation)
      notify(socket, "tool.invocation", {
        ...invocation,
        id: "tool_2",
        input: { query: "second" },
        context: { ...invocation.context, callID: "call_second" },
      })

      const second = yield* controller.controls.take("call_second")
      const first = yield* controller.controls.take("call_lookup")
      const start = yield* Deferred.make<void>()
      const attempts = yield* Effect.all(
        [
          Deferred.await(start).pipe(
            Effect.andThen(second.finish({ structured: 2, content: [] })),
            Effect.exit,
          ),
          Deferred.await(start).pipe(
            Effect.andThen(second.fail("second failed")),
            Effect.exit,
          ),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkScoped)
      yield* Deferred.succeed(start, undefined)
      const exits = yield* Fiber.join(attempts)
      expect(exits.filter(Exit.isSuccess)).toHaveLength(1)
      expect(exits.filter(Exit.isFailure)).toHaveLength(1)
      yield* first.fail("first failed")

      const terminals = peer.received.filter(({ request }) =>
        request.method === "tool.finish" || request.method === "tool.fail",
      )
      expect(terminals).toHaveLength(2)
      expect(terminals[0]?.request.params).toMatchObject({ id: "tool_2" })
      expect(terminals[1]?.request).toMatchObject({
        method: "tool.fail",
        params: { id: "tool_1", message: "first failed" },
      })
      yield* controller.settle
    }),
  ),
)

it.live("reattaches the desired set and deduplicates replay after reconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) notify(socket, "tool.invocation", invocation)
          sendResult(socket, request, { attached: true })
          return
        }
        sendResult(socket, request, { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      notify(peer.received[0].socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")

      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const secondScope = yield* Scope.make()
      const second = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(secondScope))
      const secondAttachment = yield* controller.connect(second)

      expect(yield* controller.controls.take("call_lookup").pipe(Effect.flip)).toMatchObject({
        reason: "already-claimed",
      })
      yield* call.finish({
        structured: { answer: 42 },
        content: [{ type: "text", text: "42" }],
      })
      expect(attaches).toBe(2)
      expect(peer.received.filter(({ request }) => request.method === "tool.finish")).toHaveLength(1)
      yield* controller.settle
      yield* secondAttachment.detach()
      yield* Scope.close(secondScope, Exit.void)
      yield* controller.endGeneration
      yield* controller.shutdown
    }),
  ),
)

it.live("replays a replacement intent started while disconnected", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, { attached: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)

      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const replacing = yield* controller.controls
        .attach({ tools: [replacement] })
        .pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      const secondScope = yield* Scope.make()
      const second = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(secondScope))
      const secondAttachment = yield* controller.connect(second)
      yield* Fiber.join(replacing)

      expect(
        peer.received
          .filter(({ request }) => request.method === "tool.attach")
          .map(({ request }) => request.params),
      ).toEqual([
        { tools: [registration] },
        { tools: [replacement] },
        { tools: [replacement] },
      ])
      yield* secondAttachment.detach()
      yield* Scope.close(secondScope, Exit.void)
    }),
  ),
)

it.live("preserves a replacement intent when its acknowledgement is lost", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const replacementInvocation = {
        ...invocation,
        id: "tool_2",
        name: "search",
        context: { ...invocation.context, callID: "call_search" },
      }
      const firstReplacement = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) {
            notify(socket, "tool.invocation", replacementInvocation)
            Deferred.doneUnsafe(firstReplacement, Effect.void)
            socket.close()
            return
          }
          if (attaches === 3) notify(socket, "tool.invocation", replacementInvocation)
          sendResult(socket, request, { attached: true })
          return
        }
        sendResult(socket, request, { ok: true })
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          void peer.stop()
        }),
      )
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })

      const replacing = yield* controller.controls
        .attach({ tools: [replacement] })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(firstReplacement)
      yield* first.closed
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const secondScope = yield* Scope.make()
      const second = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(secondScope))
      const secondAttachment = yield* controller.connect(second)
      yield* Fiber.join(replacing)
      const call = yield* controller.controls.take("call_search")
      yield* call.fail("finished")

      expect(
        peer.received
          .filter(({ request }) => request.method === "tool.attach")
          .map(({ request }) => request.params),
      ).toEqual([
        { tools: [registration] },
        { tools: [replacement] },
        { tools: [replacement] },
        { tools: [replacement] },
      ])
      yield* secondAttachment.detach()
      yield* Scope.close(secondScope, Exit.void)
      yield* controller.endGeneration
      yield* controller.shutdown
    }),
  ),
)

it.live("restores the acknowledged set after a rejected replacement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          sendError(socket, request, "replacement rejected")
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      expect(
        yield* controller.controls.attach({ tools: [replacement] }).pipe(Effect.flip),
      ).toMatchObject({ operation: "attach", reason: "rejected" })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const secondScope = yield* Scope.make()
      const second = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(secondScope))
      const secondAttachment = yield* controller.connect(second)

      expect(
        peer.received
          .filter(({ request }) => request.method === "tool.attach")
          .map(({ request }) => request.params),
      ).toEqual([
        { tools: [registration] },
        { tools: [replacement] },
        { tools: [registration] },
      ])
      yield* secondAttachment.detach()
      yield* Scope.close(secondScope, Exit.void)
    }),
  ),
)

it.live("rejects a disconnected replacement without poisoning relaunch", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          sendError(socket, request, "replacement rejected")
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)

      const replacing = yield* controller.controls.attach({ tools: [replacement] }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      const rejectedScope = yield* Scope.make()
      const rejectedBackend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(rejectedScope))
      expect(yield* controller.connect(rejectedBackend).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      expect(yield* Fiber.join(replacing).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      yield* Scope.close(rejectedScope, Exit.void)

      const recoveredScope = yield* Scope.make()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(recoveredScope))
      const recoveredAttachment = yield* controller.connect(recovered)
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [replacement] }, { tools: [registration] }])
      yield* recoveredAttachment.detach()
      yield* Scope.close(recoveredScope, Exit.void)
    }),
  ),
)

it.live("rejects malformed lifecycle acknowledgements without retrying", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, { attached: "invalid" }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      const attachment = yield* controller.connect(backend)

      expect(
        yield* controller.controls.attach({ tools: [registration] }).pipe(Effect.flip),
      ).toMatchObject({ operation: "attach", reason: "rejected" })
      expect(peer.received.filter(({ request }) => request.method === "tool.attach")).toHaveLength(1)
      yield* attachment.detach()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      yield* controller.connect(recovered)
      expect(peer.received.filter(({ request }) => request.method === "tool.attach")).toHaveLength(1)
    }),
  ),
)

it.live("rejects a malformed disconnected replacement and restores the acknowledged set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          sendResult(socket, request, { attached: "invalid" })
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)

      const replacing = yield* controller.controls.attach({ tools: [replacement] }).pipe(Effect.forkScoped)
      const rejectedScope = yield* Scope.make()
      const rejected = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(rejectedScope))
      expect(yield* controller.connect(rejected).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      expect(yield* Fiber.join(replacing).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      yield* Scope.close(rejectedScope, Exit.void)

      const recoveredScope = yield* Scope.make()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(recoveredScope))
      const recoveredAttachment = yield* controller.connect(recovered)
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [replacement] }, { tools: [registration] }])
      yield* recoveredAttachment.detach()
      yield* Scope.close(recoveredScope, Exit.void)
    }),
  ),
)

it.live("rejects a disconnected replacement after an invalid protocol response", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          socket.send("not-json")
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)

      const replacing = yield* controller.controls
        .attach({ tools: [replacement] })
        .pipe(Effect.forkScoped)
      const rejectedScope = yield* Scope.make()
      const rejected = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(rejectedScope))
      expect(yield* controller.connect(rejected).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      expect(yield* Fiber.join(replacing).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      yield* Scope.close(rejectedScope, Exit.void)
    }),
  ),
)

it.live("drains queued invocations before reporting settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) notify(socket, "tool.invocation", invocation)
          sendResult(socket, request, { attached: true })
          return
        }
        sendResult(socket, request, { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })

      expect(yield* controller.settle.pipe(Effect.flip)).toMatchObject({
        operation: "take",
        reason: "rejected",
        message: expect.stringContaining("1 dynamic tool invocation"),
      })
      const call = yield* controller.controls.take("call_lookup")
      yield* call.fail("finished")
      yield* controller.settle
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [] }])
    }),
  ),
)

it.live("rolls interrupted replacement history back to the acknowledged set", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const interruptedStarted = yield* Deferred.make<void>()
      const interrupted = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const rejected = {
        ...registration,
        name: "fetch",
        description: "Fetch a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) {
            Deferred.doneUnsafe(interruptedStarted, Effect.void)
            return
          }
          if (attaches === 3) {
            sendError(socket, request, "replacement rejected")
            return
          }
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })

      const replacing = yield* controller.controls.attach({ tools: [interrupted] }).pipe(Effect.forkScoped)
      yield* Deferred.await(interruptedStarted)
      yield* Fiber.interrupt(replacing)
      expect(yield* controller.controls.attach({ tools: [rejected] }).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "rejected",
      })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)

      const recoveredScope = yield* Scope.make()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(recoveredScope))
      const recoveredAttachment = yield* controller.connect(recovered)
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [interrupted] }, { tools: [rejected] }, { tools: [registration] }])
      yield* recoveredAttachment.detach()
      yield* Scope.close(recoveredScope, Exit.void)
    }),
  ),
)

it.live("fails settlement after the inbound event stream fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, { attached: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      notify(peer.received[0].socket, "tool.invocation", {
        ...invocation,
        id: 1,
      })
      const streamFailure = yield* controller.failure.pipe(Effect.flip)

      expect(yield* controller.settle.pipe(Effect.flip)).toEqual(streamFailure)
      expect(peer.received.filter(({ request }) => request.method === "tool.attach")).toHaveLength(1)
    }),
  ),
)

it.live("settles without a backend after its generation ends", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, { attached: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backendScope = yield* Scope.make()
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(backendScope))
      const controller = yield* ToolProducer.make(new Set())
      const attachment = yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      yield* attachment.detach()
      yield* Scope.close(backendScope, Exit.void)
      yield* controller.endGeneration

      yield* controller.settle
    }),
  ),
)

it.live("settles when the generation ends during its clear request", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const clearStarted = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          Deferred.doneUnsafe(clearStarted, Effect.void)
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backendScope = yield* Scope.make()
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(backendScope))
      const controller = yield* ToolProducer.make(new Set())
      const attachment = yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })

      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      yield* Deferred.await(clearStarted)
      yield* attachment.detach()
      yield* controller.endGeneration
      yield* Scope.close(backendScope, Exit.void)

      yield* Fiber.join(settling)
    }),
  ),
)

it.live("reconnects when the backend disconnects during settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const clearInterrupted = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          Deferred.doneUnsafe(clearInterrupted, Effect.void)
          socket.close()
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          void peer.stop()
        }),
      )
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })

      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      yield* Deferred.await(clearInterrupted)
      yield* first.closed
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const recoveredScope = yield* Scope.make()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(recoveredScope))
      const recoveredAttachment = yield* controller.connect(recovered)

      yield* Fiber.join(settling)
      expect(
        peer.received
          .filter(({ request }) => request.method === "tool.attach")
          .map(({ request }) => request.params),
      ).toEqual([
        { tools: [registration] },
        { tools: [] },
        { tools: [] },
        { tools: [] },
      ])
      yield* recoveredAttachment.detach()
      yield* Scope.close(recoveredScope, Exit.void)
    }),
  ),
)

it.live("retries the final event barrier after a disconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let flushes = 0
      const finalBarrierStarted = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, { attached: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const blocked = {
        ...first,
        flushToolEvents: () => {
          flushes++
          return flushes === 2
            ? Deferred.succeed(finalBarrierStarted, undefined).pipe(
                Effect.andThen(Effect.never),
              )
            : first.flushToolEvents()
        },
      }
      const firstAttachment = yield* controller.connect(blocked)
      yield* controller.controls.attach({ tools: [registration] })

      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      yield* Deferred.await(finalBarrierStarted)
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      yield* Effect.yieldNow
      expect(settling.pollUnsafe()).toBeUndefined()

      const recoveredScope = yield* Scope.make()
      const recovered = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(recoveredScope))
      const recoveredAttachment = yield* controller.connect(recovered)
      yield* Fiber.join(settling)
      expect(
        peer.received
          .filter(({ request }) => request.method === "tool.attach")
          .map(({ request }) => request.params),
      ).toEqual([
        { tools: [registration] },
        { tools: [] },
        { tools: [] },
      ])
      yield* recoveredAttachment.detach()
      yield* Scope.close(recoveredScope, Exit.void)
    }),
  ),
)

it.live("rejects a backend connection after terminal settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, { attached: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const controller = yield* ToolProducer.make(new Set())
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      yield* controller.endGeneration
      yield* controller.settle

      const nextScope = yield* Scope.make()
      const next = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(nextScope))
      expect(yield* controller.connect(next).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "controller-closed",
      })
      expect(peer.received.filter(({ request }) => request.method === "tool.attach")).toHaveLength(1)
      yield* Scope.close(nextScope, Exit.void)
    }),
  ),
)

it.effect("closes take waiters and backend creation after settlement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolProducer.make(new Set())
      const waiting = yield* controller.controls.take().pipe(Effect.forkScoped)
      yield* controller.settle

      expect(yield* Fiber.join(waiting).pipe(Effect.flip)).toMatchObject({
        operation: "take",
        reason: "controller-closed",
      })
      expect(yield* controller.controls.take().pipe(Effect.flip)).toMatchObject({
        operation: "take",
        reason: "controller-closed",
      })
      let evaluated = false
      const backend = Effect.sync(() => {
        evaluated = true
        throw new Error("backend factory was evaluated")
      })
      expect(yield* controller.connectFrom(backend).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "controller-closed",
      })
      expect(evaluated).toBe(false)
    }),
  ),
)

it.live("settles after a backend connection that was already in progress", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replayStarted = yield* Deferred.make<void>()
      const clearStarted = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) {
            Deferred.doneUnsafe(replayStarted, Effect.void)
            return
          }
          if (attaches === 3) Deferred.doneUnsafe(clearStarted, Effect.void)
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      yield* firstAttachment.detach()
      yield* controller.endGeneration
      yield* Scope.close(firstScope, Exit.void)

      const nextScope = yield* Scope.make()
      const next = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(nextScope))
      const connecting = yield* controller.connect(next).pipe(Effect.forkScoped)
      yield* Deferred.await(replayStarted)
      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      const replay = peer.received.filter(({ request }) => request.method === "tool.attach")[1]
      if (replay === undefined) return yield* Effect.die(new Error("missing replay attachment request"))
      sendResult(replay.socket, replay.request, { attached: true })
      yield* Deferred.await(clearStarted)

      const nextAttachment = yield* Fiber.join(connecting)
      yield* Fiber.join(settling)
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [registration] }, { tools: [] }])
      yield* nextAttachment.detach()
      yield* Scope.close(nextScope, Exit.void)
    }),
  ),
)

it.live("drains a reconnect that finishes during settlement commit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      let flushes = 0
      const firstDrained = yield* Deferred.make<void>()
      const releaseDrain = yield* Deferred.make<void>()
      const staleInvocation = {
        ...invocation,
        id: "tool_stale",
        context: { ...invocation.context, callID: "call_stale" },
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 3) notify(socket, "tool.invocation", staleInvocation)
        }
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const blocked = {
        ...first,
        flushToolEvents: () => {
          flushes++
          return first.flushToolEvents().pipe(
            Effect.andThen(
              flushes === 1
                ? Deferred.succeed(firstDrained, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseDrain)),
                  )
                : Effect.void,
            ),
          )
        },
      }
      const firstAttachment = yield* controller.connect(blocked)
      yield* controller.controls.attach({ tools: [registration] })

      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      yield* Deferred.await(firstDrained)
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const nextScope = yield* Scope.make()
      const next = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(nextScope))
      const nextAttachment = yield* controller.connect(next)
      yield* Deferred.succeed(releaseDrain, undefined)

      expect(yield* Fiber.join(settling).pipe(Effect.flip)).toMatchObject({
        operation: "take",
        reason: "rejected",
        message: expect.stringContaining("1 dynamic tool invocation"),
      })
      const stale = yield* controller.controls.take("call_stale")
      yield* stale.fail("finished")
      yield* controller.settle
      yield* nextAttachment.detach()
      yield* Scope.close(nextScope, Exit.void)
    }),
  ),
)

it.live("serializes settlement after interrupting an in-flight replacement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacementStarted = yield* Deferred.make<void>()
      const clearStarted = yield* Deferred.make<void>()
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach") {
          attaches++
          if (attaches === 2) {
            Deferred.doneUnsafe(replacementStarted, Effect.void)
            return
          }
          if (attaches === 3) Deferred.doneUnsafe(clearStarted, Effect.void)
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })

      const replacing = yield* controller.controls.attach({ tools: [replacement] }).pipe(Effect.forkScoped)
      yield* Deferred.await(replacementStarted)
      const settling = yield* controller.settle.pipe(Effect.forkScoped)
      yield* Deferred.await(clearStarted)

      expect(yield* Fiber.join(replacing).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "controller-closed",
      })
      yield* Fiber.join(settling)
      expect(
        peer.received.filter(({ request }) => request.method === "tool.attach").map(({ request }) => request.params),
      ).toEqual([{ tools: [registration] }, { tools: [replacement] }, { tools: [] }])
    }),
  ),
)

it.live("releases a disconnected replacement when its generation ends", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let attaches = 0
      const replacementStarted = yield* Deferred.make<void>()
      const replacement = {
        ...registration,
        name: "search",
        description: "Search for a value",
      }
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.attach" && ++attaches === 2) {
          Deferred.doneUnsafe(replacementStarted, Effect.void)
          socket.close()
          return
        }
        sendResult(socket, request, { attached: true })
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          void peer.stop()
        }),
      )
      const backendScope = yield* Scope.make()
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(backendScope))
      const controller = yield* ToolProducer.make(new Set())
      const attachment = yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })

      const replacing = yield* controller.controls.attach({ tools: [replacement] }).pipe(Effect.forkScoped)
      yield* Deferred.await(replacementStarted)
      yield* backend.closed
      yield* attachment.detach()
      yield* Scope.close(backendScope, Exit.void)
      yield* controller.endGeneration
      yield* controller.settle

      expect(yield* Fiber.join(replacing).pipe(Effect.flip)).toMatchObject({
        operation: "attach",
        reason: "controller-closed",
      })
    }),
  ),
)

it.effect("rejects a malformed take call ID", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const controller = yield* ToolProducer.make(new Set())
      expect(
        yield* controller.controls.take(null as unknown as string).pipe(Effect.flip),
      ).toMatchObject({ operation: "take", reason: "rejected" })
    }),
  ),
)

it.live("retries in-flight progress after reconnect without advancing its sequence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let updates = 0
      const firstUpdate = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.update" && ++updates === 1) {
          Deferred.doneUnsafe(firstUpdate, Effect.void)
          socket.close()
          return
        }
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true })
      })
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          // Bun does not resolve server.stop after this peer initiates a WebSocket close.
          void peer.stop()
        }),
      )
      const controller = yield* ToolProducer.make(new Set())
      const firstScope = yield* Scope.make()
      const first = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(firstScope))
      const firstAttachment = yield* controller.connect(first)
      yield* controller.controls.attach({ tools: [registration] })
      notify(peer.received[0].socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")

      const progress = yield* call
        .progress({ structured: { phase: "searching" } })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(firstUpdate)
      yield* first.closed
      yield* firstAttachment.detach()
      yield* Scope.close(firstScope, Exit.void)
      const secondScope = yield* Scope.make()
      const second = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      }).pipe(Scope.provide(secondScope))
      const secondAttachment = yield* controller.connect(second)
      yield* Fiber.join(progress)
      yield* call.fail("finished")

      expect(
        peer.received.filter(({ request }) => request.method === "tool.update").map(({ request }) => request.params),
      ).toEqual([
        {
          id: "tool_1",
          sequence: 0,
          update: { structured: { phase: "searching" } },
        },
        {
          id: "tool_1",
          sequence: 0,
          update: { structured: { phase: "searching" } },
        },
      ])
      yield* secondAttachment.detach()
      yield* Scope.close(secondScope, Exit.void)
      yield* controller.endGeneration
      yield* controller.shutdown
    }),
  ),
)

it.live("does not retry progress interrupted by its caller", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const updateReceived = yield* Deferred.make<void>()
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "tool.update") {
          Deferred.doneUnsafe(updateReceived, Effect.void)
          return
        }
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      notify(peer.received[0].socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")

      const progress = yield* call
        .progress({ structured: { phase: "searching" } })
        .pipe(Effect.forkScoped)
      yield* Deferred.await(updateReceived)
      yield* Fiber.interrupt(progress)
      yield* call.fail("finished")

      expect(peer.received.filter(({ request }) => request.method === "tool.update")).toHaveLength(1)
    }),
  ),
)

it.live("rejects malformed progress without advancing its sequence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) =>
        sendResult(socket, request, request.method === "tool.attach" ? { attached: true } : { ok: true }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set())
      yield* controller.connect(backend)
      yield* controller.controls.attach({ tools: [registration] })
      notify(peer.received[0].socket, "tool.invocation", invocation)
      const call = yield* controller.controls.take("call_lookup")

      const malformed = { structured: [] } as unknown as Progress
      expect(yield* call.progress(malformed).pipe(Effect.flip)).toMatchObject({
        operation: "progress",
        reason: "rejected",
        callID: "call_lookup",
      })
      yield* call.progress({ structured: { phase: "valid" } })
      yield* call.fail("finished")

      expect(
        peer.received.filter(({ request }) => request.method === "tool.update").map(({ request }) => request.params),
      ).toEqual([
        {
          id: "tool_1",
          sequence: 0,
          update: { structured: { phase: "valid" } },
        },
      ])
    }),
  ),
)

it.live("rejects dynamic names that collide with static adapters", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, { attached: true }))
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const backend = yield* SimulationConnector.backend(peer.url, {
        attach: false,
      })
      const controller = yield* ToolProducer.make(new Set(["shell"]))
      yield* controller.connect(backend)

      expect(
        yield* controller.controls
          .attach({
            tools: [{ ...registration, name: "shell" }],
          })
          .pipe(Effect.flip),
      ).toMatchObject({
        operation: "attach",
        reason: "rejected",
        message: expect.stringContaining("static adapter: shell"),
      })
      expect(peer.received).toEqual([])
    }),
  ),
)
