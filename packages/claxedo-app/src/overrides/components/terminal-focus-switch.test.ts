import { describe, expect, test } from "bun:test"
import { createTerminalRuntimeQueue } from "./terminal-runtime-queue"

// ---------------------------------------------------------------------------
// Layer 2: Runtime queue tests for focus-switch scenarios
//
// These model what happens to the write queue when:
//   - Portal unmounts and remounts (dispose → recreate)
//   - Pending data arrives during buffer restore phase
//   - Two terminal instances race (split panels)
//   - Queue drains across rapid focus oscillation
// ---------------------------------------------------------------------------

function makeQueue(input?: {
  maxPendingBytes?: number
  maxStreamBytes?: number
  maxBatchBytes?: number
  maxBatchItems?: number
  maxDroppedChunks?: number
  asyncWrite?: boolean
}) {
  const writes: string[] = []
  const frames: Array<() => void> = []
  const canceled: number[] = []
  const overloads: Array<{ kind: "pending" | "live"; dropped: number }> = []
  const throttled: number[] = []
  let pendingDone: Array<() => void> = []

  const queue = createTerminalRuntimeQueue({
    maxPendingBytes: input?.maxPendingBytes ?? 128 * 1024 * 1024,
    maxStreamBytes: input?.maxStreamBytes ?? 128 * 1024 * 1024,
    maxBatchBytes: input?.maxBatchBytes ?? 4 * 1024 * 1024,
    maxBatchItems: input?.maxBatchItems ?? 8192,
    maxDroppedChunks: input?.maxDroppedChunks ?? 1_000_000,
    requestFrame: (cb) => (frames.push(cb), frames.length),
    cancelFrame: (id) => {
      canceled.push(id)
    },
    write: (chunk, done) => {
      writes.push(chunk)
      if (input?.asyncWrite) {
        pendingDone.push(done)
      } else {
        done()
      }
    },
    onOverload: (kind, dropped) => {
      overloads.push({ kind, dropped })
    },
    onThrottled: (dropped) => {
      throttled.push(dropped)
    },
  })

  const runFrames = () => {
    let limit = 100
    while (frames.length > 0 && limit-- > 0) {
      const next = frames.shift()
      if (!next) continue
      next()
    }
  }

  const flushAsyncWrites = () => {
    const fns = pendingDone.splice(0)
    for (const fn of fns) fn()
  }

  return { queue, writes, frames, canceled, overloads, throttled, runFrames, flushAsyncWrites }
}

// ---------------------------------------------------------------------------
// 1. Portal remount simulation (dispose → new queue)
// ---------------------------------------------------------------------------

describe("portal remount: dispose and recreate queue", () => {
  test("rapid mount/unmount/mount cycle preserves second mount data", () => {
    // First mount
    const env1 = makeQueue()
    env1.queue.flushPending()
    env1.queue.push("first-mount")
    // Immediate unmount before frame fires
    env1.queue.dispose()

    // Second mount
    const env2 = makeQueue()
    env2.queue.flushPending()
    env2.queue.push("second-mount")
    env2.runFrames()

    expect(env1.writes).toEqual([])
    expect(env2.writes).toEqual(["second-mount"])
  })
})

// ---------------------------------------------------------------------------
// 2. Pending → live transition (buffer restore phase)
// ---------------------------------------------------------------------------

describe("pending to live transition during focus switch", () => {
  test("data pushed before flushPending arrives in order after flush", () => {
    const env = makeQueue()

    // WebSocket messages arrive while buffer is being restored
    env.queue.push("ws-msg-1")
    env.queue.push("ws-msg-2")
    env.queue.push("ws-msg-3")

    // Buffer restore completes → flush pending
    env.queue.flushPending()
    env.runFrames()

    expect(env.writes.join("")).toBe("ws-msg-1ws-msg-2ws-msg-3")
  })

  test("pending data is written before live data after flush", () => {
    const env = makeQueue({ maxBatchItems: 1 })

    // Pending data (arrived during buffer restore)
    env.queue.push("pending")

    // Flush transitions to live mode
    env.queue.flushPending()

    // New data arrives after flush (now in live mode)
    env.queue.push("live")

    env.runFrames()

    // Verify ordering: pending must come before live
    const all = env.writes.join("")
    const pendingIdx = all.indexOf("pending")
    const liveIdx = all.indexOf("live")
    expect(pendingIdx).toBeGreaterThanOrEqual(0)
    expect(liveIdx).toBeGreaterThan(pendingIdx)
  })

  test("flushPending is idempotent", () => {
    const env = makeQueue()
    env.queue.push("data")

    env.queue.flushPending()
    env.queue.flushPending() // second call should be no-op
    env.queue.flushPending() // third call should be no-op

    env.runFrames()

    expect(env.writes).toEqual(["data"])
  })

  test("push after flushPending writes to live stream", () => {
    const env = makeQueue()
    env.queue.flushPending()

    // These should go directly to live (not pending)
    env.queue.push("live-1")
    env.queue.push("live-2")

    env.runFrames()

    expect(env.writes.join("")).toBe("live-1live-2")
  })
})

