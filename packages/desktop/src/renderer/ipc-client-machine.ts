import type { RpcMessage } from "effect/rpc"

/** How long a renderer waits for main to post its IPC port before failing its requests. */
export const PORT_HANDSHAKE_TIMEOUT_MS = 30_000

export type IpcCloseReason = "timeout" | "disposed"

export type IpcPending = {
  // SAFETY: the reply is the RPC's success value as the trusted main process encoded it; callers narrow it at `invoke`.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  readonly resolve: (value: unknown) => void
  readonly reject: (cause: unknown) => void
  readonly chunk?: (values: ReadonlyArray<unknown>) => void
}

export type IpcQueuedRequest = { readonly id: number; readonly message: RpcMessage.RequestEncoded }

export type IpcClientState<Port> =
  | {
      readonly status: "awaiting-port"
      /** Requests to post, in order, once the port arrives. */
      readonly queued: readonly IpcQueuedRequest[]
      readonly pending: ReadonlyMap<number, IpcPending>
    }
  | { readonly status: "connected"; readonly port: Port; readonly pending: ReadonlyMap<number, IpcPending> }
  | { readonly status: "closed"; readonly reason: IpcCloseReason }

export type IpcExit = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: unknown }

export type IpcClientEvent<Port> =
  | {
      readonly type: "request.started"
      readonly id: number
      readonly message: RpcMessage.RequestEncoded
      readonly entry: IpcPending
    }
  | { readonly type: "request.aborted"; readonly id: number; readonly reason: unknown }
  | { readonly type: "port.received"; readonly port: Port }
  | { readonly type: "handshake.timed-out" }
  | { readonly type: "response.exited"; readonly id: number; readonly exit: IpcExit }
  | { readonly type: "server.defected"; readonly error: unknown }
  | { readonly type: "disposed" }

export type IpcClientCommand<Port> =
  | { readonly type: "cancel-handshake-timer" }
  | { readonly type: "unlisten-window" }
  | { readonly type: "attach-port"; readonly port: Port }
  | { readonly type: "close-port"; readonly port: Port }
  | { readonly type: "post-request"; readonly port: Port; readonly message: RpcMessage.RequestEncoded }
  | { readonly type: "post-interrupt"; readonly port: Port; readonly requestId: number }
  | { readonly type: "resolve"; readonly entry: IpcPending; readonly value: unknown }
  | { readonly type: "reject"; readonly entries: readonly IpcPending[]; readonly error: unknown }

export type IpcClientTransition<Port> = {
  readonly state: IpcClientState<Port>
  readonly commands: readonly IpcClientCommand<Port>[]
}

/** The state a renderer starts in; its driver starts the handshake timer with it. */
export function createIpcClientState<Port>(): IpcClientState<Port> {
  return { status: "awaiting-port", queued: [], pending: new Map() }
}

export function transitionIpcClient<Port>(
  state: IpcClientState<Port>,
  event: IpcClientEvent<Port>,
): IpcClientTransition<Port> {
  if (state.status === "closed") {
    if (event.type === "request.started")
      return { state, commands: [{ type: "reject", entries: [event.entry], error: ipcClosedError(state.reason) }] }

    // Main posted the port after the handshake timed out; closing it releases main's end.
    if (event.type === "port.received") return { state, commands: [{ type: "close-port", port: event.port }] }

    return { state, commands: [] }
  }

  switch (event.type) {
    case "request.started": {
      const pending = new Map(state.pending).set(event.id, event.entry)

      if (state.status === "awaiting-port")
        return {
          state: { ...state, queued: [...state.queued, { id: event.id, message: event.message }], pending },
          commands: [],
        }

      // Posted in this turn, so a pagehide flush reaches the port before the document goes.
      return {
        state: { ...state, pending },
        commands: [{ type: "post-request", port: state.port, message: event.message }],
      }
    }

    case "request.aborted": {
      const entry = state.pending.get(event.id)

      if (!entry) return { state, commands: [] }
      const pending = new Map(state.pending)
      pending.delete(event.id)
      const reject: IpcClientCommand<Port> = { type: "reject", entries: [entry], error: event.reason }

      // A request that never left the renderer is dropped, so main never runs it.
      if (state.status === "awaiting-port")
        return {
          state: { ...state, queued: state.queued.filter((request) => request.id !== event.id), pending },
          commands: [reject],
        }

      return {
        state: { ...state, pending },
        commands: [reject, { type: "post-interrupt", port: state.port, requestId: event.id }],
      }
    }

    case "port.received": {
      if (state.status !== "awaiting-port") return { state, commands: [{ type: "close-port", port: event.port }] }

      return {
        state: { status: "connected", port: event.port, pending: state.pending },
        commands: [
          { type: "cancel-handshake-timer" },
          { type: "unlisten-window" },
          { type: "attach-port", port: event.port },
          ...state.queued.map(
            (request): IpcClientCommand<Port> => ({
              type: "post-request",
              port: event.port,
              message: request.message,
            }),
          ),
        ],
      }
    }

    case "handshake.timed-out": {
      if (state.status !== "awaiting-port") return { state, commands: [] }

      // The window keeps listening, so a port that arrives late is closed rather than left bound in main.
      return { state: { status: "closed", reason: "timeout" }, commands: rejectAll(state.pending, "timeout") }
    }

    case "response.exited": {
      if (state.status !== "connected") return { state, commands: [] }
      const entry = state.pending.get(event.id)

      if (!entry) return { state, commands: [] }
      const pending = new Map(state.pending)
      pending.delete(event.id)

      return {
        state: { ...state, pending },
        commands: [
          event.exit.ok
            ? { type: "resolve", entry, value: event.exit.value }
            : { type: "reject", entries: [entry], error: event.exit.error },
        ],
      }
    }

    case "server.defected": {
      if (state.status !== "connected" || state.pending.size === 0) return { state, commands: [] }

      return {
        state: { ...state, pending: new Map() },
        commands: [{ type: "reject", entries: [...state.pending.values()], error: event.error }],
      }
    }

    case "disposed":
      return {
        state: { status: "closed", reason: "disposed" },
        commands: [
          ...(state.status === "awaiting-port"
            ? [{ type: "cancel-handshake-timer" as const }, { type: "unlisten-window" as const }]
            : [{ type: "close-port" as const, port: state.port }]),
          ...rejectAll<Port>(state.pending, "disposed"),
        ],
      }
  }
}

/** The pending request a streamed chunk belongs to; read on every chunk, so it allocates nothing. */
export function selectPendingChunk<Port>(state: IpcClientState<Port>, requestId: number) {
  return state.status === "closed" ? undefined : state.pending.get(requestId)?.chunk
}

export function ipcClosedError(reason: IpcCloseReason) {
  return new Error(reason === "timeout" ? "Desktop IPC port handshake timed out" : "Desktop IPC connection closed")
}

function rejectAll<Port>(pending: ReadonlyMap<number, IpcPending>, reason: IpcCloseReason): IpcClientCommand<Port>[] {
  if (pending.size === 0) return []

  return [{ type: "reject", entries: [...pending.values()], error: ipcClosedError(reason) }]
}
