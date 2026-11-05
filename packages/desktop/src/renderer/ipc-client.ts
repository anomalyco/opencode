import type { Effect } from "effect"
import type { RpcMessage } from "effect/rpc"
import type { DesktopRpcClient } from "../shared/ipc-rpc"
import type { DesktopEvent } from "../shared/ipc-rpc/events"
import { IpcTransportPort, omitUndefined } from "../shared/ipc-transport"
import {
  createIpcClientState,
  PORT_HANDSHAKE_TIMEOUT_MS,
  selectPendingChunk,
  transitionIpcClient,
  type IpcClientCommand,
  type IpcClientEvent,
  type IpcPending,
} from "./ipc-client-machine"

// The main process serves Effect's RpcServer over a MessagePort; this side speaks its wire format
// directly. Messages cross by structured clone (no serialization layer, binary stays binary), every
// payload in the contract is JSON-native or a Uint8Array, and the main process is trusted, so the
// renderer needs neither the Effect runtime nor the contract's schemas to talk to it. Keeping them
// out of the renderer's initial module graph is worth about a third of its startup script.

type EventTag = DesktopEvent["_tag"]

type InvokeTag = Exclude<keyof DesktopRpcClient, "DesktopEvents">

type InvokeArgs<Tag extends InvokeTag> = Parameters<DesktopRpcClient[Tag]>

type InvokeResult<Tag extends InvokeTag> =
  ReturnType<DesktopRpcClient[Tag]> extends Effect.Effect<infer Value, unknown> ? Value : never

type EventValue<Tag extends EventTag> = Extract<DesktopEvent, { readonly _tag: Tag }>

const listeners = new Map<EventTag, Set<(value: DesktopEvent) => void>>()

// SAFETY: pagehide only waits for these callbacks to settle and ignores what they resolve to.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- see SAFETY above
const beforeDispose = new Set<() => Promise<unknown> | void>()

let state = createIpcClientState<MessagePort>()

let nextId = 0

const onWindowMessage = (event: MessageEvent) => {
  if (event.source !== window || event.data !== IpcTransportPort) return
  const value = event.ports[0]

  if (value) dispatch({ type: "port.received", port: value })
}

window.addEventListener("message", onWindowMessage)

const handshakeTimer = setTimeout(() => dispatch({ type: "handshake.timed-out" }), PORT_HANDSHAKE_TIMEOUT_MS)

// Let queued work (storage flushes) hand its messages to the port before it closes.
window.addEventListener(
  "pagehide",
  () =>
    void Promise.allSettled([...beforeDispose].map((callback) => callback())).then(() =>
      dispatch({ type: "disposed" }),
    ),
  { once: true },
)

// The event stream outlives a handshake timeout; only pagehide rejects it, and nobody is left to tell.
request("DesktopEvents", null, (values) => {
  // SAFETY: DesktopEvents streams desktop events, whose encoded fields are JSON-native and read as decoded.
  for (const value of values as ReadonlyArray<DesktopEvent>) listeners.get(value._tag)?.forEach((fn) => fn(value))
}).catch(() => undefined)

// SAFETY: as for `beforeDispose`, the callback's result is only awaited, never read.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- see SAFETY above
export function onBeforeDispose(callback: () => Promise<unknown> | void) {
  beforeDispose.add(callback)

  return () => beforeDispose.delete(callback)
}

export function invoke<Tag extends InvokeTag>(tag: Tag, ...payload: InvokeArgs<Tag>): Promise<InvokeResult<Tag>> {
  // SAFETY: main replies with the success value of `tag`'s RPC; its encoding is JSON-native or bytes, as decoded.
  return request(tag, payload[0] ?? null) as Promise<InvokeResult<Tag>>
}

export function send<Tag extends InvokeTag>(tag: Tag, ...payload: InvokeArgs<Tag>) {
  void invoke(tag, ...payload).catch(() => undefined)
}

/** Like `invoke`, but aborting the signal rejects at once and interrupts the handler in main. */
export function cancellable<Tag extends InvokeTag>(
  tag: Tag,
  payload: InvokeArgs<Tag>[0],
  signal: AbortSignal | undefined,
): Promise<InvokeResult<Tag>> {
  // SAFETY: as in `invoke`, the reply is the success value of `tag`'s RPC.
  return request(tag, payload ?? null, undefined, signal) as Promise<InvokeResult<Tag>>
}

