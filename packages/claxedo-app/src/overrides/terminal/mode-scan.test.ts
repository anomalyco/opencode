import { describe, expect, test } from "bun:test"
import { createModeScanner, DEFAULT_MODES, type TerminalModes } from "./mode-scan"

const ESC = "\x1b"
const CSI = `${ESC}[`
const OSC = `${ESC}]`
const BEL = "\x07"

// Mode enable/disable sequences
const ENABLE_APP_CURSOR = `${CSI}?1h`
const DISABLE_APP_CURSOR = `${CSI}?1l`
const ENABLE_BRACKETED_PASTE = `${CSI}?2004h`
const DISABLE_BRACKETED_PASTE = `${CSI}?2004l`
const ENABLE_MOUSE_SGR = `${CSI}?1006h`
const DISABLE_MOUSE_SGR = `${CSI}?1006l`
const ENABLE_MOUSE_NORMAL = `${CSI}?1000h`
const DISABLE_MOUSE_NORMAL = `${CSI}?1000l`
const ENABLE_ALT_SCROLL = `${CSI}?1007h`
const DISABLE_ALT_SCROLL = `${CSI}?1007l`
const ENABLE_FOCUS_REPORTING = `${CSI}?1004h`
const HIDE_CURSOR = `${CSI}?25l`
const SHOW_CURSOR = `${CSI}?25h`
const ENTER_ALT_SCREEN = `${CSI}?1049h`
const EXIT_ALT_SCREEN = `${CSI}?1049l`
const ENTER_ALT_SCREEN_1047 = `${CSI}?1047h`
const EXIT_ALT_SCREEN_1047 = `${CSI}?1047l`

const OSC7_CWD = (path: string) => `${OSC}7;file://localhost${path}${BEL}`

// ---------------------------------------------------------------------------
// Backward-compat: existing bracketed paste tests (updated for void scan)
// ---------------------------------------------------------------------------

