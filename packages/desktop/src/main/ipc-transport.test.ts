import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { MessageChannel } from "node:worker_threads"
import type { MessagePortMain, WebContents } from "electron"
import { Context, Effect, Layer, ManagedRuntime, Option, Queue, Schema, Stream } from "effect"
import { Rpc, RpcClient, RpcClientError, RpcGroup, RpcMessage, RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"

describe("desktop RPC transport", () => {
  test("keeps multiple renderer ports independent", async () => {
    const handlers = TestRpcs.toLayer(
      Effect.gen(function* () {
        const handoff = yield* IpcPortHandoff
        return TestRpcs.of({
          "test.focused": (_request, context) => Effect.succeed(handoff.sender(context.client.id)?.id === 1),
          "test.blob.put": ({ data }) => Effect.succeed([...data].join(",")),
          "test.blob.get": () => Effect.succeed(new Uint8Array([3, 1, 4])),
          "test.events": () => Stream.make(new TestEvent({ value: "session.new" })),
        })
      }),
    )
    const live = RpcServer.layer(TestRpcs).pipe(Layer.provide(handlers), Layer.provideMerge(IpcServerProtocolLive))
    const runtime = ManagedRuntime.make(live)
    const handoff = await runtime.runPromise(IpcPortHandoff)
    const first = new MessageChannel()
    const second = new MessageChannel()
    handoff.bind(sender(1), serverPort(first.port1))
    handoff.bind(sender(2), serverPort(second.port1))
    const firstClient = makeClient(first.port2)
    const secondClient = makeClient(second.port2)

    const [focused, unfocused] = await Promise.all([callFocused(firstClient), callFocused(secondClient)])

    expect(focused).toBe(true)
    expect(unfocused).toBe(false)
    expect(await putBlob(firstClient, new Uint8Array([2, 7, 1]))).toBe("2,7,1")
    expect(await getBlob(firstClient)).toEqual(new Uint8Array([3, 1, 4]))
    expect(await firstEvent(firstClient)).toEqual(new TestEvent({ value: "session.new" }))

    const reloaded = new MessageChannel()
    handoff.bind(sender(1), serverPort(reloaded.port1))
    const reloadedClient = makeClient(reloaded.port2)
    const [reloadedFocused, stillUnfocused] = await Promise.all([
      callFocused(reloadedClient),
      callFocused(secondClient),
    ])
    expect(reloadedFocused).toBe(true)
    expect(stillUnfocused).toBe(false)
    await Promise.all([firstClient.dispose(), secondClient.dispose(), reloadedClient.dispose()])
    await runtime.dispose()
  })
})

class TestEvent extends Schema.TaggedClass<TestEvent>()("TestEvent", { value: Schema.String }) {}
const TestRpcs = RpcGroup.make(
  Rpc.make("test.focused", { success: Schema.Boolean }),
  Rpc.make("test.blob.put", { payload: { data: Schema.Uint8Array }, success: Schema.String }),
  Rpc.make("test.blob.get", { success: Schema.Uint8Array }),
  Rpc.make("test.events", { success: TestEvent, stream: true }),
)
type TestRpcClient = RpcClient.FromGroup<typeof TestRpcs, RpcClientError.RpcClientError>

class TestClient extends Context.Service<TestClient, TestRpcClient>()("opencode/desktop/TestClient") {}

function makeClient(port: MessagePort) {
  return ManagedRuntime.make(
    Layer.effect(TestClient, RpcClient.make(TestRpcs)).pipe(Layer.provide(clientProtocol(port))),
  )
}

function callFocused(runtime: ManagedRuntime.ManagedRuntime<TestClient, never>) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* TestClient
      return yield* client["test.focused"]()
    }),
  )
}

function putBlob(runtime: ManagedRuntime.ManagedRuntime<TestClient, never>, data: Uint8Array) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* TestClient
      return yield* client["test.blob.put"]({ data })
    }),
  )
}

function getBlob(runtime: ManagedRuntime.ManagedRuntime<TestClient, never>) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* TestClient
      return yield* client["test.blob.get"]()
    }),
  )
}

function firstEvent(runtime: ManagedRuntime.ManagedRuntime<TestClient, never>) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* TestClient
      return yield* client["test.events"]().pipe(Stream.runHead, Effect.map(Option.getOrThrow))
    }),
  )
}

function clientProtocol(port: MessagePort) {
  return Layer.effect(
    RpcClient.Protocol,
    RpcClient.Protocol.make(
      Effect.fnUntraced(function* (writeResponse, clientIds) {
        const serialization = yield* RpcSerialization.RpcSerialization
        const parser = serialization.makeUnsafe()
        const inbound = yield* Queue.unbounded<RpcMessage.FromServerEncoded>()
        const onMessage = (event: MessageEvent) =>
          parser
            .decode(event.data)
            .forEach((message) => Queue.offerUnsafe(inbound, message as RpcMessage.FromServerEncoded))
        port.addEventListener("message", onMessage)
        port.start()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            port.removeEventListener("message", onMessage)
            port.close()
          }),
        )
        yield* Stream.fromQueue(inbound).pipe(
          Stream.runForEach((message) =>
            Effect.forEach(clientIds, (clientId) => writeResponse(clientId, message), { discard: true }),
          ),
          Effect.forkScoped,
        )
        return {
          codecFor: serialization.codecFor,
          send: (_clientId: number, request: RpcMessage.FromClientEncoded) =>
            Effect.sync(() => {
              const encoded = parser.encode(request)
              if (encoded !== undefined) port.postMessage(encoded)
            }),
          supportsAck: true,
          supportsTransferables: false,
        }
      }),
    ),
  ).pipe(Layer.provide(RpcSerialization.layerMsgPack))
}

function sender(id: number) {
  const events = new EventEmitter()
  return {
    id,
    isDestroyed: () => false,
    once: events.once.bind(events),
    off: events.off.bind(events),
  } as unknown as WebContents
}

function serverPort(port: import("node:worker_threads").MessagePort) {
  const listeners = new Map<(event: Electron.MessageEvent) => void, (data: unknown) => void>()
  return {
    on(event: string, listener: (event: Electron.MessageEvent) => void) {
      if (event !== "message") {
        port.on(event, listener)
        return
      }
      const wrapped = (data: unknown) => listener({ data } as Electron.MessageEvent)
      listeners.set(listener, wrapped)
      port.on("message", wrapped)
    },
    off(event: string, listener: (event: Electron.MessageEvent) => void) {
      if (event !== "message") {
        port.off(event, listener)
        return
      }
      const wrapped = listeners.get(listener)
      if (wrapped) port.off("message", wrapped)
    },
    postMessage: port.postMessage.bind(port),
    start: port.start.bind(port),
    close: port.close.bind(port),
  } as unknown as MessagePortMain
}
