// Key names agents write, mapped to the CDP key events Chromium needs. Electron-free so it stays unit-testable.

/** A CDP `Input.dispatchKeyEvent` key, without its type. */
export type KeyEvent = {
  readonly key: string
  readonly code: string
  readonly windowsVirtualKeyCode: number
  readonly modifiers: number
  /** Character data; present when the key types text. */
  readonly text?: string
}

// CDP modifier bits.
const ALT = 1

const CONTROL = 2

const META = 4

const SHIFT = 8

// Maps, not object literals, so an agent's "constructor" or "__proto__" never resolves to an Object.prototype member.
const modifierAliases = new Map(
  Object.entries({
    alt: ALT,
    option: ALT,
    opt: ALT,
    control: CONTROL,
    ctrl: CONTROL,
    meta: META,
    cmd: META,
    command: META,
    super: META,
    win: META,
    shift: SHIFT,
  }),
)

/** Named keys: their DOM key, physical code, and Windows virtual key code. */
const named = new Map(
  Object.entries({
    enter: ["Enter", "Enter", 13],
    return: ["Enter", "Enter", 13],
    tab: ["Tab", "Tab", 9],
    escape: ["Escape", "Escape", 27],
    esc: ["Escape", "Escape", 27],
    backspace: ["Backspace", "Backspace", 8],
    delete: ["Delete", "Delete", 46],
    del: ["Delete", "Delete", 46],
    insert: ["Insert", "Insert", 45],
    arrowup: ["ArrowUp", "ArrowUp", 38],
    up: ["ArrowUp", "ArrowUp", 38],
    arrowdown: ["ArrowDown", "ArrowDown", 40],
    down: ["ArrowDown", "ArrowDown", 40],
    arrowleft: ["ArrowLeft", "ArrowLeft", 37],
    left: ["ArrowLeft", "ArrowLeft", 37],
    arrowright: ["ArrowRight", "ArrowRight", 39],
    right: ["ArrowRight", "ArrowRight", 39],
    pageup: ["PageUp", "PageUp", 33],
    pagedown: ["PageDown", "PageDown", 34],
    home: ["Home", "Home", 36],
    end: ["End", "End", 35],
    space: [" ", "Space", 32],
    spacebar: [" ", "Space", 32],
    contextmenu: ["ContextMenu", "ContextMenu", 93],
  } satisfies Record<string, readonly [key: string, code: string, vk: number]>),
)

/** Punctuation by character: its physical code and Windows virtual key code on a US layout. */
const punctuation = new Map(
  Object.entries({
    ";": ["Semicolon", 186],
    "=": ["Equal", 187],
    ",": ["Comma", 188],
    "-": ["Minus", 189],
    ".": ["Period", 190],
    "/": ["Slash", 191],
    "`": ["Backquote", 192],
    "[": ["BracketLeft", 219],
    "\\": ["Backslash", 220],
    "]": ["BracketRight", 221],
    "'": ["Quote", 222],
  } satisfies Record<string, readonly [code: string, vk: number]>),
)

/** KeyboardEvent.code names of punctuation keys, which agents also write: Comma, Backquote. */
const codeNames = new Map(Array.from(punctuation, ([char, [code]]) => [code.toLowerCase(), char] as const))

/**
 * The key event a chord names: "Enter", "Control+A", "Meta+Shift+K", "ArrowDown", "Comma", "a", "F5", "Ctrl+,".
 * Throws a model-facing error for unknown keys or modifiers.
 */
export function parseChord(chord: string): KeyEvent {
  const value = chord.trim()

  if (!value)
    throw new Error(
      "A key is required. Use a named key such as Enter or ArrowDown, one character, or a chord such as Control+A.",
    )

  // A trailing "+" is the plus key itself: "Control++".
  const parts = value.endsWith("++") ? [...value.slice(0, -2).split("+"), "+"] : value.split("+")
  const name = parts.pop() || "+"

  const modifiers = parts.reduce((mask, part) => {
    const bit = modifierAliases.get(part.trim().toLowerCase())

    if (bit === undefined)
      throw new Error(
        `Unknown key modifier ${JSON.stringify(part)}. Use Alt, Control, Meta, or Shift (Ctrl, Cmd, and Option also work), for example Control+A or Meta+K.`,
      )

    return mask | bit
  }, 0)

  const key = keyFor(name)

  if (!key)
    throw new Error(
      `Unknown key ${JSON.stringify(name)}. Use Enter, Tab, Escape, Backspace, Delete, Insert, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F24, a KeyboardEvent.code such as Comma or Backquote, or one character. Use browser.type for text.`,
    )
  const shift = (modifiers & SHIFT) !== 0
  // Control or Meta chords are shortcuts: they type nothing.
  const typing = (modifiers & (CONTROL | META)) === 0

  const text =
    key.key === "Enter" ? "\r" : key.key.length === 1 ? (shift ? key.key.toUpperCase() : key.key) : undefined

  const event = { ...key, key: shift && key.key.length === 1 ? key.key.toUpperCase() : key.key, modifiers }

  return typing && text !== undefined ? { ...event, text } : event
}

/** The key event that types one character, or undefined when it has no key (emoji, most non-Latin text). */
export function typedKey(char: string): KeyEvent | undefined {
  if (char === "\n" || char === "\r") return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 0, text: "\r" }

  if (char === "\t") return { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 0 }
  const key = keyFor(char)

  if (!key || char.length !== 1) return undefined
  const upper = /^[A-Z]$/.test(char)

  return { ...key, key: char, modifiers: upper ? SHIFT : 0, text: char }
}

function keyFor(name: string): Omit<KeyEvent, "modifiers" | "text"> | undefined {
  const lower = name.toLowerCase()
  const entry = named.get(lower)

  if (entry) return { key: entry[0], code: entry[1], windowsVirtualKeyCode: entry[2] }

  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(lower)

  if (fn) {
    const number = Number(fn[1])

    return { key: `F${number}`, code: `F${number}`, windowsVirtualKeyCode: 111 + number }
  }

  const letter = /^(?:key)?([a-z])$/i.exec(name)?.[1]

  if (letter) {
    const char = letter.toLowerCase()

    return { key: char, code: `Key${char.toUpperCase()}`, windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0) }
  }

  const digit = /^(?:digit)?([0-9])$/i.exec(name)?.[1]

  if (digit) return { key: digit, code: `Digit${digit}`, windowsVirtualKeyCode: 48 + Number(digit) }

  const char = name.length === 1 ? name : codeNames.get(lower)
  const symbol = char === undefined ? undefined : punctuation.get(char)

  if (char !== undefined && symbol) return { key: char, code: symbol[0], windowsVirtualKeyCode: symbol[1] }

  // Any other single character still types; its virtual key is unknown.
  if (name.length === 1) return { key: name, code: "", windowsVirtualKeyCode: 0 }
}
