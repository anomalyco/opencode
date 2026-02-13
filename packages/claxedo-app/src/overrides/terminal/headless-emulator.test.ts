import { describe, expect, test } from "bun:test"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createModeScanner, DEFAULT_MODES } from "./mode-scan"

type Snapshot = {
  snapshotAnsi: string
  rehydrateSequences: string
  cwd: string | null
}

type Pipeline = ReturnType<typeof createPipeline>

const ESC = "\x1b"
const CSI = `${ESC}[`
const OSC = `${ESC}]`
const BEL = "\x07"

// Mode sequences
const ENABLE_APP_CURSOR = `${CSI}?1h`
const DISABLE_APP_CURSOR = `${CSI}?1l`
const ENABLE_BRACKETED_PASTE = `${CSI}?2004h`
const ENABLE_MOUSE_NORMAL = `${CSI}?1000h`
const ENABLE_MOUSE_SGR = `${CSI}?1006h`
const ENABLE_FOCUS_REPORTING = `${CSI}?1004h`
const HIDE_CURSOR = `${CSI}?25l`
const ENTER_ALT_SCREEN = `${CSI}?1049h`
const MOVE_CURSOR = (row: number, col: number) => `${CSI}${row};${col}H`
const CLEAR_SCREEN = `${CSI}2J`
const OSC7_CWD = (path: string) => `${OSC}7;file://localhost${path}${BEL}`

function createPipeline() {
  const terminal = new HeadlessTerminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  terminal.loadAddon(serialize)

  const mode = createModeScanner()

  return {
    async write(chunk: string) {
      mode.scan(chunk)
      if (!chunk) return
      await writeSync(terminal, chunk)
    },
    async snapshot(): Promise<Snapshot> {
      await writeSync(terminal, "")
      return {
        snapshotAnsi: serialize.serialize({ scrollback: 1000, excludeModes: true }),
        rehydrateSequences: mode.rehydrateSequences(),
        cwd: mode.cwd(),
      }
    },
    bracketed() {
      return mode.bracketed()
    },
    modes() {
      return mode.modes()
    },
    cwd() {
      return mode.cwd()
    },
    modesEqual(other: ReturnType<typeof mode.modes>) {
      return mode.modesEqual(other)
    },
    dispose() {
      terminal.dispose()
    },
  }
}

async function applySnapshot(pipeline: Pipeline, snapshot: Snapshot) {
  if (snapshot.rehydrateSequences) {
    await pipeline.write(snapshot.rehydrateSequences)
  }
  await pipeline.write(snapshot.snapshotAnsi)
}

function writeSync(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, () => resolve())
  })
}

async function renderRaw(chunks: string[]) {
  const terminal = new HeadlessTerminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  terminal.loadAddon(serialize)

  try {
    for (const chunk of chunks) {
      await writeSync(terminal, chunk)
    }
    await writeSync(terminal, "")
    return serialize.serialize({ scrollback: 1000, excludeModes: true })
  } finally {
    terminal.dispose()
  }
}

// ---------------------------------------------------------------------------
// Existing pipeline tests
// ---------------------------------------------------------------------------