export function listen<Tag extends EventTag>(tag: Tag, listener: (value: EventValue<Tag>) => void) {
  // SAFETY: events dispatch by tag, so this listener only receives `Tag` events.
  const callback = listener as (value: DesktopEvent) => void
  const callbacks = listeners.get(tag) ?? new Set()
  callbacks.add(callback)
  listeners.set(tag, callbacks)

  return () => {
    callbacks.delete(callback)

    if (callbacks.size === 0) listeners.delete(tag)
  }
}

// SAFETY: this side speaks the RPC wire format by hand, whose messages are plain tagged objects. Effect's Match,
// Predicate, and message constructors would load the Effect runtime into the renderer; see the note above.
/* oxlint-disable anti-slop-effect/no-manual-tag-comparison, anti-slop-effect/no-manual-tagged-construction -- see SAFETY above */
function request(
  tag: InvokeTag | "DesktopEvents",
  payload: InvokeArgs<InvokeTag>[0] | null,
  chunk?: IpcPending["chunk"],
  signal?: AbortSignal,
) {
  const id = nextId++

  return new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)

    const abort = () => dispatch({ type: "request.aborted", id, reason: signal?.reason })

    signal?.addEventListener("abort", abort, { once: true })

    const settle =
      <Value>(callback: (value: Value) => void) =>
      (value: Value) => {
        signal?.removeEventListener("abort", abort)
        callback(value)
      }

    dispatch({
      type: "request.started",
      id,
      message: { _tag: "Request", id, tag, payload: omitUndefined(payload), headers: [] },
      entry: { resolve: settle(resolve), reject: settle(reject), chunk },
    })
  })
}

function dispatch(event: IpcClientEvent<MessagePort>) {
  const next = transitionIpcClient(state, event)
  state = next.state
  next.commands.forEach(perform)
}

function perform(command: IpcClientCommand<MessagePort>) {
  switch (command.type) {
    case "cancel-handshake-timer":
      return clearTimeout(handshakeTimer)

    case "unlisten-window":
      return window.removeEventListener("message", onWindowMessage)

    case "attach-port": {
      const port = command.port
      // SAFETY: the port comes from the trusted main process, whose RPC server posts only its own messages.
      port.addEventListener("message", (message) => receive(port, message.data as RpcMessage.FromServerEncoded))
      port.start()

      return
    }

    case "close-port":
      return command.port.close()

    case "post-request":
      return command.port.postMessage(command.message)

    case "post-interrupt":
      return command.port.postMessage({
        _tag: "Interrupt",
        requestId: command.requestId,
      } satisfies RpcMessage.InterruptEncoded)

    case "resolve":
      return command.entry.resolve(command.value)

    case "reject":
      return command.entries.forEach((entry) => entry.reject(command.error))
  }
}

function receive(p: MessagePort, message: RpcMessage.FromServerEncoded) {
  switch (message._tag) {
    case "Chunk": {
      selectPendingChunk(state, Number(message.requestId))?.(message.values)
      p.postMessage({ _tag: "Ack", requestId: message.requestId } satisfies RpcMessage.AckEncoded)

      return
    }

    case "Exit": {
      const exit = message.exit

      return dispatch({
        type: "response.exited",
        id: Number(message.requestId),
        exit: exit._tag === "Success" ? { ok: true, value: exit.value } : { ok: false, error: failure(exit.cause) },
      })
    }

    case "Defect":
      return dispatch({ type: "server.defected", error: new Error("Desktop IPC defect", { cause: message.defect }) })

    case "ClientProtocolError": {
      console.error("[desktop-ipc] protocol error", message.error)

      return
    }
  }
}

// The RPC failure a caller sees is the encoded error the handler failed with, as before; defects
// and interrupts surface as errors.
function failure(cause: ReadonlyArray<{ readonly _tag: string; readonly error?: unknown; readonly defect?: unknown }>) {
  const failed = cause.find((item) => item._tag === "Fail")

  if (failed) return failed.error
  const died = cause.find((item) => item._tag === "Die")

  if (died) return new Error("Desktop IPC handler failed", { cause: died.defect })

  return new Error("Desktop IPC request interrupted")
}
/* oxlint-enable anti-slop-effect/no-manual-tag-comparison, anti-slop-effect/no-manual-tagged-construction */
