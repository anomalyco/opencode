/**
 * Write Queue Module
 *
 * Extracted from the PTY module's inline write-queue logic so it can be
 * unit-tested in isolation without pulling in the full server-side PTY
 * dependency graph.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueuedOperation = { type: "write"; data: string } | { type: "resize"; cols: number; rows: number }

/** Minimal interface for the session fields that enqueueWrite/flushWriteQueue touch. */
export interface WriteQueueSession {
  writeQueue: QueuedOperation[]
  queuedBytes: number
  highWatermark: number
  lowWatermark: number
  ready: boolean
  info: { status: string }
  process: {
    write(data: string): void
    resize(cols: number, rows: number): void
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function operationBytes(operation: QueuedOperation): number {
  return operation.type === "write" ? operation.data.length : 0
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Queue a write/resize operation, applying backpressure at the high watermark. */
export function enqueueWrite(session: WriteQueueSession, operation: QueuedOperation): void {
  if (operation.type === "write" && !operation.data) return
  session.writeQueue.push(operation)
  session.queuedBytes += operationBytes(operation)
  if (session.queuedBytes <= session.highWatermark) return
  while (session.queuedBytes > session.lowWatermark && session.writeQueue.length > 1) {
    const dropped = session.writeQueue.shift()
    if (!dropped) break
    session.queuedBytes -= operationBytes(dropped)
  }
}

/** Flush all queued operations to the underlying process. */
export function flushWriteQueue(session: WriteQueueSession): void {
  if (!session.ready) return
  if (session.info.status !== "running") return
  while (session.writeQueue.length > 0) {
    const next = session.writeQueue.shift()
    if (!next) break
    session.queuedBytes -= operationBytes(next)
    if (next.type === "write") {
      session.process.write(next.data)
      continue
    }
    session.process.resize(next.cols, next.rows)
  }
  if (session.queuedBytes < 0) session.queuedBytes = 0
}
