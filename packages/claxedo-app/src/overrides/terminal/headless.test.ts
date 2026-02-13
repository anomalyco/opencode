import { describe, expect, test } from "bun:test"
import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"

// ---------------------------------------------------------------------------
// Layer 1: xterm/headless tests
//
// These tests exercise the terminal buffer model without any DOM or canvas.
// They catch classes of bugs that corrupt rendering on focus-switch:
//   - Serialize/restore dropping content or cursor position
//   - Resize during active writes causing buffer corruption
//   - Write callbacks not firing after resize (stalls runtime queue)
//
// IMPORTANT: xterm/headless write() is async — callbacks fire on microtask.
// All tests that read buffer state after write must await the callback.
// ---------------------------------------------------------------------------

function makeTerminal(opts?: { cols?: number; rows?: number; scrollback?: number }) {
  const cols = opts?.cols ?? 80
  const rows = opts?.rows ?? 24
  const scrollback = opts?.scrollback ?? 1000
  const xterm = new Terminal({ cols, rows, scrollback, allowProposedApi: true })
  const serialize = new SerializeAddon()
  xterm.loadAddon(serialize)
  return { xterm, serialize }
}

/** Promise wrapper around xterm.write — waits for the async callback. */
function write(xterm: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => xterm.write(data, resolve))
}

/** Write multiple chunks sequentially, waiting for each callback. */
async function writeAll(xterm: Terminal, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await write(xterm, chunk)
  }
}

function getLine(xterm: Terminal, row: number): string {
  return xterm.buffer.active.getLine(row)?.translateToString(true) ?? ""
}

function allLines(xterm: Terminal): string[] {
  const buf = xterm.buffer.active
  const out: string[] = []
  for (let i = 0; i < buf.length; i++) {
    out.push(buf.getLine(i)?.translateToString(true) ?? "")
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. Buffer integrity across serialize/restore
// ---------------------------------------------------------------------------

describe("buffer serialize/restore cycle", () => {
  test("plain text survives roundtrip", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()
    await writeAll(t1, [
      "$ ls -la\r\n",
      "total 42\r\n",
      "drwxr-xr-x  5 user staff  160 Jan 10 09:00 .\r\n",
    ])

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })

    const { xterm: t2, serialize: s2 } = makeTerminal()
    await write(t2, snapshot)

    const reserialized = s2.serialize({ excludeAltBuffer: true, excludeModes: true })
    expect(reserialized).toBe(snapshot)

    t1.dispose()
    t2.dispose()
  })

  test("ANSI colors survive roundtrip", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()
    await write(t1, "\x1b[32mgreen\x1b[0m \x1b[1;31mbold-red\x1b[0m normal\r\n")

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    const { xterm: t2, serialize: s2 } = makeTerminal()
    await write(t2, snapshot)

    expect(s2.serialize({ excludeAltBuffer: true, excludeModes: true })).toBe(snapshot)

    t1.dispose()
    t2.dispose()
  })

  test("cursor position preserved across roundtrip", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()
    await writeAll(t1, ["line1\r\n", "line2\r\n", "$ "])

    const cursorX = t1.buffer.active.cursorX
    const cursorY = t1.buffer.active.cursorY

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    const { xterm: t2 } = makeTerminal()
    await write(t2, snapshot)

    expect(t2.buffer.active.cursorX).toBe(cursorX)
    expect(t2.buffer.active.cursorY).toBe(cursorY)

    t1.dispose()
    t2.dispose()
  })

  test("scrollback content preserved across roundtrip", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal({ rows: 5, scrollback: 100 })

    for (let i = 0; i < 20; i++) {
      await write(t1, `line ${i}\r\n`)
    }

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    const { xterm: t2 } = makeTerminal({ rows: 5, scrollback: 100 })
    await write(t2, snapshot)

    const t1Lines = allLines(t1)
    const t2Lines = allLines(t2)
    expect(t2Lines).toEqual(t1Lines)

    t1.dispose()
    t2.dispose()
  })

  test("serialize with different cols reflows content correctly", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal({ cols: 80 })
    await write(t1, "short\r\n")

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })

    // Restore into a narrower terminal (simulates fit() finding smaller container)
    const { xterm: t2 } = makeTerminal({ cols: 40 })
    await write(t2, snapshot)

    expect(getLine(t2, 0)).toBe("short")

    t1.dispose()
    t2.dispose()
  })

  test("empty buffer produces empty serialize that restores cleanly", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    const { xterm: t2, serialize: s2 } = makeTerminal()
    if (snapshot) await write(t2, snapshot)

    expect(s2.serialize({ excludeAltBuffer: true, excludeModes: true })).toBe(snapshot)

    t1.dispose()
    t2.dispose()
  })
})