describe("mode scan — bracketed paste (backward compat)", () => {
  test("enable via split chunks", () => {
    const scan = createModeScanner()
    scan.scan("start\x1b[?20")
    scan.scan("04h-end")
    expect(scan.bracketed()).toBe(true)
  })

  test("disable via split chunks", () => {
    const scan = createModeScanner()
    scan.scan("\x1b[?2004h")
    scan.scan("x\x1b[?20")
    scan.scan("04l")
    expect(scan.bracketed()).toBe(false)
  })

  test("mixed data and escape tail", () => {
    const scan = createModeScanner()
    scan.scan("abc\x1b[?2004hdef")
    scan.scan("ghi\x1b[?2")
    expect(scan.bracketed()).toBe(true)
    expect(scan.tail()).toBe("\x1b[?2")
  })

  test("malformed sequence does not stick state", () => {
    const scan = createModeScanner()
    scan.scan("\x1b[?2004h")
    scan.scan("oops\x1b[?2004x")
    expect(scan.bracketed()).toBe(true)
    expect(scan.tail()).toBe("")
    scan.scan("\x1b[?2004l")
    expect(scan.bracketed()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Full mode tracking
// ---------------------------------------------------------------------------

describe("mode tracking", () => {
  test("initializes with default modes", () => {
    const scan = createModeScanner()
    expect(scan.modesEqual(DEFAULT_MODES)).toBe(true)
  })

  test("tracks application cursor keys mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().applicationCursorKeys).toBe(false)

    scan.scan(ENABLE_APP_CURSOR)
    expect(scan.modes().applicationCursorKeys).toBe(true)

    scan.scan(DISABLE_APP_CURSOR)
    expect(scan.modes().applicationCursorKeys).toBe(false)
  })

  test("tracks bracketed paste mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().bracketedPaste).toBe(false)

    scan.scan(ENABLE_BRACKETED_PASTE)
    expect(scan.modes().bracketedPaste).toBe(true)

    scan.scan(DISABLE_BRACKETED_PASTE)
    expect(scan.modes().bracketedPaste).toBe(false)
  })

  test("tracks mouse SGR mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().mouseSgr).toBe(false)

    scan.scan(ENABLE_MOUSE_SGR)
    expect(scan.modes().mouseSgr).toBe(true)

    scan.scan(DISABLE_MOUSE_SGR)
    expect(scan.modes().mouseSgr).toBe(false)
  })

  test("tracks mouse normal tracking mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().mouseTrackingNormal).toBe(false)

    scan.scan(ENABLE_MOUSE_NORMAL)
    expect(scan.modes().mouseTrackingNormal).toBe(true)

    scan.scan(DISABLE_MOUSE_NORMAL)
    expect(scan.modes().mouseTrackingNormal).toBe(false)
  })

  test("tracks focus reporting mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().focusReporting).toBe(false)

    scan.scan(ENABLE_FOCUS_REPORTING)
    expect(scan.modes().focusReporting).toBe(true)
  })

  test("tracks cursor visibility (default true)", () => {
    const scan = createModeScanner()
    expect(scan.modes().cursorVisible).toBe(true)

    scan.scan(HIDE_CURSOR)
    expect(scan.modes().cursorVisible).toBe(false)

    scan.scan(SHOW_CURSOR)
    expect(scan.modes().cursorVisible).toBe(true)
  })

  test("tracks alternate screen mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().alternateScreen).toBe(false)

    scan.scan(ENTER_ALT_SCREEN)
    expect(scan.modes().alternateScreen).toBe(true)

    scan.scan(EXIT_ALT_SCREEN)
    expect(scan.modes().alternateScreen).toBe(false)
  })

  test("tracks alternate screen mode 1047", () => {
    const scan = createModeScanner()
    expect(scan.modes().alternateScreen).toBe(false)

    scan.scan(ENTER_ALT_SCREEN_1047)
    expect(scan.modes().alternateScreen).toBe(true)

    scan.scan(EXIT_ALT_SCREEN_1047)
    expect(scan.modes().alternateScreen).toBe(false)
  })

  test("tracks alternate scroll mode", () => {
    const scan = createModeScanner()
    expect(scan.modes().alternateScroll).toBe(false)

    scan.scan(ENABLE_ALT_SCROLL)
    expect(scan.modes().alternateScroll).toBe(true)

    scan.scan(DISABLE_ALT_SCROLL)
    expect(scan.modes().alternateScroll).toBe(false)
  })

  test("handles multiple modes in single sequence", () => {
    const scan = createModeScanner()
    scan.scan(`${CSI}?1;2004h`)

    const modes = scan.modes()
    expect(modes.applicationCursorKeys).toBe(true)
    expect(modes.bracketedPaste).toBe(true)
  })

  test("handles legacy alternate screen mode 47", () => {
    const scan = createModeScanner()
    scan.scan(`${CSI}?47h`)
    expect(scan.modes().alternateScreen).toBe(true)
    scan.scan(`${CSI}?47l`)
    expect(scan.modes().alternateScreen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Chunk-safe buffering for all modes
// ---------------------------------------------------------------------------

describe("chunk-safe mode detection", () => {
  test("app cursor keys split across chunks", () => {
    const scan = createModeScanner()
    scan.scan(`text\x1b[?`)
    scan.scan("1h")
    expect(scan.modes().applicationCursorKeys).toBe(true)
  })

  test("mouse SGR split across chunks", () => {
    const scan = createModeScanner()
    scan.scan(`\x1b[?100`)
    scan.scan("6h")
    expect(scan.modes().mouseSgr).toBe(true)
  })

  test("multi-mode sequence split across chunks", () => {
    const scan = createModeScanner()
    scan.scan(`\x1b[?1;20`)
    scan.scan("04h")
    expect(scan.modes().applicationCursorKeys).toBe(true)
    expect(scan.modes().bracketedPaste).toBe(true)
  })

  test("bare ESC at end is carried", () => {
    const scan = createModeScanner()
    scan.scan("text\x1b")
    expect(scan.tail()).toBe("\x1b")
  })

  test("ESC[ at end is carried", () => {
    const scan = createModeScanner()
    scan.scan("text\x1b[")
    expect(scan.tail()).toBe("\x1b[")
  })

  test("ESC] at end is carried (could become OSC-7)", () => {
    const scan = createModeScanner()
    scan.scan("text\x1b]")
    expect(scan.tail()).toBe("\x1b]")
  })

  test("non-tracked CSI sequence is not carried", () => {
    const scan = createModeScanner()
    scan.scan("text\x1b[31m")
    expect(scan.tail()).toBe("")
  })
})

// ---------------------------------------------------------------------------
// CWD tracking via OSC-7
// ---------------------------------------------------------------------------

describe("CWD tracking via OSC-7", () => {
  test("parses OSC-7 with BEL terminator", () => {
    const scan = createModeScanner()
    expect(scan.cwd()).toBeNull()

    scan.scan(OSC7_CWD("/Users/test/project"))
    expect(scan.cwd()).toBe("/Users/test/project")
  })

  test("updates CWD on directory change", () => {
    const scan = createModeScanner()

    scan.scan(OSC7_CWD("/Users/test"))
    expect(scan.cwd()).toBe("/Users/test")

    scan.scan(OSC7_CWD("/Users/test/subdir"))
    expect(scan.cwd()).toBe("/Users/test/subdir")
  })

  test("handles paths with spaces", () => {
    const scan = createModeScanner()
    scan.scan(OSC7_CWD("/Users/test/my project"))
    expect(scan.cwd()).toBe("/Users/test/my project")
  })

  test("handles OSC-7 split across chunks", () => {
    const scan = createModeScanner()
    scan.scan(`${OSC}7;file://localhost/Users/te`)
    expect(scan.cwd()).toBeNull() // not yet complete
    scan.scan(`st/project${BEL}`)
    expect(scan.cwd()).toBe("/Users/test/project")
  })
})

// ---------------------------------------------------------------------------
// Rehydrate sequences
// ---------------------------------------------------------------------------

describe("rehydrate sequences", () => {
  test("generates sequences for non-default modes", () => {
    const scan = createModeScanner()
    scan.scan(ENABLE_APP_CURSOR)
    scan.scan(ENABLE_BRACKETED_PASTE)

    const seq = scan.rehydrateSequences()
    expect(seq).toContain("?1h")     // app cursor
    expect(seq).toContain("?2004h")  // bracketed paste
  })

  test("generates empty string for default modes", () => {
    const scan = createModeScanner()
    scan.scan("some text\r\n")

    expect(scan.rehydrateSequences()).toBe("")
  })

  test("generates disable sequence for default-true modes when turned off", () => {
    const scan = createModeScanner()
    scan.scan(HIDE_CURSOR) // cursorVisible defaults to true, now false

    const seq = scan.rehydrateSequences()
    expect(seq).toContain("?25l") // disable cursor visibility
  })

  test("does not include alternate screen in rehydrate", () => {
    const scan = createModeScanner()
    scan.scan(ENTER_ALT_SCREEN)

    const seq = scan.rehydrateSequences()
    // alternateScreen should be skipped (serialized buffer handles it)
    expect(seq).not.toContain("?1049")
    expect(seq).not.toContain("?47")
  })

  test("restores full TUI mode set", () => {
    const scan = createModeScanner()
    scan.scan(ENABLE_APP_CURSOR)
    scan.scan(ENABLE_BRACKETED_PASTE)
    scan.scan(ENABLE_MOUSE_NORMAL)
    scan.scan(ENABLE_MOUSE_SGR)
    scan.scan(ENABLE_ALT_SCROLL)
    scan.scan(HIDE_CURSOR)
    scan.scan(ENTER_ALT_SCREEN)

    const seq = scan.rehydrateSequences()
    expect(seq).toContain("?1h")     // app cursor
    expect(seq).toContain("?2004h")  // bracketed paste
    expect(seq).toContain("?1007h")  // alt scroll
    expect(seq).toContain("?25l")    // cursor hidden
    // alt screen excluded from rehydrate
    expect(seq).not.toContain("?1049")
    // mouse reporting included for TUIs
    expect(seq).toContain("?1000")
    expect(seq).toContain("?1006")
  })
})

// ---------------------------------------------------------------------------
// modesEqual
// ---------------------------------------------------------------------------

describe("modesEqual", () => {
  test("returns true for matching defaults", () => {
    const scan = createModeScanner()
    expect(scan.modesEqual(DEFAULT_MODES)).toBe(true)
  })

  test("returns false when modes differ", () => {
    const scan = createModeScanner()
    scan.scan(ENABLE_APP_CURSOR)
    expect(scan.modesEqual(DEFAULT_MODES)).toBe(false)
  })

  test("returns true after enable then disable cycle", () => {
    const scan = createModeScanner()
    scan.scan(ENABLE_APP_CURSOR)
    scan.scan(DISABLE_APP_CURSOR)
    expect(scan.modesEqual(DEFAULT_MODES)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("rapid mode toggling ends at default", () => {
    const scan = createModeScanner()
    for (let i = 0; i < 10; i++) {
      scan.scan(ENABLE_APP_CURSOR)
      scan.scan(DISABLE_APP_CURSOR)
      scan.scan(ENABLE_BRACKETED_PASTE)
      scan.scan(DISABLE_BRACKETED_PASTE)
    }
    expect(scan.modes().applicationCursorKeys).toBe(false)
    expect(scan.modes().bracketedPaste).toBe(false)
    expect(scan.modesEqual(DEFAULT_MODES)).toBe(true)
  })

  test("interleaved content and mode changes", () => {
    const scan = createModeScanner()
    scan.scan("Before modes\r\n")
    scan.scan(ENABLE_APP_CURSOR)
    scan.scan("After app cursor\r\n")
    scan.scan(ENABLE_BRACKETED_PASTE)
    scan.scan("After bracketed paste\r\n")
    scan.scan(OSC7_CWD("/test/path"))
    scan.scan("After CWD\r\n")

    expect(scan.modes().applicationCursorKeys).toBe(true)
    expect(scan.modes().bracketedPaste).toBe(true)
    expect(scan.cwd()).toBe("/test/path")
  })

  test("modes() returns a copy, not a reference", () => {
    const scan = createModeScanner()
    const m1 = scan.modes()
    scan.scan(ENABLE_APP_CURSOR)
    const m2 = scan.modes()
    expect(m1.applicationCursorKeys).toBe(false) // original unaffected
    expect(m2.applicationCursorKeys).toBe(true)
  })
})
