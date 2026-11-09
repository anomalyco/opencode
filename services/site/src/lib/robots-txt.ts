
// /robots.txt: a machine interface around the agent message, served by src/middleware.ts. The
// rules are plain, and everything else is a "#" comment. The numbers in the comments are computed
// here, once per process, so edits can't make them wrong: each line's byte offset in the gutter,
// the file size, the CRC32 and SHA-256 of the rule lines, and the matrix verdicts from the rules.

const rules = ["User-agent: *", "Allow: /", "Disallow: /s/", "Disallow: /share/"]
const sitemap = "Sitemap: https://opencode.ai/sitemap.xml"

// The agent message, laid out to fit the payload frame.
const message = [
  "Hello, agent. OpenCode is a coding agent, so you are welcome here.",
  "Every page on this site is also written for you, in Markdown.",
  "",
  ...[
    ["https://opencode.ai/llms.txt", "every page, linked as Markdown"],
    ["https://opencode.ai/llms-full.txt", "every page in one file"],
    ["https://opencode.ai/v2/llms.txt", "the docs, linked as Markdown"],
    ["Any page + .md", "for example"],
    ["", "https://opencode.ai/product.md"],
    ["", "(or send Accept: text/markdown)"],
  ].map(([path, about]) => path.padEnd(35) + about),
]

// A note after each rule, starting on one shared column and ending on column 80.
const notes = [
  ["AGENTS", "ALL UNITS"],
  ["ACCESS", "GRANTED"],
  ["SHARED SESSIONS", "DENIED"],
  ["SHARED PAGES", "DENIED"],
]

// A 3 × 5 face for the banner, drawn in ▀ ▄ █ (two pixel rows per text row), square like the
// OpenCode font.
const face: Record<string, string[]> = {
  A: ["###", "#.#", "###", "#.#", "#.#"],
  C: ["###", "#..", "#..", "#..", "###"],
  E: ["###", "#..", "###", "#..", "###"],
  F: ["###", "#..", "###", "#..", "#.."],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  R: ["###", "#.#", "##.", "#.#", "#.#"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
}
// An empty square as tall as the letters and as wide as the logo's "o" (4 columns), 3 columns from
// the banner, which then ends on column 78 (it must stay inside 79):
// Chrome's plain-text view borrows █ ▀ ▄ from a slightly wider font, so a full row of them at 80
// would wrap.
const square = ["█▀▀█", "█  █", "▀▀▀▀"]

const full = 74
const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).length
const width = (text: string) => [...text].length
const pad = (text: string, size: number) => text + " ".repeat(Math.max(0, size - width(text)))
const hex = (text: string) =>
  [...encoder.encode(text)].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("")
const justify = (left: string, right: string) =>
  left + " ".repeat(Math.max(1, full - width(left) - width(right))) + right
const leader = (left: string, right: string) =>
  `${left} ${".".repeat(Math.max(1, full - width(left) - width(right) - 2))} ${right}`

let cached: Promise<string> | undefined

/** The file, laid out once per process. */
export function robotsTxt() {
  cached ??= build()
  return cached
}

