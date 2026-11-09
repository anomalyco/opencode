/** Caps the events held for a window whose renderer has not bound its port yet. */
export const MAX_BUFFERED_EVENTS = 1_024

// A window (sender) either waits for its document's port, holding the events sent meanwhile, or is
// bound to one renderer client with a live event queue. While a new document loads, the previous
// document's port drains: it still answers in-flight RPCs (pagehide storage flushes) but receives
// no events.
export type IpcSender<Sender, Port, Events, Item> =
  | {
      readonly status: "awaiting-port"
      readonly sender: Sender
      readonly buffered: readonly Item[]
      readonly draining: { readonly clientId: number; readonly port: Port } | undefined
    }
  | {
      readonly status: "bound"
      readonly sender: Sender
      readonly clientId: number
      readonly port: Port
      readonly events: Events
    }

export type IpcTransportState<Sender, Port, Events, Item> =
  | {
      readonly status: "open"
      readonly nextClientId: number
      readonly senders: ReadonlyMap<number, IpcSender<Sender, Port, Events, Item>>
      /** Index from each bound or draining client to its sender. */
      readonly clients: ReadonlyMap<number, number>
    }
  | { readonly status: "disposed" }

export type IpcTransportEvent<Sender, Port, Events, Item> =
  | { readonly type: "sender.prepared"; readonly senderId: number; readonly sender: Sender }
  | { readonly type: "event.emitted"; readonly senderId: number; readonly event: Item }
  | {
      readonly type: "port.bound"
      readonly senderId: number
      readonly sender: Sender
      readonly port: Port
      readonly events: Events
    }
  | { readonly type: "client.closed"; readonly clientId: number }
  | { readonly type: "sender.destroyed"; readonly senderId: number }
  | { readonly type: "disposed" }

export type IpcTransportCommand<Sender, Port, Events, Item> =
  | { readonly type: "watch-sender"; readonly senderId: number; readonly sender: Sender }
  | { readonly type: "unwatch-sender"; readonly senderId: number; readonly sender: Sender }
  | { readonly type: "attach-port"; readonly clientId: number; readonly port: Port }
  | { readonly type: "close-port"; readonly port: Port }
  | { readonly type: "offer-events"; readonly events: Events; readonly items: readonly Item[] }
  | { readonly type: "shutdown-events"; readonly events: Events }
  /** Tells `onDisconnect` listeners the client no longer receives events. */
  | { readonly type: "notify-disconnect"; readonly clientId: number }
  /** Tells the RPC server the client is gone, interrupting its requests. */
  | { readonly type: "end-client"; readonly clientId: number }

export type IpcTransportTransition<Sender, Port, Events, Item> = {
  readonly state: IpcTransportState<Sender, Port, Events, Item>
  readonly commands: readonly IpcTransportCommand<Sender, Port, Events, Item>[]
}

export function createIpcTransportState<Sender, Port, Events, Item>(): IpcTransportState<Sender, Port, Events, Item> {
  return { status: "open", nextClientId: 0, senders: new Map(), clients: new Map() }
}

export function transitionIpcTransport<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  event: IpcTransportEvent<Sender, Port, Events, Item>,
): IpcTransportTransition<Sender, Port, Events, Item> {
  if (state.status === "disposed") {
    // A port handed over during shutdown has no server to talk to.
    if (event.type === "port.bound")
      return {
        state,
        commands: [
          { type: "close-port", port: event.port },
          { type: "shutdown-events", events: event.events },
        ],
      }

    return { state, commands: [] }
  }

  switch (event.type) {
    case "sender.prepared": {
      const current = state.senders.get(event.senderId)

      if (current?.status === "awaiting-port") return { state, commands: [] }

      if (!current)
        return {
          state: withSender(state, event.senderId, awaiting(event.sender, undefined)),
          commands: [{ type: "watch-sender", senderId: event.senderId, sender: event.sender }],
        }

      // The bound document is unloading: its events stop now, its port drains until it closes.
      return {
        state: withSender(
          state,
          event.senderId,
          awaiting(current.sender, { clientId: current.clientId, port: current.port }),
        ),
        commands: [
          { type: "shutdown-events", events: current.events },
          { type: "notify-disconnect", clientId: current.clientId },
        ],
      }
    }

    case "event.emitted": {
      const current = state.senders.get(event.senderId)

      // Bound senders take events straight from `selectBoundEventQueue`, without a transition.
      if (current?.status !== "awaiting-port" || current.buffered.length >= MAX_BUFFERED_EVENTS)
        return { state, commands: [] }

      return {
        state: withSender(state, event.senderId, { ...current, buffered: [...current.buffered, event.event] }),
        commands: [],
      }
    }

    case "port.bound": {
      const current = state.senders.get(event.senderId)
      const clientId = state.nextClientId
      const clients = new Map(state.clients)
      const released = current?.status === "bound" ? current.clientId : current?.draining?.clientId

      if (released !== undefined) clients.delete(released)
      clients.set(clientId, event.senderId)

      const senders = new Map(state.senders)
      senders.set(event.senderId, {
        status: "bound",
        sender: current?.sender ?? event.sender,
        clientId,
        port: event.port,
        events: event.events,
      })

      return {
        state: { status: "open", nextClientId: clientId + 1, senders, clients },
        commands: [
          ...(current
            ? release(current)
            : [{ type: "watch-sender" as const, senderId: event.senderId, sender: event.sender }]),
          { type: "attach-port", clientId, port: event.port },
          ...(current?.status === "awaiting-port" && current.buffered.length > 0
            ? [{ type: "offer-events" as const, events: event.events, items: current.buffered }]
            : []),
        ],
      }
    }

    case "client.closed": {
      const senderId = state.clients.get(event.clientId)
      const current = senderId === undefined ? undefined : state.senders.get(senderId)

      if (senderId === undefined || !current) return { state, commands: [] }

      const clients = new Map(state.clients)
      clients.delete(event.clientId)

      // A draining port closing leaves the window waiting for its new document, events kept.
      if (current.status === "awaiting-port")
        return {
          state: {
            ...state,
            senders: new Map(state.senders).set(senderId, { ...current, draining: undefined }),
            clients,
          },
          commands: release(current),
        }

      const senders = new Map(state.senders)
      senders.delete(senderId)

      return {
        state: { ...state, senders, clients },
        commands: [
          ...release<Sender, Port, Events, Item>(current),
          { type: "unwatch-sender", senderId, sender: current.sender },
        ],
      }
    }

    case "sender.destroyed": {
      const current = state.senders.get(event.senderId)

      if (!current) return { state, commands: [] }

      const senders = new Map(state.senders)
      senders.delete(event.senderId)
      const clients = new Map(state.clients)
      const clientId = current.status === "bound" ? current.clientId : current.draining?.clientId

      if (clientId !== undefined) clients.delete(clientId)

      return {
        state: { ...state, senders, clients },
        commands: [...release(current), { type: "unwatch-sender", senderId: event.senderId, sender: current.sender }],
      }
    }

    case "disposed":
      return {
        state: { status: "disposed" },
        commands: [...state.senders].flatMap(([senderId, current]) => [
          ...release(current),
          { type: "unwatch-sender" as const, senderId, sender: current.sender },
        ]),
      }
  }
}

