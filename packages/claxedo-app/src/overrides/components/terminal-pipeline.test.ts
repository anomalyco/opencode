import { describe, expect, test } from "bun:test"
import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createTerminalRuntimeQueue } from "./terminal-runtime-queue"
import { preparePersistBuffer, prepareRestoreBuffer } from "./terminal-buffer"
import { createModeScanner } from "../terminal/mode-scan"
import { createQuerySuppressor } from "../terminal/query-suppression"
import { sigwinchToggleSize } from "./terminal-connection"

// ---------------------------------------------------------------------------
// Integration Test 3: End-to-end pipeline
//
// Models the full data path in the real system:
//   MockWebSocket → message handler → query/mode filter → queue → xterm
//
// With focus-switch simulated by:
//   serialize → dispose all → create new pipeline → restore → reconnect
//
// This catches bugs where the interaction between filtering, queueing,
// and async xterm writes causes data loss or corruption during focus switch.
// ---------------------------------------------------------------------------

function xtermWrite(t: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => t.write(data, resolve))
}

function allLines(t: Terminal): string[] {
  const buf = t.buffer.active
  const out: string[] = []
  for (let i = 0; i < buf.length; i++) {
    out.push(buf.getLine(i)?.translateToString(true) ?? "")
  }
  return out
}

// ---------------------------------------------------------------------------
// Mock WebSocket: delivers messages synchronously for deterministic testing
// ---------------------------------------------------------------------------

type WsListener = (data: string | ArrayBuffer) => void

function createMockWebSocket() {
  const listeners: WsListener[] = []
  const sent: string[] = []
  let closed = false

  return {
    readyState: 1 as number, // OPEN
    addEventListener(_type: string, fn: WsListener) {
      listeners.push(fn)
    },
    send(data: string) {
      if (closed) throw new Error("WebSocket is closed")
      sent.push(data)
    },
    close() {
      closed = true
      this.readyState = 3
    },
    /** Simulate server sending text data. */
    deliver(data: string) {
      for (const fn of listeners) fn(data)
    },
    /** Simulate server sending cursor metadata (binary frame). */
    deliverCursor(cursor: number) {
      const json = JSON.stringify({ cursor })
      const prefix = new Uint8Array([0])
      const body = new TextEncoder().encode(json)
      const frame = new Uint8Array(prefix.length + body.length)
      frame.set(prefix)
      frame.set(body, prefix.length)
      for (const fn of listeners) fn(frame.buffer)
    },
    get sentMessages() {
      return sent
    },
    get isClosed() {
      return closed
    },
  }
}

// ---------------------------------------------------------------------------
// Pipeline: wires mock WS → filter → queue → xterm (matching terminal.tsx)
// ---------------------------------------------------------------------------

