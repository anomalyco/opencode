import { capChunk, createStream, pushStream, takeStream } from "./terminal-stream"

export type QueueKind = "pending" | "live"

export function createTerminalRuntimeQueue(input: {
  maxPendingBytes: number
  maxStreamBytes: number
  maxBatchBytes: number
  maxBatchItems: number
  maxDroppedChunks: number
  requestFrame: (cb: () => void) => number
  cancelFrame: (id: number) => void
  write: (chunk: string, done: () => void) => void
  onOverload: (kind: QueueKind, dropped: number) => void
  onThrottled?: (dropped: number) => void
}) {
  const stream = createStream()
  let pending: string[] = []
  let pendingBytes = 0
  let pendingDropped = 0
  let restored = false
  let frame = 0
  let writing = false
  let reported = false
  let overloaded = false

  const schedule = () => {
    if (overloaded) return
    if (frame) return
    if (writing) return
    frame = input.requestFrame(drain)
  }

  const enqueueLive = (data: string) => {
    if (overloaded) return
    pushStream(stream, data, input.maxStreamBytes)
    if (stream.dropped > 0 && !reported) {
      reported = true
      input.onThrottled?.(stream.dropped)
    }
    if (stream.dropped >= input.maxDroppedChunks) {
      overloaded = true
      input.onOverload("live", stream.dropped)
      return
    }
    schedule()
  }

  const drain = () => {
    frame = 0
    if (overloaded) return
    if (writing) return
    const chunk = takeStream(stream, input.maxBatchBytes, input.maxBatchItems)
    if (!chunk) return
    writing = true
    input.write(chunk, () => {
      writing = false
      if (stream.items.length > 0) schedule()
    })
  }

  return {
    push(data: string) {
      if (restored) {
        enqueueLive(data)
        return
      }
      const next = capChunk(data, input.maxPendingBytes)
      pending.push(next.value)
      pendingBytes += next.value.length
      if (next.trimmed) pendingDropped += 1
      while (pendingBytes > input.maxPendingBytes && pending.length > 1) {
        const old = pending.shift()
        if (!old) break
        pendingBytes -= old.length
        pendingDropped += 1
      }
      if (pendingDropped >= input.maxDroppedChunks) {
        overloaded = true
        input.onOverload("pending", pendingDropped)
      }
    },
    flushPending() {
      if (restored) return
      restored = true
      if (pending.length === 0) return
      for (const chunk of pending) {
        enqueueLive(chunk)
      }
      pending = []
      pendingBytes = 0
    },
    pendingCount() {
      return pending.length
    },
    dispose() {
      if (frame) input.cancelFrame(frame)
      frame = 0
      pending = []
      pendingBytes = 0
      overloaded = true
    },
  }
}