// ---------------------------------------------------------------------------
// 3. Async write simulation (models xterm.write with callback delay)
// ---------------------------------------------------------------------------

describe("async write backpressure during focus switch", () => {
  test("queue waits for write callback before draining next batch", () => {
    // maxBatchItems=1 forces one chunk per write call so we can observe backpressure
    const env = makeQueue({ asyncWrite: true, maxBatchItems: 1 })
    env.queue.flushPending()

    env.queue.push("chunk-A")
    env.queue.push("chunk-B")

    // First frame fires, starts writing chunk-A
    env.runFrames()
    expect(env.writes).toEqual(["chunk-A"])

    // chunk-B should NOT be written yet (callback hasn't fired)
    env.runFrames()
    expect(env.writes).toEqual(["chunk-A"])

    // Complete chunk-A write
    env.flushAsyncWrites()

    // Now chunk-B should be scheduled and writable
    env.runFrames()
    expect(env.writes).toEqual(["chunk-A", "chunk-B"])

    env.flushAsyncWrites()
  })

  test("dispose while async write is in-flight does not crash", () => {
    const env = makeQueue({ asyncWrite: true, maxBatchItems: 1 })
    env.queue.flushPending()

    env.queue.push("in-flight")
    env.runFrames()
    expect(env.writes).toEqual(["in-flight"])

    // Dispose while write callback is still pending
    env.queue.dispose()

    // Late callback fires (from disposed xterm)
    expect(() => env.flushAsyncWrites()).not.toThrow()

    // No further writes should happen
    env.queue.push("after-dispose")
    env.runFrames()
    expect(env.writes).toEqual(["in-flight"])
  })

  test("interleaved push during async drain preserves all data", () => {
    const env = makeQueue({ asyncWrite: true, maxBatchItems: 1 })
    env.queue.flushPending()

    env.queue.push("batch-1")
    env.runFrames()
    expect(env.writes).toEqual(["batch-1"])

    // New data arrives while batch-1 write is in-flight
    env.queue.push("batch-2")
    env.queue.push("batch-3")

    // Complete batch-1
    env.flushAsyncWrites()
    env.runFrames()

    // batch-2 should be written next
    expect(env.writes).toEqual(["batch-1", "batch-2"])

    // Complete batch-2, drain batch-3
    env.flushAsyncWrites()
    env.runFrames()
    expect(env.writes).toEqual(["batch-1", "batch-2", "batch-3"])

    env.flushAsyncWrites()
  })
})

// ---------------------------------------------------------------------------
// 4. Two queues racing (split panel scenario)
// ---------------------------------------------------------------------------

describe("two queues racing (split panels)", () => {
  test("queues at different lifecycle phases work independently", () => {
    const envA = makeQueue() // Still in pending phase
    const envB = makeQueue() // Already restored
    envB.queue.flushPending()

    // A accumulates pending data
    envA.queue.push("A-pending-1")
    envA.queue.push("A-pending-2")

    // B receives live data
    envB.queue.push("B-live-1")
    envB.runFrames()

    expect(envB.writes).toEqual(["B-live-1"])
    expect(envA.writes).toEqual([])

    // Now A restores
    envA.queue.flushPending()
    envA.runFrames()

    expect(envA.writes.join("")).toBe("A-pending-1A-pending-2")
  })
})

// ---------------------------------------------------------------------------
// 5. High-throughput focus-switch stress
// ---------------------------------------------------------------------------

describe("high throughput during focus switch", () => {
  test("all pending chunks survive transition to live", () => {
    const env = makeQueue()

    const count = 1000
    for (let i = 0; i < count; i++) {
      env.queue.push(`chunk-${i}\n`)
    }

    env.queue.flushPending()
    env.runFrames()

    const all = env.writes.join("")
    const chunkCount = (all.match(/chunk-/g) || []).length
    expect(chunkCount).toBe(count)
  })

  test("alternating push and frame execution drains completely", () => {
    const env = makeQueue({ maxBatchItems: 1 })
    env.queue.flushPending()

    // Simulate: data arrives, frame fires, more data arrives, frame fires...
    for (let i = 0; i < 50; i++) {
      env.queue.push(`msg-${i}`)
      env.runFrames()
    }

    expect(env.writes.length).toBe(50)
    expect(env.writes[0]).toBe("msg-0")
    expect(env.writes[49]).toBe("msg-49")
  })

  test("burst of data followed by silence drains all chunks", () => {
    const env = makeQueue()
    env.queue.flushPending()

    // Burst: 100 chunks pushed without any frame execution
    const count = 100
    for (let i = 0; i < count; i++) {
      env.queue.push(`burst-${i}\n`)
    }

    // Then frames execute (simulates requestAnimationFrame catching up)
    env.runFrames()

    const all = env.writes.join("")
    const burstCount = (all.match(/burst-/g) || []).length
    expect(burstCount).toBe(count)
  })
})