function createPipeline(opts: {
  cols?: number
  rows?: number
  buffer?: string
  savedCols?: number
  savedRows?: number
}) {
  const cols = opts.cols ?? 80
  const rows = opts.rows ?? 24
  const xterm = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  xterm.loadAddon(serialize)

  // I/O filters (same as real backend creates)
  const mode = createModeScanner()
  const suppress = createQuerySuppressor()

  // Write (matches backend.write in xterm.ts)
  const filteredWrite = (data: string, callback?: () => void) => {
    const out = suppress.scan(data)
    mode.scan(out)
    if (!out) {
      callback?.()
      return
    }
    if (callback) xterm.write(out, callback)
    else xterm.write(out)
  }

  // Queue (matches terminal.tsx setup)
  const frames: Array<() => void> = []
  let frameId = 0
  let isBufferRestored = !opts.buffer

  const queue = createTerminalRuntimeQueue({
    maxPendingBytes: 128 * 1024 * 1024,
    maxStreamBytes: 128 * 1024 * 1024,
    maxBatchBytes: 4 * 1024 * 1024,
    maxBatchItems: 8192,
    maxDroppedChunks: 1_000_000,
    requestFrame: (cb) => {
      frames.push(cb)
      return ++frameId
    },
    cancelFrame: () => {},
    write: (chunk, done) => filteredWrite(chunk, done),
    onOverload: () => {},
  })

  const runFrames = () => {
    let limit = 200
    while (frames.length > 0 && limit-- > 0) {
      frames.shift()!()
    }
  }

  // Buffer restore
  const restore = prepareRestoreBuffer(opts.buffer)
  let restoreComplete: Promise<void>
  if (restore.value) {
    if (opts.savedCols && opts.savedRows && opts.savedCols > 2) {
      xterm.resize(opts.savedCols, opts.savedRows)
    }
    restoreComplete = new Promise<void>((resolve) => {
      xterm.write(restore.value!, () => {
        xterm.resize(cols, rows)
        isBufferRestored = true
        queue.flushPending()
        runFrames()
        resolve()
      })
    })
  } else {
    isBufferRestored = true
    queue.flushPending()
    restoreComplete = Promise.resolve()
  }

  // Mock WebSocket
  const ws = createMockWebSocket()

  // Cursor tracking (matches terminal.tsx handleMessage)
  let cursor = 0
  const decoder = new TextDecoder()

  // Wire WS → queue (matches terminal.tsx handleMessage lines 524-562)
  ws.addEventListener("message", (eventData: string | ArrayBuffer) => {
    if (eventData instanceof ArrayBuffer) {
      const bytes = new Uint8Array(eventData)
      if (bytes[0] !== 0) return
      const json = decoder.decode(bytes.subarray(1))
      try {
        const meta = JSON.parse(json) as { cursor?: unknown }
        const next = meta?.cursor
        if (typeof next === "number" && Number.isSafeInteger(next) && next >= 0) {
          cursor = next
        }
      } catch {}
      return
    }

    const data = typeof eventData === "string" ? eventData : ""
    if (!data) return
    cursor += data.length
    queue.push(data)
  })

  return {
    xterm,
    serialize,
    queue,
    ws,
    mode,
    restoreComplete,
    get cursor() { return cursor },
    isBufferRestored: () => isBufferRestored,

    runFrames,

    async flush() {
      runFrames()
      await new Promise<void>((r) => setTimeout(r, 0))
      runFrames()
      await new Promise<void>((r) => setTimeout(r, 0))
    },

    /** Simulate user typing (goes back through WS). */
    userInput(data: string) {
      ws.send(data)
    },

    /** Serialize state and dispose everything (simulates onCleanup). */
    cleanup() {
      const buffer = (() => {
        try {
          return preparePersistBuffer(serialize.serialize({ excludeAltBuffer: true, excludeModes: true }))
        } catch {
          return ""
        }
      })()
      const result = {
        buffer,
        cursor,
        rows: xterm.rows,
        cols: xterm.cols,
        scrollY: xterm.buffer.active.viewportY,
      }
      ws.close()
      queue.dispose()
      xterm.dispose()
      return result
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("end-to-end pipeline: ws → filter → queue → xterm", () => {
  test("basic data flow: ws delivers → queue drains → xterm has content", async () => {
    const p = createPipeline({})
    await p.restoreComplete

    p.ws.deliver("$ echo hello\r\n")
    p.ws.deliver("hello\r\n")
    p.ws.deliver("$ ")
    await p.flush()

    const lines = allLines(p.xterm)
    expect(lines.some((l) => l.includes("echo hello"))).toBe(true)
    expect(lines.some((l) => l.includes("hello"))).toBe(true)

    p.cleanup()
  })

  test("xterm handles query responses without displaying them", async () => {
    const p = createPipeline({})
    await p.restoreComplete

    // Deliver data with embedded query responses (CPR, focus, DECRPM)
    p.ws.deliver("visible-A")
    p.ws.deliver("\x1b[12;34R")       // Cursor position report — should be stripped
    p.ws.deliver("\x1b[I")            // Focus in — should be stripped
    p.ws.deliver("\x1b[?2004;1$y")    // DECRPM — should be stripped
    p.ws.deliver("visible-B\r\n")
    await p.flush()

    const joined = allLines(p.xterm).join("")
    expect(joined).toContain("visible-A")
    expect(joined).toContain("visible-B")
    // Query responses should NOT appear
    expect(joined).not.toContain("[12;34R")
    expect(joined).not.toContain("[I")
    expect(joined).not.toContain("$y")

    p.cleanup()
  })

  test("bracketed paste mode tracked across split chunks", async () => {
    const p = createPipeline({})
    await p.restoreComplete

    // Enable bracketed paste in two chunks (split across WS messages)
    p.ws.deliver("xx\x1b[?20")
    p.ws.deliver("04hyy")
    await p.flush()

    expect(p.mode.bracketed()).toBe(true)

    // Disable
    p.ws.deliver("\x1b[?2004l")
    await p.flush()

    expect(p.mode.bracketed()).toBe(false)

    p.cleanup()
  })

  test("cursor tracking accumulates correctly across messages", async () => {
    const p = createPipeline({})
    await p.restoreComplete

    p.ws.deliver("12345")  // 5 chars
    p.ws.deliver("6789")   // 4 chars
    await p.flush()

    expect(p.cursor).toBe(9)

    // Binary cursor update overrides
    p.ws.deliverCursor(100)
    expect(p.cursor).toBe(100)

    p.cleanup()
  })

  test("user input goes through ws.send", async () => {
    const p = createPipeline({})
    await p.restoreComplete

    p.userInput("ls -la\n")
    expect(p.ws.sentMessages).toEqual(["ls -la\n"])

    p.cleanup()
  })
})

describe("pipeline focus-switch: serialize → dispose → recreate → restore", () => {
  test("full focus-switch preserves all content through pipeline", async () => {
    // Pipeline 1: receive some data
    const p1 = createPipeline({})
    await p1.restoreComplete
    p1.ws.deliver("$ npm install\r\n")
    p1.ws.deliver("added 1234 packages\r\n")
    p1.ws.deliver("$ ")
    await p1.flush()

    // Focus switches away → cleanup
    const saved = p1.cleanup()

    // Pipeline 2: restore and continue
    const p2 = createPipeline({
      cols: 80, rows: 24,
      buffer: saved.buffer,
      savedCols: saved.cols, savedRows: saved.rows,
    })
    await p2.restoreComplete

    // New data on the "reconnected" socket
    p2.ws.deliver("echo world\r\n")
    p2.ws.deliver("world\r\n")
    await p2.flush()

    const lines = allLines(p2.xterm).join("\n")
    expect(lines).toContain("added 1234 packages")
    expect(lines).toContain("world")

    p2.cleanup()
  })

  test("ws messages during restore are queued and arrive in order", async () => {
    // Pipeline 1
    const p1 = createPipeline({})
    await p1.restoreComplete
    p1.ws.deliver("base content\r\n")
    await p1.flush()
    const saved = p1.cleanup()

    // Pipeline 2: start restoring
    const p2 = createPipeline({
      buffer: saved.buffer,
      savedCols: saved.cols, savedRows: saved.rows,
    })

    // WS messages arrive while restore is in-flight
    p2.ws.deliver("queued-1\r\n")
    p2.ws.deliver("queued-2\r\n")
    p2.ws.deliver("queued-3\r\n")

    // Restore completes → pending flushed
    await p2.restoreComplete
    await p2.flush()

    const joined = allLines(p2.xterm).join("\n")
    expect(joined).toContain("base content")
    expect(joined).toContain("queued-1")
    expect(joined).toContain("queued-2")
    expect(joined).toContain("queued-3")

    // Order preserved
    const idx1 = joined.indexOf("queued-1")
    const idx2 = joined.indexOf("queued-2")
    const idx3 = joined.indexOf("queued-3")
    expect(idx1).toBeLessThan(idx2)
    expect(idx2).toBeLessThan(idx3)

    p2.cleanup()
  })

  test("xterm handles query responses in pending data on flush", async () => {
    const p1 = createPipeline({})
    await p1.restoreComplete
    p1.ws.deliver("before\r\n")
    await p1.flush()
    const saved = p1.cleanup()

    const p2 = createPipeline({
      buffer: saved.buffer,
      savedCols: saved.cols, savedRows: saved.rows,
    })

    // Pending data includes query responses
    p2.ws.deliver("visible\x1b[6;1R")   // CPR embedded in data
    p2.ws.deliver("also-visible\r\n")

    await p2.restoreComplete
    await p2.flush()

    const joined = allLines(p2.xterm).join("")
    expect(joined).toContain("visible")
    expect(joined).toContain("also-visible")
    expect(joined).not.toContain("[6;1R")

    p2.cleanup()
  })

  test("SIGWINCH toggle after restore does not lose pending data", async () => {
    const p1 = createPipeline({})
    await p1.restoreComplete
    p1.ws.deliver("original\r\n")
    await p1.flush()
    const saved = p1.cleanup()

    const p2 = createPipeline({
      buffer: saved.buffer,
      savedCols: saved.cols, savedRows: saved.rows,
    })

    // Pending data
    p2.ws.deliver("pending-data\r\n")

    await p2.restoreComplete

    // SIGWINCH toggle (what the real component does on socket open)
    const [first, second] = sigwinchToggleSize(80, 24)
    p2.xterm.resize(first.cols, first.rows)
    p2.xterm.resize(second.cols, second.rows)

    await p2.flush()

    const joined = allLines(p2.xterm).join("\n")
    expect(joined).toContain("original")
    expect(joined).toContain("pending-data")

    p2.cleanup()
  })

  test("triple focus-switch cycle with filtered data preserves all content", async () => {
    // Cycle 1
    const p1 = createPipeline({})
    await p1.restoreComplete
    p1.ws.deliver("\x1b[32mcycle-1\x1b[0m\r\n")  // colored output
    await p1.flush()
    const s1 = p1.cleanup()

    // Cycle 2: different terminal size
    const p2 = createPipeline({
      cols: 60, rows: 15,
      buffer: s1.buffer, savedCols: s1.cols, savedRows: s1.rows,
    })
    await p2.restoreComplete
    p2.ws.deliver("cycle-2\r\n")
    p2.ws.deliver("\x1b[6;1R")  // query response — should be filtered
    await p2.flush()
    const s2 = p2.cleanup()

    // Cycle 3: back to original size
    const p3 = createPipeline({
      cols: 80, rows: 24,
      buffer: s2.buffer, savedCols: s2.cols, savedRows: s2.rows,
    })
    await p3.restoreComplete
    p3.ws.deliver("cycle-3\r\n")
    await p3.flush()

    const joined = allLines(p3.xterm).join("\n")
    expect(joined).toContain("cycle-1")
    expect(joined).toContain("cycle-2")
    expect(joined).toContain("cycle-3")
    // Query response should not appear anywhere
    expect(joined).not.toContain("[6;1R")

    p3.cleanup()
  })
})

describe("pipeline: two terminals in split panels", () => {
  test("two pipelines receive data independently without interference", async () => {
    const pA = createPipeline({ cols: 40, rows: 24 })
    const pB = createPipeline({ cols: 40, rows: 24 })
    await Promise.all([pA.restoreComplete, pB.restoreComplete])

    // Both receive data concurrently
    pA.ws.deliver("panel-A data\r\n")
    pB.ws.deliver("panel-B data\r\n")
    await Promise.all([pA.flush(), pB.flush()])

    const linesA = allLines(pA.xterm).join("")
    const linesB = allLines(pB.xterm).join("")

    expect(linesA).toContain("panel-A data")
    expect(linesA).not.toContain("panel-B")
    expect(linesB).toContain("panel-B data")
    expect(linesB).not.toContain("panel-A")

    pA.cleanup()
    pB.cleanup()
  })

  test("closing one panel does not affect the other", async () => {
    const pA = createPipeline({})
    const pB = createPipeline({})
    await Promise.all([pA.restoreComplete, pB.restoreComplete])

    pA.ws.deliver("A-data\r\n")
    pB.ws.deliver("B-data\r\n")
    await Promise.all([pA.flush(), pB.flush()])

    // Close panel A
    pA.cleanup()

    // Panel B should still work
    pB.ws.deliver("B-more-data\r\n")
    await pB.flush()

    const linesB = allLines(pB.xterm).join("\n")
    expect(linesB).toContain("B-data")
    expect(linesB).toContain("B-more-data")

    pB.cleanup()
  })

  test("focus switch on one panel while other keeps receiving data", async () => {
    const pA = createPipeline({})
    const pB = createPipeline({})
    await Promise.all([pA.restoreComplete, pB.restoreComplete])

    pA.ws.deliver("A-before\r\n")
    pB.ws.deliver("B-continuous\r\n")
    await Promise.all([pA.flush(), pB.flush()])

    // Focus switch on A: cleanup → remount
    const savedA = pA.cleanup()

    // B keeps receiving during A's remount
    pB.ws.deliver("B-during-switch\r\n")

    const pA2 = createPipeline({
      buffer: savedA.buffer, savedCols: savedA.cols, savedRows: savedA.rows,
    })
    await pA2.restoreComplete

    pA2.ws.deliver("A-after-switch\r\n")
    pB.ws.deliver("B-after-switch\r\n")
    await Promise.all([pA2.flush(), pB.flush()])

    const linesA = allLines(pA2.xterm).join("\n")
    const linesB = allLines(pB.xterm).join("\n")

    expect(linesA).toContain("A-before")
    expect(linesA).toContain("A-after-switch")
    expect(linesB).toContain("B-continuous")
    expect(linesB).toContain("B-during-switch")
    expect(linesB).toContain("B-after-switch")

    pA2.cleanup()
    pB.cleanup()
  })
})
