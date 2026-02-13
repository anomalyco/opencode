// ---------------------------------------------------------------------------
// Terminal Mode Tracking
// ---------------------------------------------------------------------------

/**
 * Terminal modes tracked via DECSET/DECRST (CSI ? Pm h/l) escape sequences.
 * These affect input behavior and must be restored on tab focus-switch.
 */
export interface TerminalModes {
  /** DECCKM — Application cursor keys (mode 1) */
  applicationCursorKeys: boolean
  /** Bracketed paste mode (mode 2004) */
  bracketedPaste: boolean
  /** Alternate scroll mode (mode 1007) */
  alternateScroll: boolean
  /** X10 mouse tracking (mode 9) */
  mouseTrackingX10: boolean
  /** Normal mouse tracking — button events (mode 1000) */
  mouseTrackingNormal: boolean
  /** Highlight mouse tracking (mode 1001) */
  mouseTrackingHighlight: boolean
  /** Button-event mouse tracking (mode 1002) */
  mouseTrackingButtonEvent: boolean
  /** Any-event mouse tracking (mode 1003) */
  mouseTrackingAnyEvent: boolean
  /** Focus reporting (mode 1004) */
  focusReporting: boolean
  /** UTF-8 mouse mode (mode 1005) */
  mouseUtf8: boolean
  /** SGR mouse mode (mode 1006) */
  mouseSgr: boolean
  /** Alternate screen buffer (mode 1049, 1047, or 47) */
  alternateScreen: boolean
  /** Cursor visibility (mode 25) */
  cursorVisible: boolean
  /** Origin mode (mode 6) */
  originMode: boolean
  /** Auto-wrap mode (mode 7) */
  autoWrap: boolean
}

export const DEFAULT_MODES: TerminalModes = {
  applicationCursorKeys: false,
  bracketedPaste: false,
  alternateScroll: false,
  mouseTrackingX10: false,
  mouseTrackingNormal: false,
  mouseTrackingHighlight: false,
  mouseTrackingButtonEvent: false,
  mouseTrackingAnyEvent: false,
  focusReporting: false,
  mouseUtf8: false,
  mouseSgr: false,
  alternateScreen: false,
  cursorVisible: true,
  originMode: false,
  autoWrap: true,
}

const ESC = "\x1b"
const BEL = "\x07"

/** DECSET/DECRST mode numbers → TerminalModes key */
const MODE_MAP: Record<number, keyof TerminalModes> = {
  1: "applicationCursorKeys",
  6: "originMode",
  7: "autoWrap",
  9: "mouseTrackingX10",
  25: "cursorVisible",
  47: "alternateScreen",
  1000: "mouseTrackingNormal",
  1001: "mouseTrackingHighlight",
  1002: "mouseTrackingButtonEvent",
  1003: "mouseTrackingAnyEvent",
  1004: "focusReporting",
  1005: "mouseUtf8",
  1006: "mouseSgr",
  1007: "alternateScroll",
  1047: "alternateScreen",
  1049: "alternateScreen",
  2004: "bracketedPaste",
}

/** Modes whose default is `true` (everything else defaults to `false`). */
const DEFAULT_TRUE_MODES = new Set<keyof TerminalModes>(["cursorVisible", "autoWrap"])

/** Mode numbers to emit in rehydrateSequences (skip alternateScreen — serialized buffer handles it). */
const REHYDRATE_ENTRIES: Array<{ num: number; key: keyof TerminalModes; defaultVal: boolean }> = [
  { num: 1, key: "applicationCursorKeys", defaultVal: false },
  { num: 6, key: "originMode", defaultVal: false },
  { num: 7, key: "autoWrap", defaultVal: true },
  { num: 25, key: "cursorVisible", defaultVal: true },
  // Mouse tracking + focus reporting are rehydrated so fullscreen TUIs regain
  // wheel/pointer behavior after reload/split. The UI must avoid applying these
  // sequences for non-TUI shells to prevent accidental SGR mouse "gibberish".
  { num: 9, key: "mouseTrackingX10", defaultVal: false },
  { num: 1000, key: "mouseTrackingNormal", defaultVal: false },
  { num: 1001, key: "mouseTrackingHighlight", defaultVal: false },
  { num: 1002, key: "mouseTrackingButtonEvent", defaultVal: false },
  { num: 1003, key: "mouseTrackingAnyEvent", defaultVal: false },
  { num: 1004, key: "focusReporting", defaultVal: false },
  { num: 1005, key: "mouseUtf8", defaultVal: false },
  { num: 1006, key: "mouseSgr", defaultVal: false },
  { num: 1007, key: "alternateScroll", defaultVal: false },
  { num: 2004, key: "bracketedPaste", defaultVal: false },
]