// ---------------------------------------------------------------------------
// 2. Resize + write interleaving (simulates fit() during focus switch)
// ---------------------------------------------------------------------------

describe("resize during active writes", () => {
  test("write callback fires after resize mid-stream", async () => {
    const { xterm } = makeTerminal()
    const order: string[] = []

    const p1 = new Promise<void>((resolve) =>
      xterm.write("before resize\r\n", () => {
        order.push("first")
        resolve()
      }),
    )

    // Resize mid-stream (simulates fitAddon.fit() during focus change)
    xterm.resize(120, 30)

    const p2 = new Promise<void>((resolve) =>
      xterm.write("after resize\r\n", () => {
        order.push("second")
        resolve()
      }),
    )

    await Promise.all([p1, p2])
    expect(order).toEqual(["first", "second"])

    xterm.dispose()
  })

  test("buffer content correct after resize between writes", async () => {
    const { xterm } = makeTerminal({ cols: 80, rows: 24 })

    await write(xterm, "line-before\r\n")
    xterm.resize(60, 20)
    await write(xterm, "line-after\r\n")

    const lines = allLines(xterm)
    expect(lines.some((l) => l.includes("line-before"))).toBe(true)
    expect(lines.some((l) => l.includes("line-after"))).toBe(true)

    xterm.dispose()
  })

  test("rapid resize oscillation does not corrupt buffer", async () => {
    const { xterm, serialize } = makeTerminal({ cols: 80, rows: 24 })

    await write(xterm, "stable content\r\n")

    // Simulate SIGWINCH toggle pattern (cols-1, then cols) used in the codebase
    for (let i = 0; i < 10; i++) {
      xterm.resize(79, 24)
      xterm.resize(80, 24)
    }

    await write(xterm, "after oscillation\r\n")

    const lines = allLines(xterm)
    expect(lines.some((l) => l.includes("stable content"))).toBe(true)
    expect(lines.some((l) => l.includes("after oscillation"))).toBe(true)

    // Serialize should still work
    const snapshot = serialize.serialize({ excludeAltBuffer: true, excludeModes: true })
    expect(snapshot.length).toBeGreaterThan(0)

    xterm.dispose()
  })

  test("resize to minimum cols/rows does not throw", async () => {
    const { xterm } = makeTerminal()
    await write(xterm, "some content\r\n")

    // xterm clamps to minimum 2x1 internally but shouldn't throw
    expect(() => xterm.resize(2, 1)).not.toThrow()
    await write(xterm, "ok\r\n")

    // With 2 cols, content wraps heavily but buffer should still be readable
    const joined = allLines(xterm).join("")
    expect(joined).toContain("ok")

    xterm.dispose()
  })

  test("write + resize + serialize is stable", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()

    await write(t1, "before\r\n")
    t1.resize(100, 30)
    await write(t1, "after\r\n")

    const snap1 = s1.serialize({ excludeAltBuffer: true, excludeModes: true })

    // Restore and resize back
    const { xterm: t2 } = makeTerminal({ cols: 100, rows: 30 })
    await write(t2, snap1)
    t2.resize(80, 24)

    const t2Lines = allLines(t2).filter((l) => l.trim())

    expect(t2Lines.some((l) => l.includes("before"))).toBe(true)
    expect(t2Lines.some((l) => l.includes("after"))).toBe(true)

    t1.dispose()
    t2.dispose()
  })
})

