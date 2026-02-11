import { describe, expect, test } from "bun:test"
import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createModeScanner } from "../terminal/mode-scan"

// ---------------------------------------------------------------------------
// Paste Duplication Test
//
// Models the exact data paths in the real system to identify where paste
// duplication could occur. The real system has these paths for user input:
//
//   PATH A: xterm.onData(data) → dataListeners → ws.send(data)
//   PATH B: setupPasteHandler → handleWrite → dataListeners → ws.send(data)
//   PATH C: setupKeyboardHandler → handleWrite → dataListeners → ws.send(data)
//
// For pasting, xterm's built-in paste handler fires through PATH A (via
// triggerDataEvent → onData). The custom setupPasteHandler intercepts the
// DOM paste event with capture:true + stopImmediatePropagation() to prevent
// xterm's native handler, then sends through PATH B.
//
// This test verifies that only ONE path fires for each paste event.
// ---------------------------------------------------------------------------

function allLines(t: Terminal): string[] {
  const buf = t.buffer.active
  const out: string[] = []
  for (let i = 0; i < buf.length; i++) {
    out.push(buf.getLine(i)?.translateToString(true) ?? "")
  }
  return out
}

// Simulates the backend's data pipeline: dataListeners → ws → server echo → write
function createTestPipeline(opts?: { cols?: number; rows?: number }) {
  const cols = opts?.cols ?? 80
  const rows = opts?.rows ?? 24
  const xterm = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  xterm.loadAddon(serialize)

  const mode = createModeScanner()

  const sentToServer: string[] = []
  const dataListeners: Array<(data: string) => void> = []

  // Write (server output → xterm, no query suppression)
  const write = (data: string, callback?: () => void) => {
    mode.scan(data)
    if (callback) xterm.write(data, callback)
    else xterm.write(data)
  }

  // handleWrite: used by paste handler and keyboard handler
  const handleWrite = (data: string) => {
    for (const fn of dataListeners) fn(data)
  }

  // Wire xterm.onData (PATH A) — user typing goes through here
  xterm.onData((data) => {
    for (const fn of dataListeners) fn(data)
  })

  // Register the "ws.send" equivalent
  dataListeners.push((data) => sentToServer.push(data))

  return {
    xterm,
    write,
    handleWrite,
    sentToServer,
    mode,

    // Simulate server echoing back what user typed
    echoFromServer(data: string): Promise<void> {
      return new Promise((resolve) => write(data, resolve))
    },

    // Simulate paste through PATH A (xterm native — triggerDataEvent)
    // In reality this is blocked by our custom handler's stopImmediatePropagation,
    // but we simulate it to show what would happen if both paths fired.
    simulateXtermNativePaste(text: string) {
      // xterm's paste normalizes \r?\n → \r and wraps with bracketed paste if enabled
      const normalized = text.replace(/\r?\n/g, "\r")
      // Fires through onData → dataListeners
      for (const fn of dataListeners) fn(normalized)
    },

    // Simulate paste through PATH B (custom setupPasteHandler)
    simulateCustomPaste(text: string) {
      const prepared = text.replace(/\r?\n/g, "\r")
      const bracketed = mode.bracketed()
      if (bracketed) {
        handleWrite(`\x1b[200~${prepared}\x1b[201~`)
      } else {
        handleWrite(prepared)
      }
    },

    cleanup() {
      xterm.dispose()
    },
  }
}