// ---------------------------------------------------------------------------
// Chunk-safe tail detection
// ---------------------------------------------------------------------------

/**
 * Detect an incomplete DECSET/DECRST or OSC-7 sequence at the end of `data`.
 * Returns the partial sequence to carry over, or "" if none found.
 */
function detectTail(data: string, maxTail: number): string {
  const idx = data.lastIndexOf(ESC)
  if (idx === -1) return ""

  const fragment = data.slice(idx)
  if (fragment.length > maxTail) return ""

  // Incomplete DECSET/DECRST: \x1b[?<digits;...> not yet terminated with h/l
  if (/^\x1b\[\?[0-9;]*$/.test(fragment)) return fragment

  // Partial start that could become DECSET/DECRST or OSC-7
  if (fragment === ESC) return fragment
  if (fragment === `${ESC}[`) return fragment
  if (fragment === `${ESC}]`) return fragment
  if (fragment === `${ESC}]7`) return fragment

  // Incomplete OSC-7: \x1b]7;... not yet terminated with BEL or ST
  if (fragment.startsWith(`${ESC}]7;`)) {
    if (!fragment.includes(BEL) && !fragment.includes(`${ESC}\\`)) return fragment
  }

  return ""
}

// ---------------------------------------------------------------------------
// OSC-7 CWD parsing
// ---------------------------------------------------------------------------

const OSC7_RE = /\x1b\]7;file:\/\/[^/]*(\/.*?)(?:\x07|\x1b\\)/g

function parseOsc7(data: string): string | null {
  let last: string | null = null
  for (const match of data.matchAll(OSC7_RE)) {
    if (match[1]) {
      try {
        last = decodeURIComponent(match[1])
      } catch {
        last = match[1]
      }
    }
  }
  return last
}

// ---------------------------------------------------------------------------
// Mode scanner
// ---------------------------------------------------------------------------

const DECSET_RE = /\x1b\[\?([0-9;]+)([hl])/g

export function createModeScanner(input?: { maxTail?: number }) {
  const maxTail = input?.maxTail ?? 64
  const state: TerminalModes = { ...DEFAULT_MODES }
  let carry = ""
  let currentCwd: string | null = null

  function scan(chunk: string) {
    if (!chunk && !carry) return
    const data = carry + chunk

    // Parse DECSET/DECRST
    DECSET_RE.lastIndex = 0
    for (const match of data.matchAll(DECSET_RE)) {
      const enable = match[2] === "h"
      for (const numStr of match[1].split(";")) {
        const num = parseInt(numStr, 10)
        const key = MODE_MAP[num]
        if (key) state[key] = enable
      }
    }

    // Parse OSC-7 CWD
    const cwd = parseOsc7(data)
    if (cwd !== null) currentCwd = cwd

    carry = detectTail(data, maxTail)
  }

  function rehydrateSequences(): string {
    const seqs: string[] = []
    for (const { num, key, defaultVal } of REHYDRATE_ENTRIES) {
      if (state[key] !== defaultVal) {
        seqs.push(`${ESC}[?${num}${state[key] ? "h" : "l"}`)
      }
    }
    return seqs.join("")
  }

  return {
    scan,

    /** Backward-compat: is bracketed paste currently enabled? */
    bracketed(): boolean {
      return state.bracketedPaste
    },

    /** Full mode state (copy). */
    modes(): TerminalModes {
      return { ...state }
    },

    /** Current working directory from OSC-7, or null. */
    cwd(): string | null {
      return currentCwd
    },

    /** Escape sequences to restore non-default modes in a fresh terminal. */
    rehydrateSequences,

    /** Remaining partial escape sequence carried across chunk boundaries. */
    tail(): string {
      return carry
    },

    /** Deep-equal check against another mode state. */
    modesEqual(other: TerminalModes): boolean {
      for (const key of Object.keys(DEFAULT_MODES) as Array<keyof TerminalModes>) {
        if (state[key] !== other[key]) return false
      }
      return true
    },
  }
}
