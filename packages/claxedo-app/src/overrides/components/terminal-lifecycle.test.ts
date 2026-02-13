import { describe, expect, test } from "bun:test"
import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createTerminalRuntimeQueue } from "./terminal-runtime-queue"
import { preparePersistBuffer, prepareRestoreBuffer } from "./terminal-buffer"
import { shouldSendResize, shouldRecoverDesync } from "./terminal-geometry"
import { sigwinchToggleSize } from "./terminal-connection"
import { retry } from "../terminal/retry"

// ---------------------------------------------------------------------------
// Integration Test 1: Terminal component lifecycle with headless xterm
//
// Models the real Terminal component's onMount → onCleanup cycle,
// wiring createTerminalRuntimeQueue directly to @xterm/headless.
// This catches bugs where the queue ↔ backend ↔ serialize pipeline
// breaks during focus-switch induced mount/unmount cycles.
// ---------------------------------------------------------------------------

/** Promise wrapper for headless xterm async write. */
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

/**
 * Simulates one terminal component lifetime:
 *   onMount: create xterm, queue, restore buffer, connect WS, flushPending
 *   live: receive WS messages → queue → xterm
 *   onCleanup: serialize, capture cursor/scroll, dispose
 *
 * Returns the captured state that would be passed to `props.onCleanup()`.
 */
