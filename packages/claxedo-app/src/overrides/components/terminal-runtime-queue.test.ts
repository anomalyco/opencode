import { describe, expect, test } from "bun:test"
import { createTerminalRuntimeQueue } from "./terminal-runtime-queue"

function makeQueue(input?: { maxPendingBytes?: number; maxStreamBytes?: number; maxBatchBytes?: number; maxBatchItems?: number; maxDroppedChunks?: number }) {
  const writes: string[] = []
  const frames: Array<() => void> = []
  const canceled: number[] = []
  const overloads: Array<{ kind: "pending" | "live"; dropped: number }> = []

  const queue = createTerminalRuntimeQueue({
    maxPendingBytes: input?.maxPendingBytes ?? 1024,
    maxStreamBytes: input?.maxStreamBytes ?? 1024,
    maxBatchBytes: input?.maxBatchBytes ?? 1024,
    maxBatchItems: input?.maxBatchItems ?? 100,
    maxDroppedChunks: input?.maxDroppedChunks ?? 100,
    requestFrame: (cb) => (frames.push(cb), frames.length),
    cancelFrame: (id) => {
      canceled.push(id)
    },
    write: (chunk, done) => {
      writes.push(chunk)
      done()
    },
    onOverload: (kind, dropped) => {
      overloads.push({ kind, dropped })
    },
  })

  const runFrames = () => {
    while (frames.length > 0) {
      const next = frames.shift()
      if (!next) continue
      next()
    }
  }

  return { queue, writes, overloads, canceled, runFrames }
}

describe("terminal runtime queue", () => {
  test("queue_pending_before_restore_flushes_in_exact_order", () => {
    const env = makeQueue()
    env.queue.push("A")
    env.queue.push("B")
    env.queue.push("C")

    env.queue.flushPending()
    env.runFrames()

    expect(env.writes.join("")).toBe("ABC")
  })

  test("queue_pending_overflow_drops_oldest_not_newest", () => {
    const env = makeQueue({ maxPendingBytes: 4 })
    env.queue.push("11")
    env.queue.push("22")
    env.queue.push("33")

    env.queue.flushPending()
    env.runFrames()

    expect(env.writes.join("")).toBe("2233")
  })

  test("queue_live_overflow_trips_overload_circuit_breaker", () => {
    const env = makeQueue({ maxStreamBytes: 4, maxDroppedChunks: 2 })
    env.queue.flushPending()

    env.queue.push("1111")
    env.queue.push("2222")
    env.queue.push("3333")
    env.queue.push("4444")

    expect(env.overloads.length).toBe(1)
    expect(env.overloads[0]?.kind).toBe("live")
  })

  test("queue_batch_limits_bytes_and_items", () => {
    const env = makeQueue({ maxBatchBytes: 4, maxBatchItems: 1 })
    env.queue.flushPending()

    env.queue.push("aa")
    env.queue.push("bb")
    env.queue.push("cc")
    env.runFrames()

    expect(env.writes).toEqual(["aa", "bb", "cc"])
  })

  test("queue_drain_reentrant_safe_no_double_write", () => {
    const writes: string[] = []
    const frames: Array<() => void> = []
    const queue = createTerminalRuntimeQueue({
      maxPendingBytes: 1024,
      maxStreamBytes: 1024,
      maxBatchBytes: 1024,
      maxBatchItems: 10,
      maxDroppedChunks: 100,
      requestFrame: (cb) => (frames.push(cb), frames.length),
      cancelFrame: () => {},
      write: (chunk, done) => {
        writes.push(chunk)
        if (writes.length === 1) queue.push("tail")
        done()
      },
      onOverload: () => {},
    })

    queue.flushPending()
    queue.push("head")
    while (frames.length > 0) {
      const next = frames.shift()
      if (!next) continue
      next()
    }

    expect(writes).toEqual(["head", "tail"])
  })

  test("queue_dispose_cancels_pending_frame_and_prevents_further_writes", () => {
    const env = makeQueue()
    env.queue.flushPending()
    env.queue.push("first")
    env.queue.dispose()
    env.runFrames()
    env.queue.push("after-dispose")
    env.runFrames()

    expect(env.canceled.length).toBe(1)
    expect(env.writes).toEqual([])
  })
})
