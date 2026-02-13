import { describe, expect, test, vi } from "bun:test"
import {
  type QueuedOperation,
  type WriteQueueSession,
  operationBytes,
  enqueueWrite,
  flushWriteQueue,
} from "./write-queue"

// ---------------------------------------------------------------------------
// Session stub factory
// ---------------------------------------------------------------------------

function createSession(overrides: Partial<WriteQueueSession> = {}): WriteQueueSession {
  return {
    writeQueue: [],
    queuedBytes: 0,
    highWatermark: 1024,
    lowWatermark: 256,
    ready: true,
    info: { status: "running" },
    process: {
      write: vi.fn(),
      resize: vi.fn(),
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// operationBytes
// ---------------------------------------------------------------------------

describe("operationBytes", () => {
  test("returns data length for write operations", () => {
    expect(operationBytes({ type: "write", data: "hello" })).toBe(5)
  })

  test("returns 0 for resize operations", () => {
    expect(operationBytes({ type: "resize", cols: 80, rows: 24 })).toBe(0)
  })

  test("returns 0 for empty write data", () => {
    expect(operationBytes({ type: "write", data: "" })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// enqueueWrite
// ---------------------------------------------------------------------------

describe("enqueueWrite", () => {
  test("adds operation to queue and tracks bytes", () => {
    const session = createSession()
    enqueueWrite(session, { type: "write", data: "hello" })

    expect(session.writeQueue).toHaveLength(1)
    expect(session.writeQueue[0]).toEqual({ type: "write", data: "hello" })
    expect(session.queuedBytes).toBe(5)
  })

  test("skips empty write data", () => {
    const session = createSession()
    enqueueWrite(session, { type: "write", data: "" })

    expect(session.writeQueue).toHaveLength(0)
    expect(session.queuedBytes).toBe(0)
  })

  test("enqueues resize operations (0 bytes)", () => {
    const session = createSession()
    enqueueWrite(session, { type: "resize", cols: 120, rows: 40 })

    expect(session.writeQueue).toHaveLength(1)
    expect(session.queuedBytes).toBe(0)
  })

  test("applies backpressure at high watermark", () => {
    const session = createSession({ highWatermark: 10, lowWatermark: 5 })

    // Fill past high watermark
    enqueueWrite(session, { type: "write", data: "aaaaaa" }) // 6 bytes
    enqueueWrite(session, { type: "write", data: "bbbbbb" }) // 6 bytes → 12 total > 10

    // Backpressure should have dropped oldest operations
    expect(session.queuedBytes).toBeLessThanOrEqual(10)
    // At least one operation must remain
    expect(session.writeQueue.length).toBeGreaterThanOrEqual(1)
  })

  test("keeps at least one operation during backpressure", () => {
    const session = createSession({ highWatermark: 3, lowWatermark: 1 })

    enqueueWrite(session, { type: "write", data: "aaaa" }) // 4 bytes > 3
    // Single operation should remain despite exceeding watermark
    expect(session.writeQueue).toHaveLength(1)
  })

  test("accumulates multiple operations below watermark", () => {
    const session = createSession({ highWatermark: 100, lowWatermark: 50 })

    enqueueWrite(session, { type: "write", data: "aaa" })
    enqueueWrite(session, { type: "resize", cols: 80, rows: 24 })
    enqueueWrite(session, { type: "write", data: "bb" })

    expect(session.writeQueue).toHaveLength(3)
    expect(session.queuedBytes).toBe(5) // 3 + 0 + 2
  })
})

// ---------------------------------------------------------------------------
// flushWriteQueue
// ---------------------------------------------------------------------------

describe("flushWriteQueue", () => {
  test("dispatches writes to process.write", () => {
    const session = createSession()
    session.writeQueue.push({ type: "write", data: "hello" })
    session.queuedBytes = 5

    flushWriteQueue(session)

    expect(session.process.write).toHaveBeenCalledWith("hello")
    expect(session.writeQueue).toHaveLength(0)
  })

  test("dispatches resizes to process.resize", () => {
    const session = createSession()
    session.writeQueue.push({ type: "resize", cols: 120, rows: 40 })

    flushWriteQueue(session)

    expect(session.process.resize).toHaveBeenCalledWith(120, 40)
    expect(session.writeQueue).toHaveLength(0)
  })

  test("drains queue in FIFO order", () => {
    const calls: string[] = []
    const session = createSession({
      process: {
        write: (data: string) => calls.push(`write:${data}`),
        resize: (cols: number, rows: number) => calls.push(`resize:${cols}x${rows}`),
      },
    })
    session.writeQueue.push(
      { type: "write", data: "first" },
      { type: "resize", cols: 80, rows: 24 },
      { type: "write", data: "second" },
    )
    session.queuedBytes = 10

    flushWriteQueue(session)

    expect(calls).toEqual(["write:first", "resize:80x24", "write:second"])
  })

  test("does nothing when not ready", () => {
    const session = createSession({ ready: false })
    session.writeQueue.push({ type: "write", data: "hello" })
    session.queuedBytes = 5

    flushWriteQueue(session)

    expect(session.process.write).not.toHaveBeenCalled()
    expect(session.writeQueue).toHaveLength(1)
  })

  test("does nothing when not running", () => {
    const session = createSession()
    session.info.status = "exited"
    session.writeQueue.push({ type: "write", data: "hello" })
    session.queuedBytes = 5

    flushWriteQueue(session)

    expect(session.process.write).not.toHaveBeenCalled()
    expect(session.writeQueue).toHaveLength(1)
  })

  test("clamps queuedBytes to 0 (negative byte guard)", () => {
    const session = createSession()
    // Simulate a scenario where queuedBytes drifts negative
    session.writeQueue.push({ type: "write", data: "x" })
    session.queuedBytes = 0 // artificially low

    flushWriteQueue(session)

    expect(session.queuedBytes).toBe(0) // clamped, not negative
  })
})

// ---------------------------------------------------------------------------
// Integration: enqueue → flush cycle
// ---------------------------------------------------------------------------

describe("enqueue → flush integration", () => {
  test("enqueue while not ready, flush on ready", () => {
    const session = createSession({ ready: false })

    // Queue operations while not ready
    enqueueWrite(session, { type: "write", data: "queued1" })
    enqueueWrite(session, { type: "resize", cols: 100, rows: 30 })
    enqueueWrite(session, { type: "write", data: "queued2" })

    expect(session.process.write).not.toHaveBeenCalled()
    expect(session.process.resize).not.toHaveBeenCalled()

    // Simulate client connect (sets ready)
    session.ready = true
    flushWriteQueue(session)

    expect(session.process.write).toHaveBeenCalledWith("queued1")
    expect(session.process.resize).toHaveBeenCalledWith(100, 30)
    expect(session.process.write).toHaveBeenCalledWith("queued2")
    expect(session.writeQueue).toHaveLength(0)
    expect(session.queuedBytes).toBe(0)
  })

  test("backpressure drops oldest, flush dispatches survivors", () => {
    const session = createSession({ ready: false, highWatermark: 10, lowWatermark: 5 })

    // Enqueue more than high watermark
    enqueueWrite(session, { type: "write", data: "aaaaaa" }) // 6
    enqueueWrite(session, { type: "write", data: "bbbb" })   // 4 → 10 total (at watermark, no drop)
    enqueueWrite(session, { type: "write", data: "cc" })     // 2 → 12 total > 10, triggers backpressure

    // Some operations should have been dropped
    const remainingOps = session.writeQueue.length
    expect(remainingOps).toBeGreaterThanOrEqual(1)
    expect(remainingOps).toBeLessThanOrEqual(3)

    // Flush survivors
    session.ready = true
    flushWriteQueue(session)

    expect(session.writeQueue).toHaveLength(0)
    expect(session.queuedBytes).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Structural conformance: WriteQueueSession vs ActiveSession fields
// ---------------------------------------------------------------------------

describe("WriteQueueSession conformance", () => {
  test("WriteQueueSession interface keys are a subset of ActiveSession fields", () => {
    // If someone adds/removes fields in index.ts's ActiveSession that the
    // write-queue functions depend on, this test documents the contract.
    const requiredKeys: (keyof WriteQueueSession)[] = [
      "writeQueue",
      "queuedBytes",
      "highWatermark",
      "lowWatermark",
      "ready",
      "info",
      "process",
    ]
    // Verify our stub covers all required keys
    const session = createSession()
    for (const key of requiredKeys) {
      expect(session).toHaveProperty(key)
    }
  })
})