// ---------------------------------------------------------------------------
// 3. Write callback ordering and completion guarantees
// ---------------------------------------------------------------------------

describe("write callback guarantees", () => {
  test("callbacks fire in write order", async () => {
    const { xterm } = makeTerminal()
    const order: number[] = []

    const p1 = new Promise<void>((r) => xterm.write("first\r\n", () => { order.push(1); r() }))
    const p2 = new Promise<void>((r) => xterm.write("second\r\n", () => { order.push(2); r() }))
    const p3 = new Promise<void>((r) => xterm.write("third\r\n", () => { order.push(3); r() }))

    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])

    xterm.dispose()
  })

  test("callback fires even for empty write", async () => {
    const { xterm } = makeTerminal()
    let called = false

    await new Promise<void>((resolve) =>
      xterm.write("", () => {
        called = true
        resolve()
      }),
    )

    expect(called).toBe(true)

    xterm.dispose()
  })

  test("large batch of writes all complete callbacks", async () => {
    const { xterm } = makeTerminal()
    let count = 0
    const total = 200

    const promises: Promise<void>[] = []
    for (let i = 0; i < total; i++) {
      promises.push(
        new Promise<void>((r) =>
          xterm.write(`line ${i}\r\n`, () => {
            count++
            r()
          }),
        ),
      )
    }

    await Promise.all(promises)
    expect(count).toBe(total)

    xterm.dispose()
  })

  test("write callback fires even when resize happens between write and callback", async () => {
    const { xterm } = makeTerminal()

    // Queue a write
    const p = new Promise<void>((resolve) =>
      xterm.write("data before resize callback\r\n", resolve),
    )

    // Resize immediately (before callback fires)
    xterm.resize(60, 20)

    // Callback should still fire
    await p

    const lines = allLines(xterm)
    expect(lines.some((l) => l.includes("data before resize callback"))).toBe(true)

    xterm.dispose()
  })
})

// ---------------------------------------------------------------------------
// 4. Focus-switch simulation: serialize → resize → restore → resume writes
// ---------------------------------------------------------------------------