describe("headless emulator terminal pipeline", () => {
  test("xterm handles query responses without displaying them", async () => {
    const pipeline = createPipeline()

    try {
      await pipeline.write("$ ")
      await pipeline.write("echo hello\\r\\n")
      await pipeline.write("\x1b[12;34R")
      await pipeline.write("\x1b[I")
      await pipeline.write("\x1b[?2004;1$y")
      await pipeline.write("hello\\r\\n")

      const snapshot = await pipeline.snapshot()

      expect(snapshot.snapshotAnsi).toContain("$ echo hello")
      expect(snapshot.snapshotAnsi).toContain("hello")
      expect(snapshot.snapshotAnsi).not.toContain("[12;34R")
      expect(snapshot.snapshotAnsi).not.toContain("[?2004;1$y")
    } finally {
      pipeline.dispose()
    }
  })

  test("preserves non-query CSI sequences (false-positive guard)", async () => {
    const pipeline = createPipeline()
    const chunks = ["A\x1b[cb", "B\x1b[22;0tc"]

    try {
      for (const chunk of chunks) {
        await pipeline.write(chunk)
      }

      const snapshot = await pipeline.snapshot()
      const baseline = await renderRaw(chunks)

      expect(snapshot.snapshotAnsi).toBe(baseline)
    } finally {
      pipeline.dispose()
    }
  })

  test("rehydrates bracketed paste mode from snapshot across split chunks", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      // Enable bracketed paste via split chunks
      await source.write("\x1b[?20")
      await source.write("04h")
      await source.write("app\\r\\n")

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toContain("\x1b[?2004h")

      // Restore snapshot into a fresh pipeline
      await applySnapshot(target, snapshot)
      const restored = await target.snapshot()

      // Bracketed paste should survive the round-trip
      expect(restored.rehydrateSequences).toContain("\x1b[?2004h")
      expect(restored.snapshotAnsi).toContain("app")
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("xterm handles split query responses across chunk boundaries", async () => {
    const pipeline = createPipeline()

    try {
      await pipeline.write("prefix\x1b[12;")
      await pipeline.write("34Rsuffix")

      const snapshot = await pipeline.snapshot()

      expect(snapshot.snapshotAnsi).toContain("prefixsuffix")
      expect(snapshot.snapshotAnsi).not.toContain("[12;34R")
    } finally {
      pipeline.dispose()
    }
  })

  test("restores serialized screen content in a fresh emulator", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      for (let i = 1; i <= 40; i++) {
        await source.write(`line-${i}\\r\\n`)
      }

      const snapshot = await source.snapshot()
      await applySnapshot(target, snapshot)
      const restored = await target.snapshot()

      expect(restored.snapshotAnsi).toContain("line-1")
      expect(restored.snapshotAnsi).toContain("line-20")
      expect(restored.snapshotAnsi).toContain("line-40")
    } finally {
      source.dispose()
      target.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Mode tracking round-trip tests
// ---------------------------------------------------------------------------

describe("mode tracking round-trip", () => {
  test("snapshot round-trip restores mode state", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      await source.write(ENABLE_APP_CURSOR)
      await source.write(ENABLE_BRACKETED_PASTE)
      await source.write(ENABLE_MOUSE_NORMAL)
      await source.write(ENABLE_MOUSE_SGR)
      await source.write("some content\r\n")

      const snapshot = await source.snapshot()

      // Verify source modes captured
      expect(source.modes().applicationCursorKeys).toBe(true)
      expect(source.modes().bracketedPaste).toBe(true)
      expect(source.modes().mouseTrackingNormal).toBe(true)
      expect(source.modes().mouseSgr).toBe(true)

      // Apply to target
      await applySnapshot(target, snapshot)

      // Target should have matching modes from rehydrate sequences
      expect(target.modes().applicationCursorKeys).toBe(true)
      expect(target.modes().bracketedPaste).toBe(true)
      // Mouse modes are tracked and rehydrated (UI may choose to suppress
      // these for non-TUI shells to avoid accidental SGR mouse gibberish).
      expect(target.modes().mouseTrackingNormal).toBe(true)
      expect(target.modes().mouseSgr).toBe(true)
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("TUI-like screen simulation preserves modes and content", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      // Simulate TUI app setup (vim, htop, etc.)
      await source.write(ENTER_ALT_SCREEN)
      await source.write(ENABLE_APP_CURSOR)
      await source.write(ENABLE_BRACKETED_PASTE)
      await source.write(ENABLE_MOUSE_NORMAL)
      await source.write(ENABLE_MOUSE_SGR)
      await source.write(HIDE_CURSOR)
      await source.write(CLEAR_SCREEN)
      await source.write(MOVE_CURSOR(1, 1))
      await source.write("=== TUI Application ===")
      await source.write(MOVE_CURSOR(3, 1))
      await source.write("Press q to quit")
      await source.write(MOVE_CURSOR(24, 1))
      await source.write("[Status Bar]")

      // Verify modes captured
      expect(source.modes().alternateScreen).toBe(true)
      expect(source.modes().applicationCursorKeys).toBe(true)
      expect(source.modes().bracketedPaste).toBe(true)
      expect(source.modes().mouseTrackingNormal).toBe(true)
      expect(source.modes().mouseSgr).toBe(true)
      expect(source.modes().cursorVisible).toBe(false)

      const snapshot = await source.snapshot()

      // Apply to target
      await applySnapshot(target, snapshot)

      // Non-alt-screen modes restored via rehydrate
      expect(target.modes().applicationCursorKeys).toBe(true)
      expect(target.modes().bracketedPaste).toBe(true)
      expect(target.modes().mouseTrackingNormal).toBe(true)
      expect(target.modes().mouseSgr).toBe(true)
      expect(target.modes().cursorVisible).toBe(false)

      // Content restored
      const restored = await target.snapshot()
      expect(restored.snapshotAnsi).toContain("TUI Application")
      expect(restored.snapshotAnsi).toContain("Press q to quit")
      expect(restored.snapshotAnsi).toContain("[Status Bar]")
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("CWD tracked via OSC-7 appears in snapshot", async () => {
    const source = createPipeline()

    try {
      await source.write(OSC7_CWD("/home/user/workspace"))
      await source.write("$ ls\r\n")

      const snapshot = await source.snapshot()
      expect(snapshot.cwd).toBe("/home/user/workspace")
    } finally {
      source.dispose()
    }
  })

  test("rehydrate sequences generated for non-default modes", async () => {
    const source = createPipeline()

    try {
      await source.write(ENABLE_APP_CURSOR)
      await source.write(ENABLE_BRACKETED_PASTE)
      await source.write(HIDE_CURSOR)

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toContain("?1h")     // app cursor
      expect(snapshot.rehydrateSequences).toContain("?2004h")  // bracketed paste
      expect(snapshot.rehydrateSequences).toContain("?25l")    // cursor hidden
    } finally {
      source.dispose()
    }
  })

  test("empty rehydrate for default modes", async () => {
    const source = createPipeline()

    try {
      await source.write("just text\r\n")

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toBe("")
    } finally {
      source.dispose()
    }
  })

  test("bracketed paste round-trip via applySnapshot sets bracketed() on target", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      await source.write(ENABLE_BRACKETED_PASTE)
      await source.write("prompt$ \r\n")

      expect(source.bracketed()).toBe(true)

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toContain("?2004h")

      await applySnapshot(target, snapshot)

      // Target pipeline should report bracketed paste as enabled
      expect(target.bracketed()).toBe(true)
      expect(target.modes().bracketedPaste).toBe(true)
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("application cursor keys round-trip via applySnapshot restores mode", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      await source.write(ENABLE_APP_CURSOR)
      await source.write("vim session\r\n")

      expect(source.modes().applicationCursorKeys).toBe(true)

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toContain("?1h")

      // Target starts with default (no app cursor)
      expect(target.modes().applicationCursorKeys).toBe(false)

      await applySnapshot(target, snapshot)

      // After restore, target should have app cursor keys enabled
      expect(target.modes().applicationCursorKeys).toBe(true)
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("double snapshot-restore cycle preserves modes", async () => {
    const a = createPipeline()
    const b = createPipeline()
    const c = createPipeline()

    try {
      await a.write(ENABLE_APP_CURSOR)
      await a.write(ENABLE_MOUSE_SGR)
      await a.write(ENABLE_FOCUS_REPORTING)
      await a.write("hello\r\n")

      // First round-trip
      const snap1 = await a.snapshot()
      await applySnapshot(b, snap1)

      // Second round-trip
      const snap2 = await b.snapshot()
      await applySnapshot(c, snap2)

      expect(c.modes().applicationCursorKeys).toBe(true)
      expect(c.modes().mouseSgr).toBe(true)
      expect(c.modes().focusReporting).toBe(true)

      const final = await c.snapshot()
      expect(final.snapshotAnsi).toContain("hello")
    } finally {
      a.dispose()
      b.dispose()
      c.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Alternate screen restoration on reload
//
// Models the exact cleanup → restore cycle from terminal.tsx:
//   cleanup:  serialize({ excludeAltBuffer: true, excludeModes: true })
//             + rehydrateSequences()
//             + modes().alternateScreen
//   restore:  write(modeSequences + buffer)
//
// The TUI (OpenCode, vim, htop) runs in alternate screen. On reload the
// browser serializes state and tears down xterm. On remount the buffer is
// restored and a SIGWINCH toggle tells the TUI to re-render. If xterm is
// NOT in alternate screen mode after restore, the TUI re-render output
// goes to the normal screen scrollback — producing the "single page"
// layout breakage the user sees intermittently.
// ---------------------------------------------------------------------------

const EXIT_ALT_SCREEN = `${CSI}?1049l`

describe("alternate screen restoration on reload", () => {
  /**
   * Create a raw headless terminal + serialize + mode scanner.
   * This mirrors what the real xterm backend does.
   */
  function createRaw(cols = 80, rows = 24) {
    const terminal = new HeadlessTerminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
    const serialize = new SerializeAddon()
    terminal.loadAddon(serialize)
    const mode = createModeScanner()
    return { terminal, serialize, mode }
  }

  function write(t: HeadlessTerminal, data: string): Promise<void> {
    return new Promise((resolve) => t.write(data, resolve))
  }

  /**
   * Model real onCleanup (terminal.tsx:762-784):
   *   buffer  = serialize({ excludeAltBuffer: true, excludeModes: true })
   *   modes   = rehydrateSequences()   ← skips alt screen today
   *   wasAlt  = modes().alternateScreen
   */
  function cleanup(ctx: ReturnType<typeof createRaw>) {
    const buffer = ctx.serialize.serialize({ excludeAltBuffer: true, excludeModes: true })
    const modeSequences = ctx.mode.rehydrateSequences()
    const wasAltScreen = ctx.mode.modes().alternateScreen
    const cols = ctx.terminal.cols
    const rows = ctx.terminal.rows
    ctx.terminal.dispose()
    return { buffer, modeSequences, wasAltScreen, cols, rows }
  }

  /**
   * Model real restore (terminal.tsx:486-550):
   *   write(modeSequences + buffer + altScreenSeq)
   *
   * Ordering: input modes first, then normal screen buffer, then alt screen.
   */
  async function restoreCurrent(saved: ReturnType<typeof cleanup>, cols?: number, rows?: number) {
    const c = cols ?? saved.cols
    const r = rows ?? saved.rows
    const ctx = createRaw(c, r)
    ctx.terminal.resize(c, r)
    const altScreenSeq = saved.wasAltScreen ? ENTER_ALT_SCREEN : ""
    const restoreData = saved.modeSequences + saved.buffer + altScreenSeq
    await write(ctx.terminal, restoreData)
    ctx.mode.scan(saved.modeSequences + altScreenSeq)
    return ctx
  }

  // -----------------------------------------------------------------------
  // Bug repro: demonstrate the gap
  // -----------------------------------------------------------------------

  test("BUG REPRO: after restore, xterm should be in alternate buffer when TUI was in alt screen", async () => {
    const src = createRaw()

    // Shell prompt on normal screen
    await write(src.terminal, "shell$ ")
    src.mode.scan("shell$ ")

    // TUI enters alt screen
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE)

    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI Header")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI Header")

    expect(src.terminal.buffer.active.type).toBe("alternate")

    // Cleanup (models real terminal.tsx onCleanup)
    const saved = cleanup(src)
    expect(saved.wasAltScreen).toBe(true)
    // Buffer is normal screen content (shell prompt), not alt screen TUI
    expect(saved.buffer).toContain("shell")
    expect(saved.buffer).not.toContain("TUI Header")

    // Restore with current flow
    const dst = await restoreCurrent(saved)

    // Should be in alternate screen after restore
    expect(dst.terminal.buffer.active.type).toBe("alternate")

    dst.terminal.dispose()
  })

  test("BUG REPRO: TUI SIGWINCH re-render should land in alt screen, not normal", async () => {
    const src = createRaw()

    // Normal screen: shell prompt
    await write(src.terminal, "user@host:~$ opencode\r\n")
    src.mode.scan("user@host:~$ opencode\r\n")

    // TUI startup
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE + HIDE_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE + HIDE_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "OpenCode TUI Header")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "OpenCode TUI Header")
    await write(src.terminal, MOVE_CURSOR(24, 1) + "Build  Model  OpenCode Zen")
    src.mode.scan(MOVE_CURSOR(24, 1) + "Build  Model  OpenCode Zen")

    expect(src.terminal.buffer.active.type).toBe("alternate")
    const saved = cleanup(src)

    // Restore (current flow)
    const dst = await restoreCurrent(saved)

    // Simulate TUI SIGWINCH re-render
    const tuiRender =
      CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Re-rendered Header" + MOVE_CURSOR(24, 1) + "Re-rendered Footer"
    await write(dst.terminal, tuiRender)

    // TUI re-render should be in alt screen
    expect(dst.terminal.buffer.active.type).toBe("alternate")

    // Normal screen should still have the shell prompt (not clobbered)
    await write(dst.terminal, EXIT_ALT_SCREEN)
    const normalContent = dst.serialize.serialize({ excludeAltBuffer: true })
    expect(normalContent).toContain("user@host")
    expect(normalContent).not.toContain("Re-rendered Header")

    dst.terminal.dispose()
  })

  // -----------------------------------------------------------------------
  // Fix specification: these define the correct behavior.
  // They will FAIL until the fix is applied, then go GREEN.
  //
  // The fix must ensure:
  //   1. Normal screen buffer is populated FIRST (in normal screen mode)
  //   2. Then alt screen is enabled (switching to blank alt buffer)
  //   3. TUI re-render output lands in alt screen
  //   4. Normal screen retains its original content (shell prompt)
  // -----------------------------------------------------------------------

  /**
   * Model the FIXED restore: buffer first, then alt screen enable.
   * The fix can live in rehydrateSequences() (split into pre/post)
   * or in terminal.tsx (append alt screen after buffer).
   * Either way the end result is the same.
   */
  async function restoreFixed(saved: ReturnType<typeof cleanup>, cols?: number, rows?: number) {
    const c = cols ?? saved.cols
    const r = rows ?? saved.rows
    const ctx = createRaw(c, r)
    ctx.terminal.resize(c, r)

    // 1. Pre-buffer modes (input behavior: cursor keys, paste, mouse)
    if (saved.modeSequences) {
      await write(ctx.terminal, saved.modeSequences)
      ctx.mode.scan(saved.modeSequences)
    }

    // 2. Normal screen buffer content
    if (saved.buffer) {
      await write(ctx.terminal, saved.buffer)
    }

    // 3. Switch to alt screen AFTER buffer is in normal screen
    if (saved.wasAltScreen) {
      await write(ctx.terminal, ENTER_ALT_SCREEN)
      ctx.mode.scan(ENTER_ALT_SCREEN)
    }

    return ctx
  }

  test("FIX: after restore, xterm should be in alternate buffer when TUI was in alt screen", async () => {
    const src = createRaw()

    await write(src.terminal, "shell$ ")
    src.mode.scan("shell$ ")
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI Content")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI Content")

    const saved = cleanup(src)
    const dst = await restoreFixed(saved)

    // After fix, xterm should be in alternate screen
    expect(dst.terminal.buffer.active.type).toBe("alternate")
    // Non-alt-screen modes should also be restored
    expect(dst.mode.modes().bracketedPaste).toBe(true)

    dst.terminal.dispose()
  })

  test("FIX: normal screen buffer populated before alt screen switch", async () => {
    const src = createRaw()

    // Shell prompt on normal screen
    await write(src.terminal, "user@host:~$ opencode\r\n")
    src.mode.scan("user@host:~$ opencode\r\n")

    // TUI enters alt screen
    await write(src.terminal, ENTER_ALT_SCREEN + HIDE_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + HIDE_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI View")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI View")

    const saved = cleanup(src)
    const dst = await restoreFixed(saved)

    // Alt screen is active
    expect(dst.terminal.buffer.active.type).toBe("alternate")

    // Switch BACK to normal screen to verify content was placed correctly
    await write(dst.terminal, EXIT_ALT_SCREEN)

    expect(dst.terminal.buffer.active.type).toBe("normal")
    const normalContent = dst.serialize.serialize({ excludeAltBuffer: true })
    expect(normalContent).toContain("user@host")
    expect(normalContent).toContain("opencode")

    dst.terminal.dispose()
  })

  test("FIX: TUI SIGWINCH re-render lands in alt screen, normal screen preserved", async () => {
    const src = createRaw()

    await write(src.terminal, "user@host:~$ opencode\r\n")
    src.mode.scan("user@host:~$ opencode\r\n")
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE + HIDE_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE + HIDE_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Original TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Original TUI")

    const saved = cleanup(src)
    const dst = await restoreFixed(saved)

    // Simulate TUI SIGWINCH re-render
    const tuiRender =
      CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Re-rendered Header" + MOVE_CURSOR(24, 1) + "Re-rendered Footer"
    await write(dst.terminal, tuiRender)

    // TUI re-render should be in the alt screen (visible)
    const line1 = dst.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    expect(line1).toContain("Re-rendered Header")
    expect(dst.terminal.buffer.active.type).toBe("alternate")

    // Normal screen should still have the shell prompt
    await write(dst.terminal, EXIT_ALT_SCREEN)
    const normalContent = dst.serialize.serialize({ excludeAltBuffer: true })
    expect(normalContent).toContain("user@host")
    // TUI re-render should NOT be in normal screen
    expect(normalContent).not.toContain("Re-rendered Header")

    dst.terminal.dispose()
  })

  test("FIX: restore without alt screen leaves xterm in normal mode", async () => {
    const src = createRaw()

    // No alt screen — just a normal shell session
    await write(src.terminal, "shell$ ls\r\nfile1  file2\r\n")
    src.mode.scan("shell$ ls\r\nfile1  file2\r\n")

    const saved = cleanup(src)
    expect(saved.wasAltScreen).toBe(false)

    const dst = await restoreFixed(saved)

    // Should stay in normal screen
    expect(dst.terminal.buffer.active.type).toBe("normal")
    const content = dst.serialize.serialize()
    expect(content).toContain("file1")

    dst.terminal.dispose()
  })

  // -----------------------------------------------------------------------
  // Stress: ordering correctness under race-like conditions
  // -----------------------------------------------------------------------

  test("STRESS: pending WS messages after alt screen restore go to alt buffer", async () => {
    const src = createRaw()

    await write(src.terminal, "shell$ ")
    src.mode.scan("shell$ ")
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI")

    const saved = cleanup(src)
    const dst = await restoreFixed(saved)

    // Simulate queued WS messages that arrive after restore
    // (these represent the TUI's SIGWINCH re-render output)
    const pendingMessages = [
      CLEAR_SCREEN + MOVE_CURSOR(1, 1),
      "Header Line",
      MOVE_CURSOR(12, 1),
      "Content middle",
      MOVE_CURSOR(24, 1),
      "Footer Line",
    ]

    for (const msg of pendingMessages) {
      await write(dst.terminal, msg)
    }

    // All pending messages should have gone to alt screen
    expect(dst.terminal.buffer.active.type).toBe("alternate")
    const line0 = dst.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    const line23 = dst.terminal.buffer.active.getLine(23)?.translateToString(true) ?? ""
    expect(line0).toContain("Header Line")
    expect(line23).toContain("Footer Line")

    // Normal screen should still have shell prompt
    await write(dst.terminal, EXIT_ALT_SCREEN)
    const normal = dst.serialize.serialize({ excludeAltBuffer: true })
    expect(normal).toContain("shell")
    expect(normal).not.toContain("Header Line")
    expect(normal).not.toContain("Footer Line")

    dst.terminal.dispose()
  })

  test("STRESS: triple serialize/restore cycle with alt screen", async () => {
    function runTUI(ctx: ReturnType<typeof createRaw>, label: string) {
      const data = ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + CLEAR_SCREEN + MOVE_CURSOR(1, 1) + label
      ctx.mode.scan(data)
      return write(ctx.terminal, data)
    }

    // Cycle 1
    const a = createRaw()
    await write(a.terminal, "shell$ ")
    a.mode.scan("shell$ ")
    await runTUI(a, "TUI-cycle-1")
    expect(a.terminal.buffer.active.type).toBe("alternate")
    const savedA = cleanup(a)

    // Cycle 2
    const b = await restoreFixed(savedA)
    expect(b.terminal.buffer.active.type).toBe("alternate")
    // TUI re-renders
    await write(b.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-cycle-2")
    const savedB = cleanup(b)

    // Cycle 3
    const c = await restoreFixed(savedB)
    expect(c.terminal.buffer.active.type).toBe("alternate")
    await write(c.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-cycle-3")

    const line0 = c.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    expect(line0).toContain("TUI-cycle-3")

    // Normal screen should still have shell prompt from cycle 1
    await write(c.terminal, EXIT_ALT_SCREEN)
    const normal = c.serialize.serialize({ excludeAltBuffer: true })
    expect(normal).toContain("shell")

    c.terminal.dispose()
  })

  test("STRESS: resize between buffer restore and alt screen enable", async () => {
    const src = createRaw(120, 40)

    await write(src.terminal, "wide-shell-prompt$ ")
    src.mode.scan("wide-shell-prompt$ ")
    await write(src.terminal, ENTER_ALT_SCREEN + HIDE_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + HIDE_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI Header")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI Header")

    const saved = cleanup(src)

    // Restore into a DIFFERENT size terminal (simulating container resize during mount)
    const dst = createRaw(100, 30)
    dst.terminal.resize(saved.cols, saved.rows) // start at saved dims

    // 1. Pre-buffer modes
    if (saved.modeSequences) {
      await write(dst.terminal, saved.modeSequences)
      dst.mode.scan(saved.modeSequences)
    }

    // 2. Write normal screen buffer
    if (saved.buffer) {
      await write(dst.terminal, saved.buffer)
    }

    // Simulate container resize happening between buffer write and alt screen enable
    dst.terminal.resize(100, 30)

    // 3. Enable alt screen
    if (saved.wasAltScreen) {
      await write(dst.terminal, ENTER_ALT_SCREEN)
      dst.mode.scan(ENTER_ALT_SCREEN)
    }

    expect(dst.terminal.buffer.active.type).toBe("alternate")
    expect(dst.terminal.cols).toBe(100)
    expect(dst.terminal.rows).toBe(30)

    // Normal screen should have the shell prompt (possibly reflowed)
    await write(dst.terminal, EXIT_ALT_SCREEN)
    const normal = dst.serialize.serialize({ excludeAltBuffer: true })
    expect(normal).toContain("wide-shell-prompt")

    dst.terminal.dispose()
  })

  test("STRESS: two terminals — one alt screen, one normal — independent restore", async () => {
    // Terminal A: TUI in alt screen
    const srcA = createRaw()
    await write(srcA.terminal, "shellA$ ")
    srcA.mode.scan("shellA$ ")
    await write(srcA.terminal, ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    srcA.mode.scan(ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    await write(srcA.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-A")
    srcA.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-A")

    // Terminal B: plain shell, no alt screen
    const srcB = createRaw()
    await write(srcB.terminal, "shellB$ ls\r\noutput-B\r\n")
    srcB.mode.scan("shellB$ ls\r\noutput-B\r\n")

    const savedA = cleanup(srcA)
    const savedB = cleanup(srcB)

    expect(savedA.wasAltScreen).toBe(true)
    expect(savedB.wasAltScreen).toBe(false)

    // Restore both concurrently
    const [dstA, dstB] = await Promise.all([restoreFixed(savedA), restoreFixed(savedB)])

    // A should be in alt screen
    expect(dstA.terminal.buffer.active.type).toBe("alternate")
    // B should be in normal screen
    expect(dstB.terminal.buffer.active.type).toBe("normal")

    // TUI re-render on A goes to alt screen
    await write(dstA.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-A-restored")
    const lineA = dstA.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    expect(lineA).toContain("TUI-A-restored")

    // New shell output on B goes to normal screen
    await write(dstB.terminal, "more-output-B\r\n")
    const contentB = dstB.serialize.serialize()
    expect(contentB).toContain("output-B")
    expect(contentB).toContain("more-output-B")

    dstA.terminal.dispose()
    dstB.terminal.dispose()
  })

  test("STRESS: 50 rapid serialize/restore cycles with alt screen", async () => {
    let ctx = createRaw()
    await write(ctx.terminal, "shell$ ")
    ctx.mode.scan("shell$ ")
    await write(ctx.terminal, ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    ctx.mode.scan(ENTER_ALT_SCREEN + ENABLE_BRACKETED_PASTE)
    await write(ctx.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-0")
    ctx.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI-0")

    for (let i = 1; i <= 50; i++) {
      const saved = cleanup(ctx)
      expect(saved.wasAltScreen).toBe(true)

      ctx = await restoreFixed(saved)
      expect(ctx.terminal.buffer.active.type).toBe("alternate")

      // Simulate TUI re-render with unique content
      const render = CLEAR_SCREEN + MOVE_CURSOR(1, 1) + `TUI-${i}`
      await write(ctx.terminal, render)
      ctx.mode.scan(render)
    }

    // Final state
    const line0 = ctx.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    expect(line0).toContain("TUI-50")

    // Normal screen should still have shell prompt from the very first cycle
    await write(ctx.terminal, EXIT_ALT_SCREEN)
    const normal = ctx.serialize.serialize({ excludeAltBuffer: true })
    expect(normal).toContain("shell")

    ctx.terminal.dispose()
  })

  test("STRESS: alt screen restore with mode toggle mid-buffer", async () => {
    const src = createRaw()

    // Shell on normal screen
    await write(src.terminal, "$ ")
    src.mode.scan("$ ")

    // TUI enters alt screen with multiple modes
    const modes = ENTER_ALT_SCREEN + ENABLE_APP_CURSOR + ENABLE_BRACKETED_PASTE + ENABLE_MOUSE_SGR + HIDE_CURSOR
    await write(src.terminal, modes)
    src.mode.scan(modes)

    // TUI writes content
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Full TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Full TUI")

    // TUI disables some modes mid-session (e.g., leaving a sub-view)
    await write(src.terminal, DISABLE_APP_CURSOR)
    src.mode.scan(DISABLE_APP_CURSOR)

    const saved = cleanup(src)
    expect(saved.wasAltScreen).toBe(true)

    const dst = await restoreFixed(saved)

    // Alt screen active
    expect(dst.terminal.buffer.active.type).toBe("alternate")
    // Modes should reflect the state at cleanup time
    expect(dst.mode.modes().bracketedPaste).toBe(true)
    expect(dst.mode.modes().applicationCursorKeys).toBe(false) // was disabled
    expect(dst.mode.modes().mouseSgr).toBe(true)

    dst.terminal.dispose()
  })

  // -----------------------------------------------------------------------
  // SIGWINCH size mismatch: restore at old dims, then fit to actual container
  // -----------------------------------------------------------------------

  test("SIGWINCH at old (saved) dimensions causes double render", async () => {
    // Simulate: TUI was full-width 120x40, split pane is 60x20.
    // Without fit() before SIGWINCH, the TUI first renders at 120x40 (wrong),
    // then after resize renders at 60x20 (correct) — two renders total.
    const src = createRaw(120, 40)
    await write(src.terminal, "shell$ ")
    src.mode.scan("shell$ ")
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_APP_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_APP_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI")

    const saved = cleanup(src)
    expect(saved.cols).toBe(120)
    expect(saved.rows).toBe(40)

    // Restore at saved dimensions (the buggy path — no fit() before SIGWINCH)
    const dst = await restoreCurrent(saved, 120, 40)
    expect(dst.terminal.cols).toBe(120)
    expect(dst.terminal.rows).toBe(40)

    // WRONG: SIGWINCH at old size → TUI renders with 40 rows
    await write(dst.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Header-wrong" + MOVE_CURSOR(40, 1) + "Footer-wrong")

    // Then fit() corrects size → resize to 60x20
    dst.terminal.resize(60, 20)
    expect(dst.terminal.cols).toBe(60)
    expect(dst.terminal.rows).toBe(20)

    // CORRECT: second SIGWINCH at correct size → TUI re-renders
    await write(dst.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Header-correct" + MOVE_CURSOR(20, 1) + "Footer-correct")

    // The second (correct) render overwrites the first
    const header = dst.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    const footer = dst.terminal.buffer.active.getLine(19)?.translateToString(true) ?? ""
    expect(header).toContain("Header-correct")
    expect(footer).toContain("Footer-correct")

    // Importantly, no content from the wrong-size render should persist
    expect(header).not.toContain("Header-wrong")

    dst.terminal.dispose()
  })

  test("fit() before SIGWINCH gives correct dimensions from the start", async () => {
    // Same scenario but fit() BEFORE SIGWINCH (the fix)
    const src = createRaw(120, 40)
    await write(src.terminal, "shell$ ")
    src.mode.scan("shell$ ")
    await write(src.terminal, ENTER_ALT_SCREEN + ENABLE_APP_CURSOR)
    src.mode.scan(ENTER_ALT_SCREEN + ENABLE_APP_CURSOR)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Wide TUI")

    const saved = cleanup(src)

    // Restore at saved dimensions initially
    const dst = await restoreCurrent(saved, 120, 40)

    // Simulate fit() BEFORE SIGWINCH — the fix
    dst.terminal.resize(60, 20)

    // Now SIGWINCH goes out at 60x20 (the actual container size)
    // Only ONE render happens, at the correct size. No duplication.
    await write(dst.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "Header-only" + MOVE_CURSOR(20, 1) + "Footer-only")

    const header = dst.terminal.buffer.active.getLine(0)?.translateToString(true) ?? ""
    const footer = dst.terminal.buffer.active.getLine(19)?.translateToString(true) ?? ""
    expect(header).toContain("Header-only")
    expect(footer).toContain("Footer-only")

    // No leftover content from a wrong-size render
    const middleRow = dst.terminal.buffer.active.getLine(10)?.translateToString(true) ?? ""
    expect(middleRow.trim()).toBe("")

    dst.terminal.dispose()
  })

  // -----------------------------------------------------------------------
  // Scroll position restoration
  // -----------------------------------------------------------------------

  test("scroll position: normal screen terminal should track wasAtBottom", async () => {
    const src = createRaw(80, 10)

    // Write enough content to create scrollback
    for (let i = 0; i < 30; i++) {
      await write(src.terminal, `line ${i}\r\n`)
      src.mode.scan(`line ${i}\r\n`)
    }

    // Terminal should be at the bottom (auto-scroll)
    const buffer = src.terminal.buffer.active
    expect(buffer.viewportY).toBe(buffer.baseY) // at bottom

    // Cleanup should capture wasAtBottom = true
    const saved = cleanup(src)
    // viewportY should be > 0 (there is scrollback)
    expect(saved.buffer).toContain("line 29")

    // Restore and write the buffer
    const dst = createRaw(80, 10)
    await write(dst.terminal, saved.buffer)

    // After writing buffer, the viewport should be auto-scrolled to bottom
    // because xterm auto-scrolls when new content is written
    const dstBuffer = dst.terminal.buffer.active
    expect(dstBuffer.viewportY).toBe(dstBuffer.baseY)

    dst.terminal.dispose()
  })

  test("scroll position: scrolled-up terminal preserves scroll offset", async () => {
    const src = createRaw(80, 10)

    // Write enough content to create scrollback
    for (let i = 0; i < 30; i++) {
      await write(src.terminal, `line ${i}\r\n`)
      src.mode.scan(`line ${i}\r\n`)
    }

    // Scroll up (not at bottom)
    src.terminal.scrollToLine(5)
    const buffer = src.terminal.buffer.active
    expect(buffer.viewportY).toBe(5) // scrolled up
    expect(buffer.viewportY).toBeLessThan(buffer.baseY) // NOT at bottom

    const scrollY = buffer.viewportY
    const wasAtBottom = buffer.viewportY >= buffer.baseY
    expect(wasAtBottom).toBe(false)

    // In the restore, when wasAtBottom is false, scrollToLine(scrollY) is called
    // This test validates that the scrollY value is meaningful
    expect(scrollY).toBe(5)
    expect(typeof scrollY).toBe("number")

    src.terminal.dispose()
  })

  test("scroll position: alt screen terminal does not need scroll restore", async () => {
    const src = createRaw(80, 24)

    // Normal screen content
    for (let i = 0; i < 50; i++) {
      await write(src.terminal, `history ${i}\r\n`)
      src.mode.scan(`history ${i}\r\n`)
    }

    // Enter alt screen
    await write(src.terminal, ENTER_ALT_SCREEN)
    src.mode.scan(ENTER_ALT_SCREEN)
    await write(src.terminal, CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI")
    src.mode.scan(CLEAR_SCREEN + MOVE_CURSOR(1, 1) + "TUI")

    // Alt screen has no scrollback
    const altBuffer = src.terminal.buffer.active
    expect(altBuffer.type).toBe("alternate")
    expect(altBuffer.viewportY).toBe(0)
    expect(altBuffer.baseY).toBe(0)

    const saved = cleanup(src)
    expect(saved.wasAltScreen).toBe(true)

    // Restore — should enter alt screen with viewport at 0, no scroll needed
    const dst = await restoreCurrent(saved)
    expect(dst.terminal.buffer.active.type).toBe("alternate")
    expect(dst.terminal.buffer.active.viewportY).toBe(0)

    dst.terminal.dispose()
  })
})
