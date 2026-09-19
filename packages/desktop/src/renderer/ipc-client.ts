import { Context, Effect, Layer, ManagedRuntime, Queue, Schema, Stream } from "effect"
import { RpcClient, RpcMessage } from "effect/unstable/rpc"
import { DesktopRpcs, type DesktopRpcClient } from "../shared/ipc-rpc"
import type { DesktopEvent } from "../shared/ipc-rpc/events"
import { IpcTransportPort } from "../shared/ipc-transport"

class DesktopClient extends Context.Service<DesktopClient, DesktopRpcClient>()("opencode/desktop/DesktopClient") {}

type EventTag = DesktopEvent["_tag"]
type InvokeTag = Exclude<keyof DesktopRpcClient, "DesktopEvents">
type InvokeArgs<Tag extends InvokeTag> = Parameters<DesktopRpcClient[Tag]>
type InvokeResult<Tag extends InvokeTag> =
  ReturnType<DesktopRpcClient[Tag]> extends Effect.Effect<infer Value, unknown> ? Value : never
type EventValue<Tag extends EventTag> = Extract<DesktopEvent, { readonly _tag: Tag }>

// The renderer asks for its port rather than receiving one on load: the first window's document
// is on screen before its scripts, and before the main process has its IPC layer, exist.
const port = new Promise<MessagePort>((resolve) => {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data !== IpcTransportPort) return
    const value = event.ports[0]
    if (!value) return
    window.removeEventListener("message", onMessage)
    resolve(value)
  }
  window.addEventListener("message", onMessage)
  window.electron.requestRpcPort()
})

const ClientProtocolLive = Layer.unwrap(Effect.promise(() => port).pipe(Effect.map((value) => clientProtocol(value))))
const ClientLive = Layer.effect(DesktopClient, RpcClient.make(DesktopRpcs)).pipe(Layer.provide(ClientProtocolLive))
const runtime = ManagedRuntime.make(ClientLive)
const listeners = new Map<EventTag, Set<(value: unknown) => void>>()
const beforeDispose = new Set<() => Promise<unknown> | void>()
// Let queued work (storage flushes) hand its messages to the port before the runtime goes away.
window.addEventListener(
  "pagehide",
  () => void Promise.allSettled([...beforeDispose].map((callback) => callback())).then(() => runtime.dispose()),
  { once: true },
)

export function onBeforeDispose(callback: () => Promise<unknown> | void) {
  beforeDispose.add(callback)
  return () => beforeDispose.delete(callback)
}

runtime.runFork(
  Effect.gen(function* () {
    const client = yield* DesktopClient
    yield* client
      .DesktopEvents()
      .pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => listeners.get(event._tag)?.forEach((listener) => listener(event))),
        ),
      )
  }),
)

export function invoke<Tag extends InvokeTag>(tag: Tag, ...payload: InvokeArgs<Tag>): Promise<InvokeResult<Tag>> {
  return runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* DesktopClient
      const method = client[tag] as unknown as (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>
      return yield* method(...payload)
    }),
  ) as Promise<InvokeResult<Tag>>
}

export function send<Tag extends InvokeTag>(tag: Tag, ...payload: InvokeArgs<Tag>) {
  void invoke(tag, ...payload).catch(() => undefined)
}

export function listen<Tag extends EventTag>(tag: Tag, listener: (value: EventValue<Tag>) => void) {
  const callback = listener as (value: unknown) => void
  const callbacks = listeners.get(tag) ?? new Set()
  callbacks.add(callback)
  listeners.set(tag, callbacks)
  return () => {
    callbacks.delete(callback)
    if (callbacks.size === 0) listeners.delete(tag)
  }
}

// Structured clone over the port, like Effect's worker protocol: no serialization layer, so binary
// payloads stay binary. Buffers are cloned rather than transferred: Electron's MessagePortMain
// drops transferred ArrayBuffers, so a request carrying one would never arrive.
function clientProtocol(value: MessagePort) {
  return Layer.effect(
    RpcClient.Protocol,
    RpcClient.Protocol.make(
      Effect.fnUntraced(function* (writeResponse, clientIds) {
        const inbound = yield* Queue.unbounded<RpcMessage.FromServerEncoded>()
        const onMessage = (event: MessageEvent) => {
          Queue.offerUnsafe(inbound, event.data as RpcMessage.FromServerEncoded)
        }
        value.addEventListener("message", onMessage)
        value.start()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            value.removeEventListener("message", onMessage)
            value.close()
          }),
        )
        yield* Stream.fromQueue(inbound).pipe(
          Stream.runForEach((message) =>
            Effect.forEach(clientIds, (clientId) => writeResponse(clientId, message), { discard: true }),
          ),
          Effect.forkScoped,
        )
        return {
          codecFor: Schema.toCodecJson,
          send: (_clientId, request) =>
            Effect.sync(() => {
              value.postMessage(request)
            }),
          supportsAck: true,
          supportsTransferables: false,
        }
      }),
    ),
  )
}