/** The event queue of a sender's bound renderer; read on every `emitIpcEvent`, so it allocates nothing. */
export function selectBoundEventQueue<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  senderId: number,
) {
  if (state.status !== "open") return
  const current = state.senders.get(senderId)

  return current?.status === "bound" ? current.events : undefined
}

/** The event queue a client streams; none for a draining client, so an unloading document never reads its successor's events. */
export function selectClientEventQueue<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  clientId: number,
) {
  const current = senderOf(state, clientId)

  return current?.status === "bound" && current.clientId === clientId ? current.events : undefined
}

/** The port of a bound or draining client, which still answers its RPCs. */
export function selectClientPort<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  clientId: number,
) {
  const current = senderOf(state, clientId)

  if (current?.status === "bound") return current.port

  return current?.draining?.port
}

export function selectClientSender<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  clientId: number,
) {
  return senderOf(state, clientId)?.sender
}

/** The client that receives a sender's events, if its current document has bound one. */
export function selectBoundClientId<Sender, Port, Events, Item>(
  state: IpcTransportState<Sender, Port, Events, Item>,
  senderId: number,
) {
  if (state.status !== "open") return
  const current = state.senders.get(senderId)

  return current?.status === "bound" ? current.clientId : undefined
}

export function selectClientIds<Sender, Port, Events, Item>(state: IpcTransportState<Sender, Port, Events, Item>) {
  return new Set(state.status === "open" ? state.clients.keys() : [])
}

function senderOf<Sender, Port, Events, Item>(state: IpcTransportState<Sender, Port, Events, Item>, clientId: number) {
  if (state.status !== "open") return
  const senderId = state.clients.get(clientId)

  return senderId === undefined ? undefined : state.senders.get(senderId)
}

function awaiting<Sender, Port, Events, Item>(
  sender: Sender,
  draining: { readonly clientId: number; readonly port: Port } | undefined,
): IpcSender<Sender, Port, Events, Item> {
  return { status: "awaiting-port", sender, buffered: [], draining }
}

function withSender<Sender, Port, Events, Item>(
  state: Extract<IpcTransportState<Sender, Port, Events, Item>, { status: "open" }>,
  senderId: number,
  sender: IpcSender<Sender, Port, Events, Item>,
): IpcTransportState<Sender, Port, Events, Item> {
  return { ...state, senders: new Map(state.senders).set(senderId, sender) }
}

// Disconnects the client a sender holds: a bound client loses its events and its listeners hear
// about it; a draining one already did both when its document started unloading.
function release<Sender, Port, Events, Item>(
  current: IpcSender<Sender, Port, Events, Item>,
): IpcTransportCommand<Sender, Port, Events, Item>[] {
  if (current.status === "bound")
    return [
      { type: "shutdown-events", events: current.events },
      { type: "close-port", port: current.port },
      { type: "notify-disconnect", clientId: current.clientId },
      { type: "end-client", clientId: current.clientId },
    ]

  if (!current.draining) return []

  return [
    { type: "close-port", port: current.draining.port },
    { type: "end-client", clientId: current.draining.clientId },
  ]
}
