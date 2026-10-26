import type { Effect } from "effect"
import type { RpcMessage } from "effect/rpc"
import type { DesktopRpcClient } from "../shared/ipc-rpc"
import type { DesktopEvent } from "../shared/ipc-rpc/events"
import { IpcTransportPort, omitUndefined } from "../shared/ipc-transport"

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

type Pending = {
  // SAFETY: the reply is the RPC's success value as the trusted main process encoded it; see the note above.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  readonly resolve: (value: unknown) => void
  readonly reject: (cause: unknown) => void
  readonly chunk?: (values: ReadonlyArray<unknown>) => void
}

const pending = new Map<number, Pending>()

const listeners = new Map<EventTag, Set<(value: DesktopEvent) => void>>()

// SAFETY: pagehide only waits for these callbacks to settle and ignores what they resolve to.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- see SAFETY above
const beforeDispose = new Set<() => Promise<unknown> | void>()

let nextId = 0

const port = new Promise<MessagePort>((resolve) => {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.data !== IpcTransportPort) return
    const value = event.ports[0]

    if (!value) return
    window.removeEventListener("message", onMessage)
    // SAFETY: the port comes from the trusted main process, whose RPC server posts only its own messages.
    value.addEventListener("message", (message) => receive(value, message.data as RpcMessage.FromServerEncoded))
    value.start()
    resolve(value)
  }

  window.addEventListener("message", onMessage)
})

// Let queued work (storage flushes) hand its messages to the port before it closes.
window.addEventListener(
  "pagehide",
  () => void Promise.allSettled([...beforeDispose].map((callback) => callback())).then(() => port.then((p) => p.close())),
  { once: true },
)

void request("DesktopEvents", null, (values) => {
  // SAFETY: DesktopEvents streams desktop events, whose encoded fields are JSON-native and read as decoded.
  for (const value of values as ReadonlyArray<DesktopEvent>) listeners.get(value._tag)?.forEach((fn) => fn(value))
})

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
  chunk?: Pending["chunk"],
  signal?: AbortSignal,
) {
  const id = nextId++

  return new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)

    const abort = () => {
      if (!pending.delete(id)) return
      reject(signal?.reason)
      void port.then((p) => p.postMessage({ _tag: "Interrupt", requestId: id } satisfies RpcMessage.InterruptEncoded))
    }

    signal?.addEventListener("abort", abort, { once: true })

    const settle =
      <Value>(callback: (value: Value) => void) =>
      (value: Value) => {
        signal?.removeEventListener("abort", abort)
        callback(value)
      }

    pending.set(id, { resolve: settle(resolve), reject: settle(reject), chunk })

    const message: RpcMessage.RequestEncoded = {
      _tag: "Request",
      id,
      tag,
      payload: omitUndefined(payload),
      headers: [],
    }

    void port.then((p) => p.postMessage(message))
  })
}

function receive(p: MessagePort, message: RpcMessage.FromServerEncoded) {
  switch (message._tag) {
    case "Chunk": {
      pending.get(Number(message.requestId))?.chunk?.(message.values)
      p.postMessage({ _tag: "Ack", requestId: message.requestId } satisfies RpcMessage.AckEncoded)

      return
    }

    case "Exit": {
      const id = Number(message.requestId)
      const entry = pending.get(id)
      pending.delete(id)

      if (!entry) return

      if (message.exit._tag === "Success") return entry.resolve(message.exit.value)

      return entry.reject(failure(message.exit.cause))
    }

    case "Defect": {
      const error = new Error("Desktop IPC defect", { cause: message.defect })
      pending.forEach((entry) => entry.reject(error))
      pending.clear()

      return
    }

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
