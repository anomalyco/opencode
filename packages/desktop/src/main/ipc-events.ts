import type { WebContents } from "electron"
import { Effect, Queue, Stream } from "effect"
import type { DesktopEvent } from "../shared/ipc-rpc/events"

const queues = new Map<number, Queue.Queue<DesktopEvent>>()

export function bindIpcEvents(senderId: number) {
  const queue = Effect.runSync(Queue.unbounded<DesktopEvent>())
  queues.set(senderId, queue)
  return () => {
    if (queues.get(senderId) === queue) queues.delete(senderId)
  }
}

export function ipcEventStream(senderId: number) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = queues.get(senderId) ?? (yield* Queue.unbounded<DesktopEvent>())
      if (!queues.has(senderId)) queues.set(senderId, queue)
      return Stream.fromQueue(queue)
    }),
  )
}

export function emitIpcEvent(sender: WebContents, event: DesktopEvent) {
  const queue = queues.get(sender.id)
  if (queue) Queue.offerUnsafe(queue, event)
}