async function build() {
  const ruleText = [...rules, sitemap].join("\n")
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(ruleText)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  const crc = crc32(ruleText)
  const noteWidth = Math.max(...notes.map(([label, value]) => label.length + value.length + 3))
  const title = banner("MACHINE INTERFACE")
  const lines: Line[] = [
    { raw: "#" + Array.from({ length: 8 }, (_, i) => String(i + 1).padStart(i ? 10 : 9)).join("") },
    {
      raw:
        "#" + Array.from({ length: 79 }, (_, i) => ((i + 2) % 10 === 0 ? "|" : (i + 2) % 5 === 0 ? ":" : ".")).join(""),
    },
    "",
    ...square.map((row, i) => pad(row, 7) + title[i]),
    "",
    justify("OPENCODE.AI · ROBOTS.TXT · FOR AGENTS · UTF-8", `SHA-256(rules) ${sha.slice(0, 8)}`),
    "=".repeat(full),
    justify(`[BOOT]  0x${hex("OPENCODE")} ("OPENCODE")  RULES ${rules.length}  SITEMAP 1`, "OK"),
    justify("[LINK]", "GET /robots.txt -> 200 -> GET /llms.txt -> 200 -> GET *.md -> 200"),
    "",
    justify("PARSER COMPLIANCE MATRIX", "(computed from the rules)"),
    ...matrix(),
    "",
    ...frame(message, "DECODED PAYLOAD"),
    "",
    justify(`BASE64  ${btoa(sitemap.slice("Sitemap: ".length))}`, "(sitemap)"),
    `-- EXECUTE ${"-".repeat(full - 11)}`,
    ...rules.map((rule, i) => {
      const [label, value] = notes[i]
      const note = `${label} ${".".repeat(noteWidth - label.length - value.length - 2)} ${value}`
      return { raw: pad(rule, 80 - 2 - width(note)) + "# " + note }
    }),
    "-".repeat(full),
    justify(`${rules.length} RULES LOADED · 0 ERRORS`, `CRC32(rules, comments stripped) ${crc}`),
    justify("SITEMAP", "NEXT LINE, A BARE URL WITH NO COMMENT"),
    { raw: sitemap },
    leader("DESIGN AUTHORITY", "OBEY DAVID"),
    justify(`EOF · {SIZE} BYTES · CRC32(rules) ${crc}`, "END OF TRANSMISSION"),
  ]
  // Each comment line starts with its own byte offset; the gutter is a fixed 6 columns, so the
  // offsets can be counted line by line. The size has a fixed width too, so filling it in last
  // doesn't move anything.
  let offset = 0
  const text =
    lines
      .map((line) => {
        const out = typeof line === "string" ? `#${offset.toString(16).padStart(4, "0")} ${line}`.trimEnd() : line.raw
        offset += bytes(out) + 1
        return out
      })
      .join("\n") + "\n"
  return text.replace("{SIZE}", String(bytes(text)).padStart(6, "0"))
}

type Line = string | { raw: string }

function banner(text: string) {
  const glyph = (char: string, row: number) => (char === " " ? "." : face[char][row])
  const pixels = (row: number) => [...text].map((char) => glyph(char, row)).join(".")
  return [0, 2, 4].map((row) =>
    [...pixels(row)]
      .map((top, i) => {
        const bottom = row + 1 < 5 ? pixels(row + 1)[i] : "."
        return top === "#" && bottom === "#" ? "█" : top === "#" ? "▀" : bottom === "#" ? "▄" : " "
      })
      .join("")
      .trimEnd(),
  )
}

/** ALLOW or DENY for each agent and path, by the rules: the longest matching path wins, Allow on a tie. */
function matrix() {
  const agents = ["Googlebot", "GPTBot", "ClaudeBot", "*"]
  const paths = ["/", "/docs", "/s/abc", "/share/abc"]
  const allowed = (path: string) => {
    const match = rules
      .slice(1)
      .map((rule) => ({ allow: rule.startsWith("Allow: "), path: rule.slice(rule.indexOf(" ") + 1) }))
      .filter((rule) => path.startsWith(rule.path))
      .sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0]
    return match?.allow ?? true
  }
  const first = 12
  const cell = (full - 2 - first - paths.length) / paths.length
  const border = "+" + ["-".repeat(first), ...paths.map(() => "-".repeat(cell))].join("+") + "+"
  const row = (cells: string[]) => "|" + cells.map((text, i) => pad(" " + text, i ? cell : first)).join("|") + "|"
  return [
    border,
    row(["Agent", ...paths]),
    border,
    ...agents.map((agent) => row([agent, ...paths.map((path) => (allowed(path) ? "ALLOW" : "DENY"))])),
    border,
  ]
}

function frame(lines: string[], title: string) {
  const inner = full - 2
  return [
    `+== ${title} ${"=".repeat(inner - width(title) - 4)}+`,
    `|${" ".repeat(inner)}|`,
    ...lines.map((line) => `|  ${pad(line, inner - 2)}|`),
    `|${" ".repeat(inner)}|`,
    `+${"=".repeat(inner)}+`,
  ]
}

function crc32(text: string) {
  const crc = [...encoder.encode(text)].reduce((value, byte) => {
    const next = Array.from({ length: 8 }).reduce<number>(
      (c) => (c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1),
      value ^ byte,
    )
    return next
  }, 0xffffffff)
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0")
}