function createTerminalLifecycle(opts: {
  cols?: number
  rows?: number
  buffer?: string
  scrollY?: number
  savedCols?: number
  savedRows?: number
}) {
  const cols = opts.cols ?? 80
  const rows = opts.rows ?? 24
  const xterm = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  xterm.loadAddon(serialize)

  // Simulate buffer restore (what terminal.tsx onMount does)
  const restore = prepareRestoreBuffer(opts.buffer)
  const bufferToRestore = restore.value

  // Track write completions for deterministic assertions
  const writes: string[] = []
  let writesDone = 0

  // The queue mirrors the real component's setup
  const frames: Array<() => void> = []
  let frameId = 0
  let isBufferRestored = !bufferToRestore

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
    write: (chunk, done) => {
      writes.push(chunk)
      xterm.write(chunk, () => {
        writesDone++
        done()
      })
    },
    onOverload: () => {},
  })

  const runFrames = () => {
    let limit = 200
    while (frames.length > 0 && limit-- > 0) {
      const fn = frames.shift()!
      fn()
    }
  }

  // Restore buffer if present (matches terminal.tsx lines 404-446)
  let restoreComplete: Promise<void>
  if (bufferToRestore) {
    if (opts.savedCols && opts.savedRows && opts.savedCols > 2) {
      xterm.resize(opts.savedCols, opts.savedRows)
    }
    restoreComplete = new Promise<void>((resolve) => {
      xterm.write(bufferToRestore, () => {
        if (opts.scrollY) xterm.scrollToLine(opts.scrollY)
        // Simulate fit retry success on first attempt
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

  return {
    xterm,
    serialize,
    queue,
    frames,
    writes,
    restoreComplete,
    isBufferRestored: () => isBufferRestored,

    /** Simulate a WebSocket message arriving. */
    receiveWsMessage(data: string) {
      queue.push(data)
    },

    /** Drain all queued frames (simulate requestAnimationFrame execution). */
    runFrames,

    /** Wait for all queued xterm writes to complete. */
    async flush(): Promise<void> {
      this.runFrames()
      // xterm writes are async, need a microtask tick
      await new Promise<void>((r) => setTimeout(r, 0))
      this.runFrames()
      await new Promise<void>((r) => setTimeout(r, 0))
    },

    /** Simulate onCleanup: serialize state for next mount. */
    cleanup(): {
      buffer: string
      cursor: number
      rows: number
      cols: number
      scrollY: number
    } {
      const buffer = (() => {
        try {
          return preparePersistBuffer(serialize.serialize({ excludeAltBuffer: true, excludeModes: true }))
        } catch {
          return ""
        }
      })()
      const result = {
        buffer,
        cursor: 0,
        rows: xterm.rows,
        cols: xterm.cols,
        scrollY: xterm.buffer.active.viewportY,
      }
      queue.dispose()
      xterm.dispose()
      return result
    },
  }
}

// ---------------------------------------------------------------------------
// Test: Full mount → receive data → cleanup → remount → verify
// ---------------------------------------------------------------------------

describe("terminal lifecycle integration", () => {
  test("mount → ws messages → cleanup → remount preserves buffer content", async () => {
    // First mount: fresh terminal, no saved buffer
    const t1 = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t1.restoreComplete

    // Simulate WebSocket messages arriving
    t1.receiveWsMessage("$ npm install\r\n")
    t1.receiveWsMessage("added 1234 packages in 12s\r\n")
    t1.receiveWsMessage("$ ")
    await t1.flush()

    const linesBeforeCleanup = allLines(t1.xterm)
    expect(linesBeforeCleanup.some((l) => l.includes("added 1234 packages"))).toBe(true)

    // Cleanup (simulates portal unmount / focus switch away)
    const saved = t1.cleanup()
    expect(saved.buffer.length).toBeGreaterThan(0)
    expect(saved.cols).toBe(80)
    expect(saved.rows).toBe(24)

    // Remount with saved state (simulates portal remount / focus switch back)
    const t2 = createTerminalLifecycle({
      cols: 80,
      rows: 24,
      buffer: saved.buffer,
      scrollY: saved.scrollY,
      savedCols: saved.cols,
      savedRows: saved.rows,
    })
    await t2.restoreComplete

    const linesAfterRestore = allLines(t2.xterm)
    expect(linesAfterRestore.some((l) => l.includes("added 1234 packages"))).toBe(true)
    expect(linesAfterRestore.some((l) => l.includes("$ npm install"))).toBe(true)

    // New data arrives after remount
    t2.receiveWsMessage("echo hello\r\n")
    t2.receiveWsMessage("hello\r\n")
    await t2.flush()

    const finalLines = allLines(t2.xterm)
    expect(finalLines.some((l) => l.includes("hello"))).toBe(true)

    t2.cleanup()
  })

  test("ws messages queued during buffer restore arrive in order after flush", async () => {
    // First mount with content
    const t1 = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t1.restoreComplete
    t1.receiveWsMessage("$ long-running-cmd\r\n")
    t1.receiveWsMessage("processing...\r\n")
    await t1.flush()

    const saved = t1.cleanup()

    // Remount: buffer restore takes time, WS messages arrive during restore
    const t2 = createTerminalLifecycle({
      cols: 80,
      rows: 24,
      buffer: saved.buffer,
      savedCols: saved.cols,
      savedRows: saved.rows,
    })

    // These arrive BEFORE restoreComplete finishes (simulates real race)
    t2.receiveWsMessage("result-A\r\n")
    t2.receiveWsMessage("result-B\r\n")
    t2.receiveWsMessage("result-C\r\n")

    // Buffer restore completes → flush pending
    await t2.restoreComplete
    await t2.flush()

    const lines = allLines(t2.xterm)
    const joined = lines.join("\n")
    // Restored content should be present
    expect(joined).toContain("processing...")
    // Pending messages should have been flushed in order
    expect(joined).toContain("result-A")
    expect(joined).toContain("result-B")
    expect(joined).toContain("result-C")
    // And in the right order
    const idxA = joined.indexOf("result-A")
    const idxB = joined.indexOf("result-B")
    const idxC = joined.indexOf("result-C")
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)

    t2.cleanup()
  })

  test("rapid focus-switch: mount → cleanup → mount → cleanup → mount (triple cycle)", async () => {
    // Mount 1
    const t1 = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t1.restoreComplete
    t1.receiveWsMessage("original\r\n")
    await t1.flush()
    const s1 = t1.cleanup()

    // Mount 2: quick switch, add more data, switch away
    const t2 = createTerminalLifecycle({
      cols: 100, rows: 30, // Different size (split panel)
      buffer: s1.buffer, savedCols: s1.cols, savedRows: s1.rows,
    })
    await t2.restoreComplete
    t2.receiveWsMessage("second mount\r\n")
    await t2.flush()
    const s2 = t2.cleanup()

    // Mount 3: back to original size
    const t3 = createTerminalLifecycle({
      cols: 80, rows: 24,
      buffer: s2.buffer, savedCols: s2.cols, savedRows: s2.rows,
    })
    await t3.restoreComplete
    t3.receiveWsMessage("third mount\r\n")
    await t3.flush()

    const lines = allLines(t3.xterm).join("\n")
    expect(lines).toContain("original")
    expect(lines).toContain("second mount")
    expect(lines).toContain("third mount")

    t3.cleanup()
  })

  test("cleanup with no data produces empty buffer that mounts cleanly", async () => {
    const t1 = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t1.restoreComplete
    const s1 = t1.cleanup()

    // Buffer may be empty string
    const t2 = createTerminalLifecycle({
      cols: 80, rows: 24,
      buffer: s1.buffer || undefined,
      savedCols: s1.cols, savedRows: s1.rows,
    })
    await t2.restoreComplete
    t2.receiveWsMessage("hello after empty restore\r\n")
    await t2.flush()

    const lines = allLines(t2.xterm)
    expect(lines.some((l) => l.includes("hello after empty restore"))).toBe(true)

    t2.cleanup()
  })

  test("resize during live data does not lose queued messages", async () => {
    const t = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t.restoreComplete

    // Push messages
    t.receiveWsMessage("line-1\r\n")
    t.receiveWsMessage("line-2\r\n")

    // Resize happens (fit after focus switch) before queue drains
    t.xterm.resize(60, 20)

    t.receiveWsMessage("line-3\r\n")
    await t.flush()

    const lines = allLines(t.xterm).join("\n")
    expect(lines).toContain("line-1")
    expect(lines).toContain("line-2")
    expect(lines).toContain("line-3")

    t.cleanup()
  })

  test("SIGWINCH toggle after restore does not corrupt serialized state", async () => {
    // Mount with content
    const t1 = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t1.restoreComplete
    t1.receiveWsMessage("important data\r\n")
    await t1.flush()
    const s1 = t1.cleanup()

    // Remount
    const t2 = createTerminalLifecycle({
      cols: 80, rows: 24,
      buffer: s1.buffer, savedCols: s1.cols, savedRows: s1.rows,
    })
    await t2.restoreComplete

    // SIGWINCH toggle (what the real component does on reconnect)
    const [first, second] = sigwinchToggleSize(80, 24)
    t2.xterm.resize(first.cols, first.rows)
    t2.xterm.resize(second.cols, second.rows)

    // More data after toggle
    t2.receiveWsMessage("post-sigwinch\r\n")
    await t2.flush()

    const lines = allLines(t2.xterm).join("\n")
    expect(lines).toContain("important data")
    expect(lines).toContain("post-sigwinch")

    // Serialize should still work
    const s2 = t2.cleanup()
    expect(s2.buffer.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Test: Resize guard integration
// ---------------------------------------------------------------------------

describe("resize guard integration", () => {
  test("shouldSendResize rejects unstable host, shouldRecoverDesync triggers after threshold", async () => {
    const t = createTerminalLifecycle({ cols: 80, rows: 24 })
    await t.restoreComplete
    t.receiveWsMessage("content\r\n")
    await t.flush()

    const size = { cols: t.xterm.cols, rows: t.xterm.rows }

    // Unstable host (too small) → reject resize
    expect(shouldSendResize(size, { width: 10, height: 10 })).toBe(false)

    // Stable host → accept resize
    expect(shouldSendResize(size, { width: 800, height: 600 })).toBe(true)

    // Recovery needs enough suspect resizes AND cooldown elapsed
    expect(shouldRecoverDesync({ suspect: 1, now: 5000, last: 0 })).toBe(false)
    expect(shouldRecoverDesync({ suspect: 3, now: 5000, last: 0 })).toBe(true)
    // Cooldown prevents immediate re-recovery
    expect(shouldRecoverDesync({ suspect: 3, now: 5000, last: 4000 })).toBe(false)

    // Recovery resize (SIGWINCH toggle) doesn't crash xterm
    const [first, second] = sigwinchToggleSize(t.xterm.cols, t.xterm.rows)
    expect(() => {
      t.xterm.resize(first.cols, first.rows)
      t.xterm.resize(second.cols, second.rows)
    }).not.toThrow()

    const lines = allLines(t.xterm).join("\n")
    expect(lines).toContain("content")

    t.cleanup()
  })
})

// ---------------------------------------------------------------------------
// Test: Retry utility
// ---------------------------------------------------------------------------

describe("retry utility", () => {
  test("succeeds on nth attempt and reports success", async () => {
    let attempts = 0

    const done = await new Promise<boolean>((resolve) => {
      retry(
        () => {
          attempts++
          return attempts >= 3
        },
        {
          delay: 5,
          max: 8,
          onDone: resolve,
        },
      )
    })

    expect(done).toBe(true)
    expect(attempts).toBe(3)
  })

  test("gives up after max attempts and reports failure", async () => {
    let attempts = 0

    const done = await new Promise<boolean>((resolve) => {
      retry(
        () => {
          attempts++
          return false
        },
        {
          delay: 5,
          max: 4,
          onDone: resolve,
        },
      )
    })

    expect(done).toBe(false)
    expect(attempts).toBe(4)
  })

  test("stop() prevents further attempts", async () => {
    let attempts = 0

    const stop = retry(
      () => {
        attempts++
        return false
      },
      { delay: 5, max: 100 },
    )

    // Let a few attempts run
    await new Promise<void>((r) => setTimeout(r, 25))
    const stoppedAt = attempts
    stop()

    // Verify at least 1 attempt ran but didn't reach max
    expect(stoppedAt).toBeGreaterThan(0)
    expect(stoppedAt).toBeLessThan(100)

    // Wait and verify no more attempts happen
    await new Promise<void>((r) => setTimeout(r, 50))
    expect(attempts).toBe(stoppedAt)
  })
})