describe("focus-switch simulation", () => {
  test("full focus-switch cycle: serialize, new terminal, restore, resume", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()

    await writeAll(t1, [
      "$ npm install\r\n",
      "added 1234 packages in 12s\r\n",
      "$ ",
    ])

    const cursor = {
      x: t1.buffer.active.cursorX,
      y: t1.buffer.active.cursorY,
    }
    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })

    // Simulate: terminal unmounts (portal remount)
    t1.dispose()

    // New terminal mounts (portal targets new host)
    const { xterm: t2, serialize: s2 } = makeTerminal()

    // Restore saved state (as terminal.tsx onMount does)
    await write(t2, snapshot)

    expect(t2.buffer.active.cursorX).toBe(cursor.x)
    expect(t2.buffer.active.cursorY).toBe(cursor.y)

    // Fit to potentially different container size
    t2.resize(100, 30)

    // Resume receiving data from WebSocket
    await writeAll(t2, ["echo hello\r\n", "hello\r\n", "$ "])

    const lines = allLines(t2)
    expect(lines.some((l) => l.includes("added 1234 packages"))).toBe(true)
    expect(lines.some((l) => l.includes("hello"))).toBe(true)

    // Should still be serializable
    const snap2 = s2.serialize({ excludeAltBuffer: true, excludeModes: true })
    expect(snap2.length).toBeGreaterThan(snapshot.length)

    t2.dispose()
  })

  test("pending data queued during restore arrives after flush", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()
    await write(t1, "$ running\r\n")

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    const { xterm: t2 } = makeTerminal()

    // Write restore buffer first
    await write(t2, snapshot)

    // Then write pending chunks (simulates flushPending → enqueueLive → drain)
    await writeAll(t2, ["output-A\r\n", "output-B\r\n", "output-C\r\n"])

    const lines = allLines(t2)
    expect(lines.some((l) => l.includes("output-A"))).toBe(true)
    expect(lines.some((l) => l.includes("output-B"))).toBe(true)
    expect(lines.some((l) => l.includes("output-C"))).toBe(true)

    t2.dispose()
  })

  test("double serialize/restore (rapid tab switch) is stable", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()
    await write(t1, "original content\r\n")

    // First cycle
    const snap1 = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    const { xterm: t2, serialize: s2 } = makeTerminal()
    await write(t2, snap1)
    await write(t2, "added in t2\r\n")

    // Second cycle immediately (user switches away and back quickly)
    const snap2 = s2.serialize({ excludeAltBuffer: true, excludeModes: true })
    t2.dispose()

    const { xterm: t3 } = makeTerminal()
    await write(t3, snap2)

    const lines = allLines(t3)
    expect(lines.some((l) => l.includes("original content"))).toBe(true)
    expect(lines.some((l) => l.includes("added in t2"))).toBe(true)

    t3.dispose()
  })

  test("restore into different dimensions preserves logical content", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal({ cols: 80, rows: 24 })

    await writeAll(t1, [
      "$ git log --oneline\r\n",
      "abc1234 feat: add split workspace\r\n",
      "def5678 fix: terminal focus in groups\r\n",
    ])

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    // Restore into a very different size (split panel is narrower/shorter)
    const { xterm: t2 } = makeTerminal({ cols: 50, rows: 12 })
    await write(t2, snapshot)

    const joined = allLines(t2).join("\n")
    expect(joined).toContain("abc1234")
    expect(joined).toContain("def5678")

    t2.dispose()
  })

  test("TUI escape sequences do not leak through excludeModes serialize", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal()

    // Simulate a TUI that enables bracketed paste and cursor keys
    await writeAll(t1, [
      "\x1b[?2004h",        // Enable bracketed paste
      "\x1b[?1h",           // Enable cursor keys (DECCKM)
      "visible text\r\n",
      "\x1b[?25l",          // Hide cursor
    ])

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })

    const { xterm: t2 } = makeTerminal()
    await write(t2, snapshot)

    // The visible text should survive
    const lines = allLines(t2)
    expect(lines.some((l) => l.includes("visible text"))).toBe(true)

    // Modes should NOT be carried over (t2 starts with default modes)
    expect(t2.modes.bracketedPasteMode).toBe(false)

    t1.dispose()
    t2.dispose()
  })

  test("concurrent writes to two terminals do not interfere (split panels)", async () => {
    const { xterm: tA, serialize: sA } = makeTerminal()
    const { xterm: tB, serialize: sB } = makeTerminal()

    // Both terminals receive data concurrently
    await Promise.all([
      writeAll(tA, ["panel-A line 1\r\n", "panel-A line 2\r\n"]),
      writeAll(tB, ["panel-B line 1\r\n", "panel-B line 2\r\n"]),
    ])

    const linesA = allLines(tA)
    const linesB = allLines(tB)

    // No cross-contamination
    expect(linesA.some((l) => l.includes("panel-A line 1"))).toBe(true)
    expect(linesA.some((l) => l.includes("panel-B"))).toBe(false)
    expect(linesB.some((l) => l.includes("panel-B line 1"))).toBe(true)
    expect(linesB.some((l) => l.includes("panel-A"))).toBe(false)

    // Both serialize independently
    const snapA = sA.serialize({ excludeAltBuffer: true, excludeModes: true })
    const snapB = sB.serialize({ excludeAltBuffer: true, excludeModes: true })
    expect(snapA).not.toBe(snapB)

    tA.dispose()
    tB.dispose()
  })

  test("resize after restore does not lose content in scrollback", async () => {
    const { xterm: t1, serialize: s1 } = makeTerminal({ cols: 80, rows: 10, scrollback: 200 })

    // Fill up scrollback
    for (let i = 0; i < 50; i++) {
      await write(t1, `scrollback-line-${i}\r\n`)
    }

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    const { xterm: t2 } = makeTerminal({ cols: 80, rows: 10, scrollback: 200 })
    await write(t2, snapshot)

    // Resize (simulates fit() on new container)
    t2.resize(60, 15)

    const joined = allLines(t2).join("\n")
    // Early scrollback content should still be present
    expect(joined).toContain("scrollback-line-0")
    // Recent content should still be present
    expect(joined).toContain("scrollback-line-49")

    t2.dispose()
  })
})

