import type { MessagePortMain, WebContents } from "electron"
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { RpcMessage, RpcServer } from "effect/rpc"
import type { DesktopEvent } from "../shared/ipc-rpc/events"
import { setIpcEventSink } from "./ipc-events"
import {
  createIpcTransportState,
  selectBoundClientId,
  selectBoundEventQueue,
  selectClientEventQueue,
  selectClientIds,
  selectClientPort,
  selectClientSender,
  transitionIpcTransport,
  type IpcTransportCommand,
  type IpcTransportEvent,
} from "./ipc-machine"

type Handoff = {
  /** Holds a window's events from now until its next document binds a port; call when a document starts loading. */
  readonly prepare: (sender: WebContents) => void
  readonly bind: (sender: WebContents, port: MessagePortMain) => void
  readonly sender: (clientId: number) => WebContents | undefined
  /** The event queue a client's `DesktopEvents` stream reads; none once its document is unloading. */
  readonly events: (clientId: number) => Queue.Queue<DesktopEvent> | undefined
  /** Whether the client is the one receiving the sender's events, rather than a document it replaced. */
  readonly isCurrentClient: (sender: WebContents, clientId: number) => boolean
  /** Runs when a renderer stops receiving events: its port closed, or its document unloads or was replaced. */
  readonly onDisconnect: (listener: (clientId: number) => void) => () => void
}

export class IpcPortHandoff extends Context.Service<IpcPortHandoff, Handoff>()("opencode/desktop/IpcPortHandoff") {}

type TransportEvent = IpcTransportEvent<WebContents, MessagePortMain, Queue.Queue<DesktopEvent>, DesktopEvent>

type TransportCommand = IpcTransportCommand<WebContents, MessagePortMain, Queue.Queue<DesktopEvent>, DesktopEvent>

type PortListeners = { readonly onMessage: (event: Electron.MessageEvent) => void; readonly onClose: () => void }

// Messages cross the port by structured clone, like Effect's worker protocol: no serialization
// layer, so binary payloads stay binary and nothing is packed into a shared buffer. Electron's
// MessagePortMain can only transfer ports, so byte payloads are cloned in both directions.
export const IpcServerProtocolLive = Layer.unwrap(
  Effect.gen(function* () {
    const runSync = Effect.runSyncWith(yield* Effect.context())
    const disconnects = yield* Queue.unbounded<number>()
    const inbound = yield* Queue.unbounded<readonly [number, RpcMessage.FromClientEncoded]>()
    const disconnected = new Set<(clientId: number) => void>()
    const senderListeners = new Map<number, () => void>()
    const portListeners = new Map<MessagePortMain, PortListeners>()
    let state = createIpcTransportState<WebContents, MessagePortMain, Queue.Queue<DesktopEvent>, DesktopEvent>()

    const dispatch = (event: TransportEvent) => {
      const next = transitionIpcTransport(state, event)
      // Commit first: disconnect listeners (deep links) emit events that read the new state.
      state = next.state
      next.commands.forEach(perform)
    }

    const perform = (command: TransportCommand) => {
      switch (command.type) {
        case "watch-sender": {
          const onDestroyed = () => dispatch({ type: "sender.destroyed", senderId: command.senderId })
          senderListeners.set(command.senderId, onDestroyed)
          command.sender.once("destroyed", onDestroyed)

          return
        }

        case "unwatch-sender": {
          const onDestroyed = senderListeners.get(command.senderId)
          senderListeners.delete(command.senderId)

          if (onDestroyed) command.sender.off("destroyed", onDestroyed)

          return
        }

        case "attach-port": {
          const listeners = {
            onMessage: (event: Electron.MessageEvent) => {
              // SAFETY: the other end of this port is the renderer's ipc-client, which posts only RPC client
              // messages; the RPC server decodes each request's payload with that RPC's schema.
              Queue.offerUnsafe(inbound, [command.clientId, event.data as RpcMessage.FromClientEncoded] as const)
            },
            onClose: () => dispatch({ type: "client.closed", clientId: command.clientId }),
          }

          portListeners.set(command.port, listeners)
          command.port.on("message", listeners.onMessage)
          command.port.on("close", listeners.onClose)
          command.port.start()

          return
        }

        case "close-port": {
          // Detach before closing so the port's own close event does not dispatch again.
          const listeners = portListeners.get(command.port)
          portListeners.delete(command.port)

          if (listeners) {
            command.port.off("message", listeners.onMessage)
            command.port.off("close", listeners.onClose)
          }

          command.port.close()

          return
        }

        case "offer-events":
          return void Queue.offerAllUnsafe(command.events, command.items)

        case "shutdown-events":
          return void runSync(Queue.shutdown(command.events))

        case "notify-disconnect":
          return disconnected.forEach((listener) => listener(command.clientId))

        case "end-client":
          return void Queue.offerUnsafe(disconnects, command.clientId)
      }
    }

    const protocol = yield* RpcServer.Protocol.make(
      Effect.fnUntraced(function* (writeRequest) {
        yield* Stream.fromQueue(inbound).pipe(
          Stream.runForEach(([id, message]) => (selectClientPort(state, id) ? writeRequest(id, message) : Effect.void)),
          Effect.forkScoped,
        )

        return {
          codecFor: Schema.toCodecJson,
          disconnects,
          send: (clientId, response) =>
            Effect.sync(() => {
              selectClientPort(state, clientId)?.postMessage(response)
            }),
          end: (clientId) => Effect.sync(() => dispatch({ type: "client.closed", clientId })),
          clientIds: Effect.sync(() => selectClientIds(state)),
          initialMessage: Effect.succeed(Option.none()),
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: false,
          supportsNotifications: true,
        }
      }),
    )

    const clearSink = setIpcEventSink((sender, event) => {
      const queue = selectBoundEventQueue(state, sender.id)

      if (queue) return Queue.offerUnsafe(queue, event)
      const before = state
      dispatch({ type: "event.emitted", senderId: sender.id, event })

      // Held for a document that has not bound its port yet.
      return state !== before
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearSink()
        dispatch({ type: "disposed" })
      }),
    )

    return Layer.merge(
      Layer.succeed(RpcServer.Protocol)(protocol),
      Layer.succeed(IpcPortHandoff)({
        prepare: (sender) => {
          if (!sender.isDestroyed()) dispatch({ type: "sender.prepared", senderId: sender.id, sender })
        },
        bind: (sender, port) => {
          // A destroyed window already released whatever it held.
          if (sender.isDestroyed()) return port.close()
          dispatch({ type: "port.bound", senderId: sender.id, sender, port, events: runSync(Queue.unbounded()) })
        },
        sender: (clientId) => selectClientSender(state, clientId),
        events: (clientId) => selectClientEventQueue(state, clientId),
        isCurrentClient: (sender, clientId) => selectBoundClientId(state, sender.id) === clientId,
        onDisconnect: (listener) => {
          disconnected.add(listener)

          return () => {
            disconnected.delete(listener)
          }
        },
      }),
    )
  }),
)
