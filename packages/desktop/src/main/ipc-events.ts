import { Effect, Queue, Stream } from "effect"
import type { DesktopEvent } from "../shared/ipc-rpc/events"

const queues = new Map<number, Queue.Queue<DesktopEvent>>()

export const bindIpcEvents = Effect.fn("IpcEvents.bind")(function* (senderId: number) {
  const queue = yield* Queue.unbounded<DesktopEvent>()
  const previous = queues.get(senderId)
  queues.set(senderId, queue)
  if (previous) yield* Queue.shutdown(previous)
  return Effect.fnUntraced(function* () {
    if (queues.get(senderId) === queue) queues.delete(senderId)
    yield* Queue.shutdown(queue)
  })()
})

export function ipcEventStream(senderId: number) {
  const queue = queues.get(senderId)
  return queue ? Stream.fromQueue(queue) : Stream.empty
}

export function emitIpcEvent(sender: { id: number }, event: DesktopEvent) {
  const queue = queues.get(sender.id)
  if (!queue) return false
  Queue.offerUnsafe(queue, event)
  return true
}