// ---------------------------------------------------------------------------
// 5. TUI re-render duplication after resize
//
// Demonstrates a class of bugs where Ink-style TUI apps (like Codex) show
// their UI twice after a terminal resize or portal remount. The root cause:
// xterm rewraps buffer content immediately on resize, changing line counts,
// but the TUI process still uses the pre-resize line count for cursor-up.
// The cursor-up deficit leaves stale content above the clear point — the
// OLD header/top portion survives, and the NEW full render appears below it.
//
// The duplication is at the TOP of the old render (not the bottom), because
// cursor-up N from the (adjusted) cursor doesn't reach row 0 when N is stale.
// ---------------------------------------------------------------------------

/** Simulate Ink-style TUI re-render: cursor up N, clear to end, write new content */
function inkRerender(lineCount: number, newContent: string): string {
  return `\x1b[${lineCount}A\x1b[J\r${newContent}`
}

/** Count occurrences of a substring across all buffer lines */
function countOccurrences(xterm: Terminal, needle: string): number {
  const lines = allLines(xterm)
  let count = 0
  for (const line of lines) {
    let idx = 0
    while ((idx = line.indexOf(needle, idx)) !== -1) {
      count++
      idx += needle.length
    }
  }
  return count
}

describe("TUI re-render duplication after resize", () => {
  // ---------------------------------------------------------------------------
  // RED tests: document the xterm-level root cause.
  //
  // xterm rewraps buffer content immediately on resize, changing line counts,
  // but the TUI process still uses pre-resize line count for cursor-up.
  // The cursor-up deficit leaves stale content above the clear point.
  //
  // These tests are SKIPPED — they prove the bug exists at the xterm level.
  // They pass with `expect(markerCount).toBe(2)` but we assert `.toBe(1)`
  // to document the expected (correct) behavior.
  // The fix lives in the resize coordinator (clear-before-flush), tested
  // separately in the GREEN companion tests below.
  // ---------------------------------------------------------------------------

  test.skip("resize shrink causes stale cursor-up — TUI header duplicated", async () => {
    // 1. Create xterm at 200 cols — TUI renders 2 lines
    const { xterm } = makeTerminal({ cols: 200, rows: 24 })

    // TUI frame: 200-char header line (marker + fill chars) + prompt = 2 lines at width 200
    const marker = "=== CODEX TUI ==="
    const headerLine = marker + "-".repeat(200 - marker.length)
    await write(xterm, headerLine + "\r\nprompt> \r\n")

    // 2. Resize to 100 cols — the 200-char header rewraps to 2 rows
    //    xterm adjusts cursor: row 2 → row 3 (one extra row from rewrap)
    //    Total visible: 2 (header rows) + 1 (prompt) = 3 rows
    xterm.resize(100, 24)

    // Verify rewrap: cursor should have shifted from row 2 to row 3
    expect(xterm.buffer.active.cursorY).toBe(3)

    // 3. Simulate Ink SIGWINCH response with STALE cursor-up of 2 (pre-resize count)
    //    Cursor is at row 3. cursor-up 2 → row 1. \x1b[J clears rows 1+.
    //    Row 0 (old header with marker) SURVIVES above the clear point.
    const newHeaderLine = marker + "-".repeat(100 - marker.length)
    const newTuiContent = newHeaderLine + "\r\nprompt> \r\n"
    await write(xterm, inkRerender(2, newTuiContent))

    // 4. BUG: marker appears at row 0 (old, survived) AND in new content below
    //    Should be 1, but stale cursor-up leaves old header intact → count is 2
    const markerCount = countOccurrences(xterm, marker)
    expect(markerCount).toBe(1)

    xterm.dispose()
  })

  test.skip("buffer restore into narrower terminal + SIGWINCH causes duplication", async () => {
    const marker = "=== CODEX TUI ==="

    // 1. Create at 200 cols, write TUI content, serialize, dispose
    const { xterm: t1, serialize: s1 } = makeTerminal({ cols: 200, rows: 24 })
    const headerLine = marker + "-".repeat(200 - marker.length)
    await write(t1, headerLine + "\r\nprompt> \r\n")

    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    // 2. Restore into a 100-col terminal — serialized content gets written and
    //    xterm wraps the 200-char header into 2 rows at the new width
    const { xterm: t2 } = makeTerminal({ cols: 100, rows: 24 })
    await write(t2, snapshot)

    // Verify cursor position reflects rewrap (should be at row 3, not row 2)
    expect(t2.buffer.active.cursorY).toBeGreaterThanOrEqual(3)

    // 3. Simulate Ink SIGWINCH response with stale cursor-up 2
    const newHeaderLine = marker + "-".repeat(100 - marker.length)
    const newTuiContent = newHeaderLine + "\r\nprompt> \r\n"
    await write(t2, inkRerender(2, newTuiContent))

    // 4. BUG: old header survives above the clear point
    const markerCount = countOccurrences(t2, marker)
    expect(markerCount).toBe(1)

    t2.dispose()
  })

  test.skip("multiple long lines amplify the cursor-up deficit", async () => {
    const marker = "=== CODEX HEADER ==="

    // 1. Create at 120 cols — TUI renders 3 lines
    const { xterm } = makeTerminal({ cols: 120, rows: 24 })

    // 3-line TUI: header (120 chars, contains marker) + content (120 chars) + prompt
    const headerLine = marker + "Y".repeat(120 - marker.length)
    await write(
      xterm,
      headerLine + "\r\n" +
      "Y".repeat(120) + "\r\n" +
      "prompt> \r\n",
    )

    // 2. Resize to 60 cols — each 120-char line → 2 rows
    //    Total: 2 + 2 + 1 = 5 rows (was 3 lines)
    //    Cursor adjusts: row 3 → row 5 (2 extra rows from rewrap)
    xterm.resize(60, 24)

    const linesAfterResize = allLines(xterm).filter((l) => l.trim().length > 0)
    expect(linesAfterResize.length).toBeGreaterThanOrEqual(5)

    // 3. Ink re-renders with stale cursor-up 3 (pre-resize line count)
    //    Cursor at row 5. cursor-up 3 → row 2. Rows 0-1 (old header) survive.
    const newHeaderLine = marker + "Y".repeat(60 - marker.length)
    const newTuiContent =
      newHeaderLine + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "prompt> \r\n"
    await write(xterm, inkRerender(3, newTuiContent))

    // 4. BUG: stale cursor-up 3 misses 2 rows, old header at rows 0-1 survives
    const markerCount = countOccurrences(xterm, marker)
    expect(markerCount).toBe(1)

    xterm.dispose()
  })

  // ---------------------------------------------------------------------------
  // GREEN companion tests: prove that clear-before-flush fixes the duplication.
  //
  // These inject \x1b[H\x1b[2J (home + clear visible screen) after resize
  // and before TUI re-render — exactly what the coordinator's clear() does.
  // ---------------------------------------------------------------------------

  test("clear-before-flush fixes resize shrink duplication (GREEN proof)", async () => {
    const { xterm } = makeTerminal({ cols: 200, rows: 24 })

    const marker = "=== CODEX TUI ==="
    const headerLine = marker + "-".repeat(200 - marker.length)
    await write(xterm, headerLine + "\r\nprompt> \r\n")

    xterm.resize(100, 24)
    await write(xterm, "\x1b[H\x1b[2J")

    const newHeaderLine = marker + "-".repeat(100 - marker.length)
    await write(xterm, inkRerender(2, newHeaderLine + "\r\nprompt> \r\n"))

    expect(countOccurrences(xterm, marker)).toBe(1)
    xterm.dispose()
  })

  test("clear-before-flush fixes restore duplication (GREEN proof)", async () => {
    const marker = "=== CODEX TUI ==="

    const { xterm: t1, serialize: s1 } = makeTerminal({ cols: 200, rows: 24 })
    const headerLine = marker + "-".repeat(200 - marker.length)
    await write(t1, headerLine + "\r\nprompt> \r\n")
    const snapshot = s1.serialize({ excludeAltBuffer: true, excludeModes: true })
    t1.dispose()

    const { xterm: t2 } = makeTerminal({ cols: 100, rows: 24 })
    await write(t2, snapshot)
    await write(t2, "\x1b[H\x1b[2J")

    const newHeaderLine = marker + "-".repeat(100 - marker.length)
    await write(t2, inkRerender(2, newHeaderLine + "\r\nprompt> \r\n"))

    expect(countOccurrences(t2, marker)).toBe(1)
    t2.dispose()
  })

  test("clear-before-flush fixes multi-line duplication (GREEN proof)", async () => {
    const marker = "=== CODEX HEADER ==="

    const { xterm } = makeTerminal({ cols: 120, rows: 24 })
    const headerLine = marker + "Y".repeat(120 - marker.length)
    await write(
      xterm,
      headerLine + "\r\n" +
      "Y".repeat(120) + "\r\n" +
      "prompt> \r\n",
    )

    xterm.resize(60, 24)
    await write(xterm, "\x1b[H\x1b[2J")

    const newHeaderLine = marker + "Y".repeat(60 - marker.length)
    await write(xterm, inkRerender(3,
      newHeaderLine + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "Y".repeat(60) + "\r\n" +
      "prompt> \r\n",
    ))

    expect(countOccurrences(xterm, marker)).toBe(1)
    xterm.dispose()
  })

  test("clear NOT injected when dims unchanged — no duplication (GREEN proof)", async () => {
    const marker = "=== CODEX TUI ==="

    const { xterm } = makeTerminal({ cols: 80, rows: 24 })
    await write(xterm, marker + "\r\nprompt> \r\n")

    // Resize to same effective width (no rewrap) — no clear injected
    xterm.resize(80, 24)

    // TUI re-renders
    await write(xterm, inkRerender(2, marker + "\r\nprompt> \r\n"))

    const markerCount = countOccurrences(xterm, marker)
    expect(markerCount).toBe(1)

    xterm.dispose()
  })

  test("SIGWINCH toggle without rewrap does NOT cause duplication (GREEN contrast)", async () => {
    const marker = "=== CODEX TUI ==="

    // 1. Create at 80 cols — TUI renders 2 lines with short content (no wrapping)
    const { xterm } = makeTerminal({ cols: 80, rows: 24 })

    // Short header (17 chars) + prompt — well under 79 cols, no rewrap on toggle
    await write(xterm, marker + "\r\nprompt> \r\n")

    // 2. Simulate SIGWINCH toggle: resize to 79 cols, TUI re-renders
    //    No rewrap: 17-char header fits in 79 cols, cursor-up 2 is still correct
    xterm.resize(79, 24)
    await write(xterm, inkRerender(2, marker + "\r\nprompt> \r\n"))

    // 3. Toggle back to 80 cols, TUI re-renders again
    xterm.resize(80, 24)
    await write(xterm, inkRerender(2, marker + "\r\nprompt> \r\n"))

    // 4. No rewrap occurred, so cursor-up 2 fully covers the old content.
    //    Marker should appear exactly 1 time — this test PASSES (GREEN).
    const markerCount = countOccurrences(xterm, marker)
    expect(markerCount).toBe(1)

    xterm.dispose()
  })
})
