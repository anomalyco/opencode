// What the paste dialog can do with a paste before it goes into the prompt. The dialog shows the
// options in this order; every one is off until the user turns it on, and the last choice is kept.
export const PasteOptionList = [
  { key: "inline", label: "insert inline" },
  { key: "fence", label: "wrap with ```" },
  { key: "code", label: "wrap with `" },
  { key: "quote", label: "quote with >" },
  { key: "trim", label: "trim whitespace" },
  { key: "dedent", label: "normalize indents" },
  { key: "unindent", label: "remove indents" },
  { key: "collapse", label: "collapse blank lines" },
  { key: "join", label: "join into one line" },
  { key: "ansi", label: "strip ANSI escapes" },
] as const

// Where the last choices are kept in kv.json, so the next paste starts from them.
export const PasteOptionsKVKey = "paste_options"

export type PasteOptionKey = (typeof PasteOptionList)[number]["key"]
export type PasteOptions = Record<PasteOptionKey, boolean>

export const PasteOptionsDefault: PasteOptions = {
  inline: false,
  fence: false,
  code: false,
  quote: false,
  trim: false,
  dedent: false,
  unindent: false,
  collapse: false,
  join: false,
  ansi: false,
}

// The options as stored, keeping only known keys, so a stale or hand-edited value cannot break them.
export function readPasteOptions(value: unknown): PasteOptions {
  if (!value || typeof value !== "object") return { ...PasteOptionsDefault }
  const stored = value as Record<string, unknown>
  return Object.fromEntries(
    PasteOptionList.map((option) => [option.key, stored[option.key] === true]),
  ) as PasteOptions
}

// Turning one wrap on turns the other off: a paste is either a code block or inline code.
export function togglePasteOption(options: PasteOptions, key: PasteOptionKey): PasteOptions {
  const next = { ...options, [key]: !options[key] }
  if (key === "fence" && next.fence) next.code = false
  if (key === "code" && next.code) next.fence = false
  return next
}

// Off and greyed out in the dialog, keeping its stored value: inline code for text of more than one
// line, and a cleanup another one already covers - remove indents leaves normalize indents no
// indent to remove, and join into one line leaves collapse blank lines no blank line.
export function pasteOptionDisabled(key: PasteOptionKey, body: string, options: PasteOptions) {
  if (key === "code") return body.includes("\n")
  if (key === "dedent") return options.unindent
  if (key === "collapse") return options.join
  return false
}

// The paste as it goes into the prompt: cleaned up, then wrapped.
export function applyPasteOptions(text: string, options: PasteOptions) {
  return wrapPaste(cleanPaste(text, options), options)
}

// The cleanups, each of which leaves its own output unchanged when applied again. The line-based
// ones run before the join, and the wraps after the cleanups, so a wrap goes around the joined line.
// A greyed-out cleanup still runs: what covers it leaves it nothing to change.
export function cleanPaste(text: string, options: PasteOptions) {
  const stripped = options.ansi ? text.replace(ANSI, "") : text
  const trimmed = options.trim ? trimLines(stripped) : stripped
  const dedented = options.dedent ? dedent(trimmed) : trimmed
  const unindented = options.unindent ? dedented.replace(/^[ \t]+/gm, "") : dedented
  const collapsed = options.collapse ? unindented.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n") : unindented
  return options.join ? joinLines(collapsed) : collapsed
}

// A fence longer than any run of backticks in the text, so the text cannot close it; the quote
// goes outside the wrap, so a quoted code block stays a code block.
export function wrapPaste(body: string, options: PasteOptions) {
  const wrapped = options.fence
    ? fence(body)
    : options.code && !pasteOptionDisabled("code", body, options)
      ? inlineCode(body)
      : body
  if (!options.quote) return wrapped
  return wrapped
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

// The text inside the wraps of edited dialog text, and the wraps it still has. A wrap the edit broke,
// such as a deleted fence line, is dropped rather than guessed at.
export function unwrapPaste(text: string, options: PasteOptions) {
  const quoted = options.quote ? unquote(text) : undefined
  const inner = quoted ?? text
  const fenced = options.fence ? unfence(inner) : undefined
  const coded = !options.fence && options.code ? uncode(inner) : undefined
  return {
    body: fenced ?? coded ?? inner,
    options: {
      ...options,
      quote: options.quote && quoted !== undefined,
      fence: options.fence && fenced !== undefined,
      // Inline code is off for text of more than one line rather than broken by it.
      code: options.code && (coded !== undefined || inner.includes("\n")),
    },
  }
}

// CSI sequences (colors, cursor moves), OSC sequences (titles, links) and two-byte escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

// Each line loses its trailing whitespace; leading whitespace is indentation, which normalize
// indents handles. Blank lines at the start and the end go.
function trimLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
}

// Removes the leading whitespace every non-blank line shares, character for character, so a tab
// and spaces are never taken for one another; blank lines do not count and lose their whitespace.
function dedent(text: string) {
  const lines = text.split("\n")
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)![0])
  if (indents.length === 0) return text
  const common = indents.reduce((shared, indent) => {
    let length = 0
    while (length < shared.length && shared[length] === indent[length]) length++
    return shared.slice(0, length)
  })
  if (!common) return text
  return lines.map((line) => (line.trim() ? line.slice(common.length) : "")).join("\n")
}

// One line: blank lines go, and the rest are joined with one space, losing the whitespace at each
// join (the trailing whitespace before it and the indent after it). Whitespace inside a line and at
// the paste's two ends is left for the other cleanups. A CR LF or a lone CR is one break.
function joinLines(text: string) {
  if (!/[\r\n]/.test(text)) return text
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim())
  return lines
    .map((line, index) => {
      const start = index === 0 ? line : line.trimStart()
      return index === lines.length - 1 ? start : start.trimEnd()
    })
    .join(" ")
}

function longestBacktickRun(text: string) {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

function fence(body: string) {
  const ticks = "`".repeat(Math.max(3, longestBacktickRun(body) + 1))
  return `${ticks}\n${body}\n${ticks}`
}

function inlineCode(body: string) {
  const ticks = "`".repeat(longestBacktickRun(body) + 1)
  const pad = body.startsWith("`") || body.endsWith("`") ? " " : ""
  return `${ticks}${pad}${body}${pad}${ticks}`
}

function unquote(text: string) {
  const lines = text.split("\n")
  if (!lines.every((line) => line === ">" || line.startsWith("> "))) return
  return lines.map((line) => line.slice(2)).join("\n")
}

function unfence(text: string) {
  const lines = text.split("\n")
  if (lines.length < 2 || !/^`{3,}$/.test(lines[0]) || lines.at(-1) !== lines[0]) return
  return lines.slice(1, -1).join("\n")
}

function uncode(text: string) {
  const match = text.match(/^(`+)( ?)([^\n]*?)\2\1$/)
  return match?.[3]
}