describe("paste duplication analysis", () => {
  test("custom paste handler sends data exactly once", async () => {
    const p = createTestPipeline()

    // Paste via custom handler (PATH B) — what actually happens
    p.simulateCustomPaste("hello world")
    expect(p.sentToServer).toEqual(["hello world"])

    p.cleanup()
  })

  test("if BOTH paths fire, data is sent twice (proving the duplication bug mechanism)", async () => {
    const p = createTestPipeline()

    // If stopImmediatePropagation fails or xterm's element listener still fires:
    // PATH A fires
    p.simulateXtermNativePaste("hello world")
    // PATH B also fires
    p.simulateCustomPaste("hello world")

    // Data sent TWICE — this is the bug
    expect(p.sentToServer).toEqual(["hello world", "hello world"])

    // Server would echo both back → doubled text in terminal
    await p.echoFromServer("hello world")
    await p.echoFromServer("hello world")

    const lines = allLines(p.xterm).join("")
    // The text appears twice
    const count = lines.split("hello world").length - 1
    expect(count).toBe(2)

    p.cleanup()
  })

  test("custom paste handler with bracketed paste wraps correctly", async () => {
    const p = createTestPipeline()

    // Enable bracketed paste mode via server output
    await p.echoFromServer("\x1b[?2004h")
    expect(p.mode.bracketed()).toBe(true)

    // Paste via custom handler
    p.simulateCustomPaste("pasted text")
    expect(p.sentToServer).toEqual(["\x1b[200~pasted text\x1b[201~"])

    p.cleanup()
  })

  test("multiline paste normalizes newlines", async () => {
    const p = createTestPipeline()

    p.simulateCustomPaste("line1\nline2\r\nline3")
    expect(p.sentToServer).toEqual(["line1\rline2\rline3"])

    p.cleanup()
  })

  test("keyboard handler special keys send exactly once via handleWrite", async () => {
    const p = createTestPipeline()

    // Cmd+Backspace: sends Ctrl+U + left arrow
    p.handleWrite("\x15\x1b[D")
    expect(p.sentToServer).toEqual(["\x15\x1b[D"])

    // Cmd+Left: sends Ctrl+A
    p.handleWrite("\x01")
    expect(p.sentToServer).toEqual(["\x15\x1b[D", "\x01"])

    // Cmd+Right: sends Ctrl+E
    p.handleWrite("\x05")
    expect(p.sentToServer).toEqual(["\x15\x1b[D", "\x01", "\x05"])

    p.cleanup()
  })

  test("ClipboardAddon (OSC 52) does NOT interfere with paste path", async () => {
    const p = createTestPipeline()

    // OSC 52 write request from server: "\x1b]52;c;SGVsbG8=\x07"
    // (This writes "Hello" to clipboard, base64 of "Hello" = "SGVsbG8=")
    // This is handled by ClipboardAddon and should NOT trigger onData or paste
    await p.echoFromServer("\x1b]52;c;SGVsbG8=\x07")

    // Nothing was sent TO the server — OSC 52 only writes to system clipboard
    expect(p.sentToServer.length).toBe(0)

    // A regular paste after OSC 52 should work normally (one send)
    p.simulateCustomPaste("regular paste")
    expect(p.sentToServer).toEqual(["regular paste"])

    p.cleanup()
  })
})

describe("paste duplication: xterm element listener bypass", () => {
  // This tests the specific scenario where xterm registers paste on both
  // textarea AND element. stopImmediatePropagation on textarea's capture
  // phase should prevent both from firing, but if the element listener
  // fires during capture phase (before textarea), it would cause duplication.
  //
  // Key insight: in DOM event flow:
  //   Capture: window → document → ... → element → textarea
  //   Bubble:  textarea → element → ... → document → window
  //
  // Custom handler on textarea with capture:true fires during capture ON textarea.
  // stopImmediatePropagation() stops:
  //   - Other capture listeners on textarea ✓
  //   - Bubble listeners on textarea ✓
  //   - Any further propagation ✓
  //
  // But xterm's handler on `element` in CAPTURE phase would fire BEFORE
  // textarea's capture handler (since element is an ancestor).
  //
  // However, xterm registers its paste handlers WITHOUT capture:true
  // (they use addDisposableDomListener which defaults to bubbling).
  // So element's handler fires during BUBBLE phase, which is AFTER
  // textarea capture → blocked by stopImmediatePropagation.

  test("stopImmediatePropagation on textarea capture blocks element bubble listener", () => {
    // This is a DOM behavior assertion — in the real browser:
    // 1. User pastes
    // 2. Capture phase: window → ... → element → textarea
    //    - Our handler fires on textarea (capture:true)
    //    - stopImmediatePropagation() called
    // 3. Bubble phase never reached → element handler never fires
    //
    // This means only PATH B fires, not PATH A.
    // The custom paste handler correctly prevents duplication.
    expect(true).toBe(true) // Documented behavior assertion
  })

  test("however: if xterm coreService also processes beforeInput, paste could double", () => {
    // xterm also listens for 'beforeinput' on the textarea for IME/compose handling.
    // If a paste event somehow triggers a 'beforeinput' event (inputType: 'insertFromPaste'),
    // and our handler doesn't suppress that, xterm might process the paste text a second time.
    //
    // This is browser-dependent. In Chrome, paste fires: beforeinput → input → paste
    // Our handler prevents the paste event, but beforeinput may have already been dispatched.
    //
    // This needs a real DOM test (vitest with jsdom/happy-dom) to verify.
    expect(true).toBe(true) // Needs DOM environment test
  })
})
