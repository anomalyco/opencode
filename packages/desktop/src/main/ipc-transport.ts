import type { MessagePortMain, WebContents } from "electron"
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { RpcMessage, RpcServer } from "effect/unstable/rpc"
import { bindIpcEvents } from "./ipc-events"

type PortBinding = {
  readonly id: number
  readonly sender: WebContents
  readonly port: MessagePortMain
  readonly onMessage: (event: Electron.MessageEvent) => void
  readonly onClose: () => void
  readonly unbindEvents: Effect.Effect<void>
}

type Handoff = {
  readonly bind: (sender: WebContents, port: MessagePortMain) => void
  readonly sender: (clientId: number) => WebContents | undefined
}

export class IpcPortHandoff extends Context.Service<IpcPortHandoff, Handoff>()("opencode/desktop/IpcPortHandoff") {}

// Messages cross the port by structured clone, like Effect's worker protocol: no serialization
// layer, so binary payloads stay binary and nothing is packed into a shared buffer. Electron's
// MessagePortMain can only transfer ports, so byte payloads are cloned in both directions.
export const IpcServerProtocolLive = Layer.unwrap(
  Effect.gen(function* () {
    const handoffs = yield* Queue.unbounded<readonly [WebContents, MessagePortMain]>()
    const bindings = new Map<number, PortBinding>()
    const senderBindings = new Map<number, number>()

    const protocol = Layer.effect(
      RpcServer.Protocol,
      RpcServer.Protocol.make(
        Effect.fnUntraced(function* (writeRequest) {
          const disconnects = yield* Queue.unbounded<number>()
          const inbound = yield* Queue.unbounded<readonly [number, RpcMessage.FromClientEncoded]>()
          const runFork = Effect.runForkWith(yield* Effect.context())
          let nextClientId = 0

          const disconnect = Effect.fnUntraced(function* (id: number) {
            const binding = bindings.get(id)
            if (!binding) return
            bindings.delete(id)
            if (senderBindings.get(binding.sender.id) === id) senderBindings.delete(binding.sender.id)
            binding.port.off("message", binding.onMessage)
            binding.port.off("close", binding.onClose)
            binding.sender.off("destroyed", binding.onClose)
            yield* binding.unbindEvents
            binding.port.close()
            Queue.offerUnsafe(disconnects, id)
          })

          const bind = Effect.fnUntraced(function* (sender: WebContents, port: MessagePortMain) {
            const previous = senderBindings.get(sender.id)
            if (previous !== undefined) yield* disconnect(previous)
            if (sender.isDestroyed()) {
              port.close()
              return
            }

            const id = nextClientId++
            const onMessage = (event: Electron.MessageEvent) => {
              Queue.offerUnsafe(inbound, [id, event.data as RpcMessage.FromClientEncoded] as const)
            }
            const onClose = () => runFork(disconnect(id))
            const unbindEvents = yield* bindIpcEvents(sender.id)
            const binding = { id, sender, port, onMessage, onClose, unbindEvents }
            bindings.set(id, binding)
            senderBindings.set(sender.id, id)
            port.on("message", onMessage)
            port.on("close", onClose)
            sender.once("destroyed", onClose)
            port.start()
          })

          yield* Stream.fromQueue(handoffs).pipe(
            Stream.runForEach(([sender, port]) => bind(sender, port)),
            Effect.forkScoped,
          )
          yield* Stream.fromQueue(inbound).pipe(
            Stream.runForEach(([id, message]) => (bindings.has(id) ? writeRequest(id, message) : Effect.void)),
            Effect.forkScoped,
          )
          yield* Effect.addFinalizer(() => Effect.forEach([...bindings.keys()], disconnect, { discard: true }))

          return {
            codecFor: Schema.toCodecJson,
            disconnects,
            send: (clientId, response) =>
              Effect.sync(() => {
                bindings.get(clientId)?.port.postMessage(response)
              }),
            end: disconnect,
            clientIds: Effect.sync(() => new Set(bindings.keys())),
            initialMessage: Effect.succeed(Option.none()),
            supportsAck: true,
            supportsTransferables: false,
            supportsSpanPropagation: false,
            supportsNotifications: true,
          }
        }),
      ),
    )

    return Layer.merge(
      protocol,
      Layer.succeed(IpcPortHandoff)({
        bind: (sender, port) => {
          Queue.offerUnsafe(handoffs, [sender, port])
        },
        sender: (clientId) => bindings.get(clientId)?.sender,
      }),
    )
  }),
)
